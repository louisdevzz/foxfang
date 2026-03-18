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
    this.receiveProcess = spawn(this.signalCliPath, [
      '-a', this.phoneNumber,
      'receive',
      '-t', '5',
      '--json'
    ]);

    let buffer = '';

    this.receiveProcess.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      
      // Process line by line (JSON objects)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          this.handleJsonMessage(line.trim());
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

  private async handleJsonMessage(jsonStr: string): Promise<void> {
    try {
      const envelope = JSON.parse(jsonStr);
      
      // Check if it's a data message (not receipt/sync)
      if (envelope.envelope?.dataMessage) {
        const msg = envelope.envelope.dataMessage;
        const source = envelope.envelope.source;
        
        if (msg.message && this.messageHandler) {
          const channelMsg: ChannelMessage = {
            id: envelope.envelope.timestamp.toString(),
            channel: 'signal',
            from: source,
            content: msg.message,
            timestamp: new Date(),
            threadId: msg.groupInfo?.groupId,
          };

          const response = await this.messageHandler(channelMsg);
          
          if (response) {
            // Send response back
            await this.send(source, response.content);
          }
        }
      }
    } catch (error) {
      // Ignore parse errors (might be non-message data)
    }
  }
}
