/**
 * Content Service
 * 
 * Manages content editing across all channels.
 * Provides message tracking, editing, and draft streaming.
 */

import type { ChannelAdapter } from '../channels/types';
import { createSignalDraftStream, type DraftStream, type DraftStreamConfig } from '../channels/draft-stream';

export interface SentMessage {
  id: string;
  channel: string;
  recipient: string;
  content: string;
  timestamp: number;
  messageId?: string;  // Channel-specific message ID
  parentId?: string;   // For threaded replies
}

export interface EditResult {
  success: boolean;
  newMessageId?: string;
  error?: string;
}

export interface ContentStream {
  id: string;
  channel: string;
  recipient: string;
  draftStream: DraftStream;
  createdAt: number;
}

/**
 * Content Service for cross-channel message management
 */
export class ContentService {
  private messages: Map<string, SentMessage> = new Map();
  private streams: Map<string, ContentStream> = new Map();
  private channels: Map<string, ChannelAdapter> = new Map();

  /**
   * Register a channel adapter
   */
  registerChannel(adapter: ChannelAdapter): void {
    this.channels.set(adapter.name, adapter);
  }

  /**
   * Send a message and track it for editing
   */
  async send(
    channel: string,
    recipient: string,
    content: string,
    options?: { replyToMessageId?: string; threadId?: string }
  ): Promise<SentMessage | null> {
    const adapter = this.channels.get(channel);
    if (!adapter) {
      throw new Error(`Channel ${channel} not registered`);
    }

    const id = `${channel}:${recipient}:${Date.now()}`;
    
    try {
      const messageId = await adapter.send(recipient, content, options);
      
      const sentMessage: SentMessage = {
        id,
        channel,
        recipient,
        content,
        timestamp: Date.now(),
        messageId: messageId || undefined,
        parentId: options?.replyToMessageId,
      };
      
      this.messages.set(id, sentMessage);
      
      console.log(`[ContentService] Message sent: ${id} on ${channel}`);
      return sentMessage;
    } catch (error) {
      console.error(`[ContentService] Failed to send message:`, error);
      return null;
    }
  }

  /**
   * Edit an existing message
   */
  async edit(messageId: string, newContent: string): Promise<EditResult> {
    const message = this.messages.get(messageId);
    if (!message) {
      return { success: false, error: 'Message not found' };
    }

    const adapter = this.channels.get(message.channel);
    if (!adapter) {
      return { success: false, error: `Channel ${message.channel} not available` };
    }

    if (!adapter.edit) {
      return { success: false, error: `Channel ${message.channel} does not support editing` };
    }

    try {
      const success = await adapter.edit(
        message.messageId || messageId,
        newContent,
        message.recipient
      );

      if (success) {
        // Update stored content
        message.content = newContent;
        this.messages.set(messageId, message);
        
        console.log(`[ContentService] Message edited: ${messageId}`);
        return { success: true };
      } else {
        return { success: false, error: 'Edit operation failed' };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ContentService] Edit failed:`, error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Delete a message
   */
  async delete(messageId: string): Promise<boolean> {
    const message = this.messages.get(messageId);
    if (!message) {
      console.error(`[ContentService] Message not found: ${messageId}`);
      return false;
    }

    const adapter = this.channels.get(message.channel);
    if (!adapter?.delete) {
      console.error(`[ContentService] Channel ${message.channel} does not support deletion`);
      return false;
    }

    try {
      const success = await adapter.delete(
        message.messageId || messageId,
        message.recipient
      );

      if (success) {
        this.messages.delete(messageId);
        console.log(`[ContentService] Message deleted: ${messageId}`);
      }

      return success;
    } catch (error) {
      console.error(`[ContentService] Delete failed:`, error);
      return false;
    }
  }

  /**
   * Create a draft stream for live content editing
   */
  createStream(
    channel: string,
    recipient: string,
    config?: DraftStreamConfig
  ): { streamId: string; stream: DraftStream } | null {
    const adapter = this.channels.get(channel);
    if (!adapter) {
      throw new Error(`Channel ${channel} not registered`);
    }

    const streamId = `stream:${channel}:${recipient}:${Date.now()}`;

    // Create channel-specific draft stream
    let draftStream: DraftStream;

    if (channel === 'signal') {
      // Signal uses delete+resend pattern
      const send = async (content: string): Promise<string | void> => {
        const result = await adapter.send(recipient, content);
        return result;
      };
      
      const deleteMsg = async (msgId: string): Promise<boolean> => {
        if (!adapter.delete) return false;
        return adapter.delete(msgId, recipient);
      };

      draftStream = createSignalDraftStream({
        send,
        delete: deleteMsg,
        config,
        onError: (error) => {
          console.error(`[ContentService] Signal stream error:`, error);
        },
      });
    } else {
      // Generic implementation for other channels
      // For channels that support native editing (Telegram, Discord, Slack)
      let currentMessageId: string | undefined;
      
      draftStream = {
        update: (content: string) => {
          // For non-signal channels, we could use native edit here
          // For now, just buffer the content
          console.log(`[ContentService] ${channel} stream update (buffered)`);
        },
        finalize: async () => {
          const result = await adapter.send(recipient, '');
          return result;
        },
        cancel: async () => {
          if (currentMessageId && adapter.delete) {
            await adapter.delete(currentMessageId, recipient);
          }
        },
        isActive: () => true,
      };
    }

    const contentStream: ContentStream = {
      id: streamId,
      channel,
      recipient,
      draftStream,
      createdAt: Date.now(),
    };

    this.streams.set(streamId, contentStream);
    
    console.log(`[ContentService] Stream created: ${streamId}`);
    
    return { streamId, stream: draftStream };
  }

  /**
   * Get an active stream
   */
  getStream(streamId: string): ContentStream | undefined {
    return this.streams.get(streamId);
  }

  /**
   * Finalize and close a stream
   */
  async finalizeStream(streamId: string): Promise<string | void> {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    const messageId = await stream.draftStream.finalize();
    this.streams.delete(streamId);
    
    return messageId;
  }

  /**
   * Cancel and cleanup a stream
   */
  async cancelStream(streamId: string): Promise<void> {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    await stream.draftStream.cancel();
    this.streams.delete(streamId);
  }

  /**
   * Get a sent message by ID
   */
  getMessage(messageId: string): SentMessage | undefined {
    return this.messages.get(messageId);
  }

  /**
   * Get all messages for a channel/recipient
   */
  getMessages(filter?: { channel?: string; recipient?: string }): SentMessage[] {
    let messages = Array.from(this.messages.values());
    
    if (filter?.channel) {
      messages = messages.filter(m => m.channel === filter.channel);
    }
    if (filter?.recipient) {
      messages = messages.filter(m => m.recipient === filter.recipient);
    }
    
    return messages.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Cleanup old messages (older than specified days)
   */
  cleanupOldMessages(maxAgeDays: number = 7): number {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [id, message] of this.messages) {
      if (message.timestamp < cutoff) {
        this.messages.delete(id);
        cleaned++;
      }
    }

    console.log(`[ContentService] Cleaned up ${cleaned} old messages`);
    return cleaned;
  }
}

// Singleton instance
let contentService: ContentService | null = null;

export function getContentService(): ContentService {
  if (!contentService) {
    contentService = new ContentService();
  }
  return contentService;
}

export function resetContentService(): void {
  contentService = null;
}
