/**
 * Slack Channel Adapter - Full Implementation
 * 
 * Features:
 * - Socket Mode WebSocket connection
 * - Automatic reconnection
 * - Typing indicators (using chat.typing)
 * - Message threading
 * - Block Kit support (future)
 * - App mentions and DMs
 * 
 * Setup:
 * 1. Create app at https://api.slack.com/apps
 * 2. Enable Socket Mode
 * 3. Subscribe to events: message.im, message.channels, app_mention
 * 4. Get app token (xapp-) and bot token (xoxb-)
 * 5. Configure: pnpm foxfang wizard channels
 */

import type { ChannelAdapter, ChannelMessage, ChannelResponse } from '../types';
import { loadConfig } from '../../config';
import { markdownToSlackMrkdwn } from '../formatters';

// Slack Event Types
interface SlackEvent {
  type: string;
  user?: string;
  channel?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  channel_type?: string;
}

interface SlackEnvelope {
  envelope_id: string;
  type: 'events_api' | 'interactive' | 'slash_commands' | 'hello' | 'disconnect';
  payload?: {
    event?: SlackEvent;
    token?: string;
    team_id?: string;
    api_app_id?: string;
  };
  accepts_response_payload?: boolean;
}

interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
}

interface SlackConversation {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_im?: boolean;
  is_group?: boolean;
}

// WebSocket close codes that trigger reconnect
const RECONNECT_CLOSE_CODES = [1001, 1006, 1011, 1012, 1013, 1000];

// Exponential backoff config
const BACKOFF_CONFIG = {
  initialMs: 1000,
  maxMs: 60000,
  factor: 2,
  jitter: 0.25,
};

export class SlackAdapter implements ChannelAdapter {
  readonly name = 'slack';
  connected = false;
  private appToken: string = '';
  private botToken: string = '';
  private baseUrl: string = 'https://slack.com/api';
  private ws?: WebSocket;
  private messageHandler?: (msg: ChannelMessage) => Promise<ChannelResponse | void>;
  private abortController?: AbortController;
  
  // Socket Mode state
  private reconnectAttempts = 0;
  private reconnectTimeout?: NodeJS.Timeout;
  private pingInterval?: NodeJS.Timeout;
  private lastPongReceived = true;
  private botInfo?: { id: string; name: string };
  private socketUrl?: string;

  constructor() {}

  async connect(): Promise<void> {
    const config = await loadConfig();
    const slackConfig = config.channels?.slack;
    
    if (!slackConfig?.enabled || !slackConfig?.botToken) {
      throw new Error(
        'Slack not configured. Run: pnpm foxfang wizard channels\n' +
        'Create app at: https://api.slack.com/apps'
      );
    }

    this.botToken = slackConfig.botToken;
    this.appToken = (slackConfig as any).appToken; // Socket Mode requires app-level token

    if (!this.appToken || !this.appToken.startsWith('xapp-')) {
      throw new Error(
        'Slack Socket Mode requires an app-level token (xapp-).\n' +
        '1. Go to https://api.slack.com/apps → Your App → Socket Mode\n' +
        '2. Generate an app-level token with connections:write scope\n' +
        '3. Add the token to your config'
      );
    }

    // Verify bot token and get bot info
    try {
      const auth = await this.apiCall<{ user_id: string; user: string }>('auth.test', {}, this.botToken);
      this.botInfo = { id: auth?.user_id || '', name: auth?.user || '' };
      console.log(`[Slack] ✅ Bot connected as @${auth?.user || 'unknown'}`);
    } catch (error) {
      throw new Error(
        `Cannot connect to Slack API: ${error instanceof Error ? error.message : 'Unknown error'}\n` +
        `Make sure your bot token (xoxb-) is valid`
      );
    }

    this.connected = true;
    this.reconnectAttempts = 0;
    
    // Start Socket Mode connection
    await this.connectSocketMode();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.abortController?.abort();
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
    
    console.log('[Slack] Disconnected');
  }

  async send(to: string, content: string, options?: { threadTs?: string }): Promise<void> {
    if (!this.connected) {
      throw new Error('Slack not connected');
    }

    try {
      // Convert markdown to Slack mrkdwn format
      const mrkdwnContent = markdownToSlackMrkdwn(content);

      const body: Record<string, any> = {
        channel: to,
        text: mrkdwnContent,
        mrkdwn: true,
      };

      if (options?.threadTs) {
        body.thread_ts = options.threadTs;
      }

      await this.apiCall('chat.postMessage', body, this.botToken);
    } catch (error) {
      console.error('[Slack] Failed to send message:', error);
      throw error;
    }
  }

  async sendTyping(to: string, _threadId?: string): Promise<void> {
    if (!this.connected) return;

    try {
      // Slack doesn't have a direct typing indicator, but we can use the typing method
      await this.apiCall('chat.typing', { channel: to }, this.botToken);
    } catch {
      // Ignore typing indicator errors
    }
  }

  async reactToMessage(messageId: string, emoji: string, channelId?: string): Promise<void> {
    if (!this.connected || !channelId) return;

    try {
      await this.apiCall('reactions.add', {
        channel: channelId,
        timestamp: messageId,
        name: emoji,
      }, this.botToken);
    } catch {
      // Ignore reaction errors
    }
  }

