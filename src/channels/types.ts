/**
 * Channel types for FoxFang
 */

export interface ChannelMessage {
  id: string;
  channel: string;
  from: string;
  content: string;
  timestamp: Date;
  threadId?: string;
}

export interface ChannelResponse {
  messageId: string;
  content: string;
}

export interface StreamChunk {
  type: 'chunk' | 'done' | 'error';
  content?: string;
  error?: string;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly connected: boolean;
  
  /** Connect to channel (start listening) */
  connect(): Promise<void>;
  
  /** Disconnect from channel */
  disconnect(): Promise<void>;
  
  /** Send message to channel */
  send(to: string, content: string): Promise<void>;
  
  /** Send streaming response to channel */
  sendStream?(to: string, stream: AsyncIterable<StreamChunk>): Promise<void>;
  
  /** Set handler for incoming messages */
  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse | void> | void): void;
}

export interface ChannelConfig {
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
}
