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
  metadata?: Record<string, any>;
}

export interface ChannelResponse {
  messageId: string;
  content: string;
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
  
  /** 
   * Show typing indicator (if supported by channel)
   * Should be called repeatedly every few seconds to keep indicator alive
   */
  sendTyping?(to: string): Promise<void>;
  
  /** Set handler for incoming messages */
  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse | void> | void): void;
}

export interface ChannelConfig {
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
}
