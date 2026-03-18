/**
 * Channel Manager
 * 
 * Manages all channel connections and routes messages between
 * channels and the agent orchestrator.
 * 
 * Features:
 * - Reply dispatcher with queue management
 * - Typing controller with TTL
 * - Command registry for slash commands
 */

import { SignalAdapter } from './adapters/signal';
import { TelegramAdapter } from './adapters/telegram';
import { DiscordAdapter } from './adapters/discord';
import { SlackAdapter } from './adapters/slack';
import type { ChannelAdapter, ChannelMessage, ChannelResponse } from './types';
import type { AgentOrchestrator } from '../agents/orchestrator';
import type { WorkspaceManager } from '../workspace/manager';
import { AutoReplyHandler, IncomingMessage } from '../auto-reply';

export interface ChannelManagerConfig {
  /** Auto-reply configuration */
  autoReply: {
    enabled: boolean;
    defaultAgent: string;
    /** Require mention in groups */
    requireMention?: boolean;
    /** Reply to message (quote) */
    replyToMessage?: boolean;
  };
  /** Typing indicator interval (seconds) */
  typingIntervalSeconds?: number;
  /** Human delay between blocks (ms) */
  humanDelayMs?: number;
}

export class ChannelManager {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private orchestrator: AgentOrchestrator | null = null;
  private workspaceManager?: WorkspaceManager;
  private autoReplyHandler?: AutoReplyHandler;
  private enabledChannels: string[] = [];
  private config: ChannelManagerConfig;

  constructor(channels: string[] = [], config?: Partial<ChannelManagerConfig>) {
    this.enabledChannels = channels;
    this.config = {
      autoReply: {
        enabled: true,
        defaultAgent: 'orchestrator',
        requireMention: true,
        replyToMessage: true,
        ...config?.autoReply,
      },
      typingIntervalSeconds: 6,
      humanDelayMs: 800,
      ...config,
    };
  }

  setOrchestrator(orchestrator: AgentOrchestrator): void {
    this.orchestrator = orchestrator;
    
    // Initialize auto-reply handler
    if (this.config.autoReply.enabled) {
      this.autoReplyHandler = new AutoReplyHandler(orchestrator, {
        enabled: true,
        allowedChannels: this.enabledChannels,
        defaultAgent: this.config.autoReply.defaultAgent,
        requireMention: this.config.autoReply.requireMention,
        replyToMessage: this.config.autoReply.replyToMessage,
        typingIntervalSeconds: this.config.typingIntervalSeconds,
        humanDelayMs: this.config.humanDelayMs,
      });
    }
  }

  setWorkspaceManager(workspaceManager: WorkspaceManager): void {
    this.workspaceManager = workspaceManager;
    if (this.orchestrator) {
      this.orchestrator.setWorkspaceManager(workspaceManager);
    }
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

  /**
   * Register a custom slash command
   */
  registerCommand(
    name: string,
    description: string,
    handler: (ctx: { message: IncomingMessage; args: string[]; sessionId: string }) => Promise<{ text?: string } | null>
  ): void {
    this.autoReplyHandler?.registerCommand(name, description, handler);
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

    if (!this.orchestrator || !this.autoReplyHandler) {
      console.error('[ChannelManager] No orchestrator set');
      return;
    }

    const adapter = this.adapters.get(msg.channel);
    if (!adapter) return;

    // Add "eyes" reaction to acknowledge receipt
    if (adapter.reactToMessage) {
      try {
        await adapter.reactToMessage(msg.id, '👀', msg.metadata?.chatId);
      } catch {
        // Ignore reaction errors
      }
    }

    // Convert to IncomingMessage format
    const incomingMessage: IncomingMessage = {
      id: msg.id,
      channel: msg.channel,
      from: {
        id: msg.from,
        name: msg.from,
      },
      chat: msg.metadata?.chatId ? {
        id: msg.metadata.chatId,
        type: 'private',
      } : undefined,
      text: msg.content,
      replyToMessageId: msg.metadata?.replyToMessageId,
      threadId: msg.metadata?.threadId,
      timestamp: new Date(),
      wasMentioned: msg.metadata?.wasMentioned,
    };

    try {
      // Use new auto-reply handler
      const result = await this.autoReplyHandler.handleMessage(
        incomingMessage,
        // Send typing callback
        async () => {
          if (adapter.sendTyping) {
            await adapter.sendTyping(msg.from, msg.metadata?.threadId);
          }
        },
        // Send reply callback
        async (payload) => {
          await adapter.send(msg.from, payload.text || '', {
            replyToMessageId: payload.replyToMessageId ?? (this.config.autoReply.replyToMessage ? msg.id : undefined),
            threadId: payload.threadId ?? msg.metadata?.threadId,
          });
        },
        // Bot username (for mention checking)
        undefined // TODO: Get bot username from adapter
      );

      // Log tool calls if any
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          const args = JSON.stringify(tc.args).substring(0, 80);
          console.log(`[ChannelManager] 🔧 Tool: ${tc.name}(${args}${args.length > 80 ? '...' : ''})`);
        }
      }

      if (result.content) {
        // Show agent response preview
        const responsePreview = result.content.substring(0, 50).replace(/\n/g, ' ');
        console.log(`[ChannelManager] 🤖 ${responsePreview}${result.content.length > 50 ? '...' : ''}`);
        console.log(`[ChannelManager] 📤 Sent to ${msg.from.split(' ')[0]}`);
        
        // Remove the "eyes" reaction after reply is sent
        if (adapter.removeReaction) {
          try {
            await adapter.removeReaction(msg.id, msg.metadata?.chatId);
          } catch {
            // Ignore removal errors
          }
        }

        return {
          messageId: msg.id,
          content: result.content,
        };
      }
    } catch (error) {
      console.error('[ChannelManager] Error processing message:', error);
      const errorMsg = '❌ Sorry, I encountered an error processing your message.';
      
      // Send error message
      await adapter.send(msg.from, errorMsg);
      
      // Remove the "eyes" reaction after error message
      if (adapter.removeReaction) {
        try {
          await adapter.removeReaction(msg.id, msg.metadata?.chatId);
        } catch {
          // Ignore removal errors
        }
      }
      
      return {
        messageId: msg.id,
        content: errorMsg,
      };
    }
  }
}
