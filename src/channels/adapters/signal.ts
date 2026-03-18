/**
 * Signal Channel Adapter using signal-cli HTTP API (JSON-RPC)
 * 
 * Requires signal-cli daemon running:
 *   signal-cli -a +YOUR_NUMBER daemon --http 127.0.0.1:8686
 */

import type { ChannelAdapter, ChannelMessage, ChannelResponse } from '../types';
import { loadConfig } from '../../config';

interface SignalSseEvent {
  event?: string;
  data?: string;
  id?: string;
}

export class SignalAdapter implements ChannelAdapter {
  readonly name = 'signal';
  connected = false;
  private phoneNumber: string = '';
  private httpUrl: string = 'http://127.0.0.1:8686';
  private messageHandler?: (msg: ChannelMessage) => Promise<ChannelResponse | void>;
  private abortController?: AbortController;

  constructor() {}

  async connect(): Promise<void> {
    // Load config
    const config = await loadConfig();
    const signalConfig = config.channels?.signal;
    
    if (!signalConfig?.enabled || !signalConfig?.phoneNumber) {
      throw new Error('Signal not configured. Run: foxfang channel setup signal');
    }

    this.phoneNumber = signalConfig.phoneNumber;
    this.httpUrl = signalConfig.httpUrl || 'http://127.0.0.1:8686';

    // Check signal-cli HTTP API is accessible
    try {
      const response = await fetch(`${this.httpUrl}/api/v1/check`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      console.log(`[Signal] ✅ Connected to signal-cli at ${this.httpUrl}`);
    } catch (error) {
      throw new Error(
        `Cannot connect to signal-cli daemon at ${this.httpUrl}.\n` +
        `Make sure signal-cli is running:\n` +
        `  signal-cli -a ${this.phoneNumber} daemon --http 127.0.0.1:8686`
      );
    }

    this.connected = true;
    
    // Start SSE loop
    this.startSseLoop();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.abortController?.abort();
    console.log('[Signal] Disconnected');
  }

  async send(to: string, content: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Signal not connected');
    }

    try {
      // JSON-RPC call to send message
      const response = await fetch(`${this.httpUrl}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'send',
          params: {
            account: this.phoneNumber,
            recipient: [to],
            message: content,
          },
          id: Math.random().toString(36).substr(2, 9),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    } catch (error) {
      console.error('[Signal] Failed to send message:', error);
      throw error;
    }
  }

  async sendTyping(to: string): Promise<void> {
    if (!this.connected) return;

    try {
      // JSON-RPC call to send typing indicator
      // Note: signal-cli doesn't have stop-typing, indicators auto-expire after ~15s
      await fetch(`${this.httpUrl}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'sendTyping',
          params: {
            account: this.phoneNumber,
            recipient: [to],
          },
          id: Math.random().toString(36).substr(2, 9),
        }),
      });
    } catch {
      // Ignore errors for typing indicators
    }
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse | void>): void {
    this.messageHandler = handler;
  }

  private startSseLoop(): void {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const runLoop = async () => {
      let reconnectDelay = 1000;

      while (this.connected && !signal.aborted) {
        try {
          await this.streamEvents(signal);
          reconnectDelay = 1000;
        } catch (error) {
          if (signal.aborted) return;
          
          console.log(`[Signal] Connection lost, reconnecting in ${reconnectDelay}ms...`);
          await this.sleep(reconnectDelay, signal);
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        }
      }
    };

    runLoop();
  }

  private async streamEvents(abortSignal: AbortSignal): Promise<void> {
    // signal-cli SSE: /api/v1/events?account=PHONE_NUMBER
    const url = `${this.httpUrl}/api/v1/events?account=${encodeURIComponent(this.phoneNumber)}`;

    const response = await fetch(url, {
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent: SignalSseEvent = {};

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent.event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentEvent.data = line.slice(5).trim();
        } else if (line.startsWith('id:')) {
          currentEvent.id = line.slice(3).trim();
        } else if (line === '' && currentEvent.data) {
          this.handleSseEvent(currentEvent);
          currentEvent = {};
        }
      }
    }
  }

  private handleSseEvent(event: SignalSseEvent): void {
    if (!event.data) return;

    try {
      const data = JSON.parse(event.data);
      
      // Parse signal-cli envelope format
      if (data.envelope?.dataMessage) {
        const msg = data.envelope.dataMessage;
        const source = data.envelope.source;
        const sourceName = data.envelope.sourceName || source;
        
        if (msg.message && this.messageHandler) {
          const channelMsg: ChannelMessage = {
            id: data.envelope.timestamp.toString(),
            channel: 'signal',
            from: `${sourceName} (${source})`,
            content: msg.message,
            timestamp: new Date(data.envelope.timestamp),
            threadId: msg.groupInfo?.groupId,
          };

          // Process through agent (ChannelManager handles logging)
          this.messageHandler(channelMsg).catch(err => {
            console.error('[Signal] Error:', err);
          });
        }
      }
    } catch (error) {
      // Ignore parse errors
    }
  }

  private sleep(ms: number, abortSignal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (abortSignal.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const timeout = setTimeout(resolve, ms);
      abortSignal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Aborted'));
      }, { once: true });
    });
  }
}
