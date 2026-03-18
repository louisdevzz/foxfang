/**
 * Channel Manager
 * 
 * Manages all channel connections and routes messages between
 * channels and the agent orchestrator.
 * 
 * Pattern: ZeroClaw-style handling
 * - Show typing indicator while processing (if supported)
 * - Wait for complete response
 * - Send full response at once (no streaming)
 */

import { SignalAdapter } from './adapters/signal';
import { TelegramAdapter } from './adapters/telegram';
import { DiscordAdapter } from './adapters/discord';
import { SlackAdapter } from './adapters/slack';
import type { ChannelAdapter, ChannelMessage, ChannelResponse } from './types';
import type { AgentOrchestrator } from '../agents/orchestrator';
import { formatForChannel } from './formatters';

export class ChannelManager {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private orchestrator: AgentOrchestrator | null = null;
  private enabledChannels: string[] = [];
  private typingIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(channels: string[] = []) {
    this.enabledChannels = channels;
  }

  setOrchestrator(orchestrator: AgentOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  async connectAll(): Promise<void> {
    for (const channelName of this.enabledChannels) {
      try {
        await this.connectChannel(channelName);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[ChannelManager] ⚠️  ${channelName} not available: ${errorMsg.split('\n')[0]}`);
        console.warn(`[ChannelManager]    Gateway will run without ${channelName}. Start it and restart daemon to enable.`);
      }
    }
  }

  async connectChannel(name: string): Promise<void> {
    if (this.adapters.has(name)) {
      console.log(`[ChannelManager] ${name} already connected`);
      return;
    }

    const adapter = this.createAdapter(name);
    if (!adapter) {
      throw new Error(`Unknown channel: ${name}`);
    }

    adapter.onMessage(async (msg: ChannelMessage) => {
      return this.handleChannelMessage(msg);
    });

    await adapter.connect();
    this.adapters.set(name, adapter);
  }

  async disconnectAll(): Promise<void> {
    // Clear all typing intervals
    for (const [key, interval] of this.typingIntervals) {
      clearInterval(interval);
      console.log(`[ChannelManager] Stopped typing indicator for ${key}`);
    }
    this.typingIntervals.clear();

    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.disconnect();
        console.log(`[ChannelManager] ${name} disconnected`);
      } catch (error) {
        console.error(`[ChannelManager] Error disconnecting ${name}:`, error);
      }
    }
    this.adapters.clear();
  }

  async disconnectChannel(name: string): Promise<void> {
    const adapter = this.adapters.get(name);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(name);
    }
  }

  getConnectedChannels(): string[] {
    return Array.from(this.adapters.keys());
  }

  isConnected(name: string): boolean {
    return this.adapters.has(name);
  }

  private createAdapter(name: string): ChannelAdapter | null {
    switch (name) {
      case 'signal':
        return new SignalAdapter();
      case 'telegram':
        return new TelegramAdapter();
      case 'discord':
        return new DiscordAdapter();
      case 'slack':
        return new SlackAdapter();
      default:
        return null;
    }
  }

  private async handleChannelMessage(msg: ChannelMessage): Promise<ChannelResponse | void> {
    const preview = msg.content.substring(0, 40);
    console.log(`[ChannelManager] 📩 ${msg.channel}:${msg.from.split(' ')[0]}: ${preview}${msg.content.length > 40 ? '...' : ''}`);

    if (!this.orchestrator) {
      console.error('[ChannelManager] No orchestrator set');
      return;
    }

    const adapter = this.adapters.get(msg.channel);
    if (!adapter) return;

    // Add "eyes" reaction to acknowledge receipt (👀 = "I'm looking at this")
    if (adapter.reactToMessage) {
      try {
        await adapter.reactToMessage(msg.id, '👀', msg.metadata?.chatId);
      } catch {
        // Ignore reaction errors
      }
    }

    // Start typing indicator (if supported)
    const typingKey = `${msg.channel}:${msg.from}`;
    await this.startTypingIndicator(adapter, msg.from, typingKey, msg.metadata?.threadId);

    try {
      // Process through agent (NON-STREAMING - wait for complete response)
      const result = await this.orchestrator.run({
        sessionId: `channel-${msg.channel}-${msg.from}`,
        agentId: 'orchestrator',
        message: `[From ${msg.channel}:${msg.from}] ${msg.content}`,
        stream: false,
      });

      // Stop typing indicator
      this.stopTypingIndicator(typingKey);

      // Log tool calls if any
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          const args = JSON.stringify(tc.arguments).substring(0, 80);
          console.log(`[ChannelManager] 🔧 Tool: ${tc.name}(${args}${args.length > 80 ? '...' : ''})`);
        }
      }

      if (result.content) {
        // Show agent response preview
        const responsePreview = result.content.substring(0, 50).replace(/\n/g, ' ');
        console.log(`[ChannelManager] 🤖 ${responsePreview}${result.content.length > 50 ? '...' : ''}`);
        
        // Remove the "eyes" reaction before sending reply
        if (adapter.removeReaction) {
          try {
            await adapter.removeReaction(msg.id, msg.metadata?.chatId);
          } catch {
            // Ignore removal errors
          }
        }
        
        // Format content for the specific channel
        const formattedContent = formatForChannel(result.content, msg.channel);
        
        // Send complete response
        await adapter.send(msg.from, formattedContent);
        console.log(`[ChannelManager] 📤 Sent to ${msg.from.split(' ')[0]}`);

        return {
          messageId: msg.id,
          content: result.content,
        };
      }
    } catch (error) {
      // Stop typing indicator on error
      this.stopTypingIndicator(typingKey);
      
      // Remove the "eyes" reaction on error
      if (adapter.removeReaction) {
        try {
          await adapter.removeReaction(msg.id, msg.metadata?.chatId);
        } catch {
          // Ignore removal errors
        }
      }
      
      console.error('[ChannelManager] Error processing message:', error);
      const errorMsg = 'Sorry, I encountered an error processing your message.';
      await adapter.send(msg.from, errorMsg);
      
      return {
        messageId: msg.id,
        content: errorMsg,
      };
    }
  }

  /**
   * Start typing indicator for a recipient
   * Typing indicators expire after a few seconds, so we need to repeat them
   */
  private async startTypingIndicator(
    adapter: ChannelAdapter, 
    recipient: string, 
    key: string,
    threadId?: string
  ): Promise<void> {
    if (!adapter.sendTyping) {
      // Channel doesn't support typing indicators
      return;
    }

    // Send immediately
    try {
      await adapter.sendTyping(recipient, threadId);
    } catch {
      // Ignore errors for typing indicators
    }

    // Repeat every 4 seconds (typing indicators usually expire after ~5s)
    const interval = setInterval(async () => {
      try {
        await adapter.sendTyping!(recipient, threadId);
      } catch {
        // Ignore errors
      }
    }, 4000);

    this.typingIntervals.set(key, interval);
  }

  /**
   * Stop typing indicator for a recipient
   */
  private stopTypingIndicator(key: string): void {
    const interval = this.typingIntervals.get(key);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(key);
    }
  }
}
