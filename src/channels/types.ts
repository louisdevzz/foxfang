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
  sendTyping?(to: string, threadId?: string): Promise<void>;
  
  /**
   * React to a message with an emoji (if supported by channel)
   * Used to acknowledge receipt before sending reply
   * @param messageId - The message ID to react to
   * @param emoji - The emoji to react with (e.g., '👀')
   * @param channelId - Optional channel/chat ID (required for Discord, Slack)
   * @param from - Optional user ID (required for Signal recipient)
   */
  reactToMessage?(messageId: string, emoji: string, channelId?: string, from?: string): Promise<void>;
  
  /**
   * Remove reaction from a message (if supported by channel)
   * Used to clean up ack reaction after sending reply
   * @param messageId - The message ID to remove reaction from
   * @param channelId - Optional channel/chat ID
   * @param from - Optional user ID (required for Signal recipient)
   */
  removeReaction?(messageId: string, channelId?: string, from?: string): Promise<void>;
  
  /** Set handler for incoming messages */
  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse | void> | void): void;
}

export interface ChannelConfig {
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
}