  async removeReaction(messageId: string, channelId?: string): Promise<void> {
    if (!this.connected || !channelId) return;

    try {
      await this.apiCall('reactions.remove', {
        channel: channelId,
        timestamp: messageId,
        name: 'eyes', // Remove the eyes reaction
      }, this.botToken);
    } catch {
      // Ignore removal errors
    }
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse | void>): void {
    this.messageHandler = handler;
  }

  getBotInfo(): { id: string; name: string } | undefined {
    return this.botInfo;
  }

  private async connectSocketMode(): Promise<void> {
    if (!this.connected) return;

    try {
      // Get WebSocket URL from Slack
      const response = await this.apiCall<{ url: string }>('apps.connections.open', {}, this.appToken);
      this.socketUrl = response?.url;
      
      console.log('[Slack] 🔌 Connecting to Socket Mode...');
      
      // Connect WebSocket
      if (!this.socketUrl) {
        throw new Error('No Socket Mode URL received');
      }
      this.ws = new WebSocket(this.socketUrl);
      
      this.ws.onopen = () => {
        console.log('[Slack] 🔌 Socket Mode connected');
        this.startPingInterval();
      };
      
      this.ws.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data as string) as SlackEnvelope;
          this.handleEnvelope(envelope);
        } catch (error) {
          console.error('[Slack] Failed to parse message:', error);
        }
      };
      
      this.ws.onclose = (event) => {
        console.log(`[Slack] Socket closed: ${event.code} ${event.reason}`);
        
        if (this.connected && !RECONNECT_CLOSE_CODES.includes(event.code)) {
          this.handleReconnect();
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('[Slack] Socket error:', error);
      };
      
    } catch (error) {
      console.error('[Slack] Failed to connect Socket Mode:', error);
      this.handleReconnect();
    }
  }

  private handleEnvelope(envelope: SlackEnvelope): void {
    switch (envelope.type) {
      case 'hello':
        console.log('[Slack] ✅ Socket Mode ready');
        this.reconnectAttempts = 0; // Reset on successful connection
        break;
        
      case 'disconnect':
        console.log('[Slack] Server requested disconnect');
        this.ws?.close(4000, 'Server requested disconnect');
        break;
        
      case 'events_api':
        this.handleEvent(envelope.payload?.event);
        
        // Acknowledge the event
        if (envelope.accepts_response_payload) {
          this.ws?.send(JSON.stringify({
            envelope_id: envelope.envelope_id,
          }));
        }
        break;
    }
  }

  private handleEvent(event?: SlackEvent): void {
    if (!event) return;

    // Skip bot messages and message updates
    if (event.bot_id || event.subtype) return;

    // Only handle messages and app mentions
    if (event.type !== 'message' && event.type !== 'app_mention') return;

    // Skip messages without text
    if (!event.text?.trim()) return;

    // Skip messages from the bot itself
    if (event.user === this.botInfo?.id) return;

    const channelMsg: ChannelMessage = {
      id: event.ts,
      channel: 'slack',
      from: event.user || 'unknown',
      content: this.cleanMessageText(event.text),
      timestamp: new Date(parseFloat(event.ts) * 1000),
      metadata: {
        channelId: event.channel,
        userId: event.user,
        threadTs: event.thread_ts,
        channelType: event.channel_type,
        isThread: !!event.thread_ts,
      },
    };

    if (this.messageHandler) {
      this.messageHandler(channelMsg).catch(error => {
        console.error('[Slack] Message handler error:', error);
      });
    }
  }

  private cleanMessageText(text: string): string {
    // Remove bot mention from message text
    if (this.botInfo) {
      const mention = `<@${this.botInfo.id}>`;
      text = text.replace(mention, '').trim();
    }
    return text;
  }

  private startPingInterval(): void {
    // Slack Socket Mode uses ping/pong
    this.pingInterval = setInterval(() => {
      if (!this.lastPongReceived) {
        console.error('[Slack] Ping not acknowledged, reconnecting...');
        this.ws?.close(4000, 'Ping timeout');
        return;
      }

      this.lastPongReceived = false;
      
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // Every 30 seconds
  }

  private handleReconnect(): void {
    if (!this.connected) return;

    // Stop existing intervals
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      BACKOFF_CONFIG.initialMs * Math.pow(BACKOFF_CONFIG.factor, this.reconnectAttempts - 1),
      BACKOFF_CONFIG.maxMs
    );
    const jitter = delay * BACKOFF_CONFIG.jitter * (Math.random() - 0.5);
    const finalDelay = Math.max(0, delay + jitter);

    console.log(`[Slack] 🔄 Reconnecting in ${Math.round(finalDelay / 1000)}s (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimeout = setTimeout(() => {
      this.connectSocketMode();
    }, finalDelay);
  }

  private async apiCall<T>(method: string, params: Record<string, any> = {}, token?: string): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token || this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { ok: boolean; error?: string } & T;
    
    if (!data.ok) {
      throw new Error(data.error || 'Slack API error');
    }

    return data as T;
  }
}
