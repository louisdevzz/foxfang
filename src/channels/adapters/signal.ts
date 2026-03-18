/**
 * Signal Channel Adapter using signal-cli
 * 
 * Requires signal-cli to be installed:
 *   brew install signal-cli  (macOS)
 *   apt install signal-cli   (Ubuntu/Debian)
 * 
 * Or download from: https://github.com/AsamK/signal-cli/releases
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import type { ChannelAdapter, ChannelMessage, ChannelResponse } from '../types';
import { loadConfig } from '../../config';

const execAsync = promisify(exec);

export class SignalAdapter implements ChannelAdapter {
  readonly name = 'signal';
  connected = false;
  private phoneNumber: string = '';
  private signalCliPath: string = 'signal-cli';
  private messageHandler?: (msg: ChannelMessage) => Promise<ChannelResponse | void>;
  private receiveProcess?: ReturnType<typeof spawn>;

  constructor() {}

  async connect(): Promise<void> {
    // Load config
    const config = await loadConfig();
    const signalConfig = config.channels?.signal;
    
    if (!signalConfig?.enabled || !signalConfig?.phoneNumber) {
      throw new Error('Signal not configured. Run: foxfang channel setup signal');
    }

    this.phoneNumber = signalConfig.phoneNumber;
    
    // Check signal-cli is available
    try {
      await execAsync(`${this.signalCliPath} --version`);
    } catch {
      throw new Error(
        'signal-cli not found. Install with:\n' +
        '  macOS: brew install signal-cli\n' +
        '  Or download: https://github.com/AsamK/signal-cli/releases'
      );
    }

    // Check if registered
    try {
      await execAsync(`${this.signalCliPath} -a ${this.phoneNumber} receive --timeout 1`);
    } catch {
      throw new Error(
        `Signal not registered for ${this.phoneNumber}.\n` +
        'Register with: signal-cli -a YOUR_NUMBER register'
      );
    }

    this.connected = true;
    
    // Start listening for messages
    this.startReceiving();
    
    console.log(`[Signal] Connected as ${this.phoneNumber}`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.receiveProcess) {
      this.receiveProcess.kill();
      this.receiveProcess = undefined;
    }
    console.log('[Signal] Disconnected');
  }

  async send(to: string, content: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Signal not connected');
    }

    try {
      await execAsync(
        `${this.signalCliPath} -a ${this.phoneNumber} send -m "${content.replace(/"/g, '\\"')}" ${to}`
      );
    } catch (error) {
      console.error('[Signal] Failed to send message:', error);
      throw error;
    }
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse | void>): void {
    this.messageHandler = handler;
  }

  private startReceiving(): void {
    // signal-cli receive -t 5 (poll every 5 seconds)
    // Note: --json flag may not be available in all versions
    this.receiveProcess = spawn(this.signalCliPath, [
      '-a', this.phoneNumber,
      'receive',
      '-t', '5'
    ]);

    let buffer = '';

    this.receiveProcess.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      
      // Process text format (not JSON)
      // Split by "Envelope from:" to get individual messages
      const parts = buffer.split('Envelope from:');
      buffer = parts.pop() || ''; // Keep incomplete message in buffer
      
      for (const part of parts) {
        if (part.trim()) {
          this.handleTextMessage('Envelope from:' + part);
        }
      }
    });

    this.receiveProcess.stderr?.on('data', (data: Buffer) => {
      const error = data.toString();
      if (!error.includes('INFO') && !error.includes('WARN')) {
        console.error('[Signal] Error:', error);
      }
    });

    this.receiveProcess.on('exit', (code) => {
      if (this.connected && code !== 0) {
        console.log('[Signal] Receive process exited, reconnecting...');
        setTimeout(() => this.startReceiving(), 5000);
      }
    });
  }

  private async handleTextMessage(text: string): Promise<void> {
    try {
      // Parse text format:
      // Envelope from: "Name" +NUMBER (device: 1) to +NUMBER
      // ...
      // Body: message content
      
      const fromMatch = text.match(/from: ["']([^"']+)["']\s+(\+\d+)/);
      const bodyMatch = text.match(/Body: (.+?)(?:\n|$)/);
      const timestampMatch = text.match(/Timestamp:\s+(\d+)/);
      
      if (fromMatch && bodyMatch && this.messageHandler) {
        const name = fromMatch[1];
        const phone = fromMatch[2];
        const content = bodyMatch[1].trim();
        const timestamp = timestampMatch ? timestampMatch[1] : Date.now().toString();
        
        if (content) {
          const channelMsg: ChannelMessage = {
            id: timestamp,
            channel: 'signal',
            from: `${name} (${phone})`,
            content: content,
            timestamp: new Date(),
          };

          console.log(`[Signal] Received from ${name}: ${content.substring(0, 50)}...`);

          const response = await this.messageHandler(channelMsg);
          
          if (response) {
            // Send response back
            await this.send(phone, response.content);
          }
        }
      }
    } catch (error) {
      // Ignore parse errors
    }
  }
}
