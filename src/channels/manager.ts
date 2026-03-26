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
import { AutoReplyBinding, AutoReplyHandler, IncomingMessage } from '../auto-reply';

export interface ChannelManagerConfig {
  /** Auto-reply configuration */
  autoReply: {
    enabled: boolean;
    defaultAgent: string;
    defaultSessionScope?: 'from' | 'chat' | 'thread' | 'chat-thread';
    bindings?: AutoReplyBinding[];
    /** Require mention in groups */
    requireMention?: boolean;
    /** Per-channel mention policy in groups/channels */
    requireMentionByChannel?: Partial<Record<'telegram' | 'discord' | 'slack' | 'signal', boolean>>;
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
        defaultAgent: 'main',
        defaultSessionScope: 'chat-thread',
        bindings: [],
        requireMention: false,
        requireMentionByChannel: {},
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
        defaultSessionScope: this.config.autoReply.defaultSessionScope,
        bindings: this.config.autoReply.bindings || [],
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
    if (!this.orchestrator || !this.autoReplyHandler) {
      console.error('[ChannelManager] No orchestrator set');
      return;
    }

    const adapter = this.adapters.get(msg.channel);
    if (!adapter) return;
    const chatType = this.normalizeChatType(msg.metadata?.chatType ?? msg.metadata?.channelType);
    const chatKind = chatType === 'private' ? 'dm' : chatType;
    const chatId = this.resolveChatId(msg);
    const replyTarget = this.resolveReplyTarget(msg);
    const botUsername = this.resolveBotUsername(adapter);
    const threadId = this.resolveThreadId(msg);
    const wasMentioned = msg.metadata?.wasMentioned;
    const canDetectMention = msg.metadata?.canDetectMention;
    const preview = msg.content.substring(0, 40);

    console.log(
      `[ChannelManager] 📩 ${msg.channel}:${chatKind}:${msg.from.split(' ')[0]}: ` +
      `${preview}${msg.content.length > 40 ? '...' : ''}`
    );
    console.log(
      `[ChannelManager] 🧭 route channel=${msg.channel} kind=${chatKind} ` +
      `thread=${threadId || '-'} ` +
      `mention=${wasMentioned === true ? 'yes' : wasMentioned === false ? 'no' : 'unknown'} ` +
      `detectMention=${canDetectMention === true ? 'yes' : canDetectMention === false ? 'no' : 'unknown'}`
    );

    if (!replyTarget) {
      console.warn(
        `[ChannelManager] ⚠️ Cannot determine reply target for ${msg.channel} (${chatKind}); skipping auto-reply`
      );
      return;
    }

    // Resolve sender info early — needed for reactions and IncomingMessage
    const msgMetadata = msg.metadata || {};
    const senderId = String(msgMetadata.senderId || msgMetadata.userId || msgMetadata.authorId || msg.from || '');

    // Add "eyes" reaction to acknowledge receipt
    if (adapter.reactToMessage) {
      try {
        await adapter.reactToMessage(msg.id, '👀', chatId, senderId);
      } catch {
        // Ignore reaction errors
      }
    }

    // Convert to IncomingMessage format
    const metadata = msgMetadata;
    const senderName = String(metadata.senderName || msg.from || 'Unknown');
    const incomingMessage: IncomingMessage = {
      id: msg.id,
      channel: msg.channel,
      from: {
        id: senderId,
        name: senderName,
      },
      chat: {
        id: chatId || msg.from,
        type: chatType,
      },
      text: msg.content,
      replyToMessageId: msg.metadata?.replyToMessageId,
      threadId,
      timestamp: new Date(),
      wasMentioned: msg.metadata?.wasMentioned,
      canDetectMention: msg.metadata?.canDetectMention,
      metadata: {
        ...(msg.metadata || {}),
        accountId: this.resolveAccountId(msg.channel, adapter),
      },
    };

    try {
      // Use new auto-reply handler
      const result = await this.autoReplyHandler.handleMessage(
        incomingMessage,
        // Send typing callback
        async () => {
          if (adapter.sendTyping) {
            await adapter.sendTyping(replyTarget, this.resolveThreadId(msg));
          }
        },
        // Send reply callback
        async (payload) => {
          await adapter.send(replyTarget, payload.text || '', {
            replyToMessageId: payload.replyToMessageId ?? (this.config.autoReply.replyToMessage ? msg.id : undefined),
            threadId: payload.threadId ?? this.resolveThreadId(msg),
          });
        },
        // Bot username (for mention checking)
        botUsername,
        this.shouldRequireMention(msg.channel)
      );

      // Log tool calls if any
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          const args = JSON.stringify(tc.args).substring(0, 80);
          console.log(`[ChannelManager] 🔧 Tool: ${tc.name}(${args}${args.length > 80 ? '...' : ''})`);
        }
      }

      if (result.content) {
        if (result.route) {
          console.log(
            `[ChannelManager] 🧠 routed agent=${result.route.agentId} session=${result.route.sessionId}` +
            `${result.route.bindingId ? ` binding=${result.route.bindingId}` : ''}`
          );
        }
        // Show agent response preview
        const responsePreview = result.content.substring(0, 50).replace(/\n/g, ' ');
        console.log(`[ChannelManager] 🤖 ${responsePreview}${result.content.length > 50 ? '...' : ''}`);
        console.log(
          `[ChannelManager] 📤 Sent channel=${msg.channel} kind=${chatKind}` +
          `${threadId ? ` thread=${threadId}` : ''}`
        );
        
        // Remove the "eyes" reaction after reply is sent
        if (adapter.removeReaction) {
          try {
            await adapter.removeReaction(msg.id, chatId, senderId);
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
      await adapter.send(replyTarget, errorMsg);
      
      // Remove the "eyes" reaction after error message
      if (adapter.removeReaction) {
        try {
          await adapter.removeReaction(msg.id, chatId, senderId);
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

  private normalizeChatType(rawType: unknown): 'private' | 'group' | 'channel' {
    if (typeof rawType !== 'string') return 'private';

    const normalized = rawType.trim().toLowerCase();
    if (!normalized) return 'private';

    if (['private', 'dm', 'im', 'direct'].includes(normalized)) return 'private';
    if (['channel', 'text', 'announcement'].includes(normalized)) return 'channel';
    if (['group', 'supergroup', 'mpim'].includes(normalized)) return 'group';

    // Discord guild channels and Slack public/private channels should be treated as non-DM.
    if (normalized.includes('channel') || normalized.includes('guild')) return 'channel';
    return 'group';
  }

  private resolveChatId(msg: ChannelMessage): string | undefined {
    const metadata = msg.metadata || {};
    const value = metadata.chatId ?? metadata.channelId;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private resolveReplyTarget(msg: ChannelMessage): string {
    const metadata = msg.metadata || {};
    const explicitTarget = metadata.replyTarget ?? metadata.target;
    if (typeof explicitTarget === 'string' && explicitTarget.trim()) return explicitTarget.trim();

    const sourcePhone = typeof metadata.sourcePhone === 'string' ? metadata.sourcePhone.trim() : '';
    if (sourcePhone) return sourcePhone;

    const sourceUuid = typeof metadata.sourceUuid === 'string' ? metadata.sourceUuid.trim() : '';
    if (sourceUuid) return sourceUuid;

    const chatType = this.normalizeChatType(metadata.chatType ?? metadata.channelType);
    if (msg.channel === 'signal' && chatType === 'private') {
      return '';
    }

    const chatId = this.resolveChatId(msg);
    if (chatId) return chatId;

    return msg.from;
  }

  private resolveThreadId(msg: ChannelMessage): string | undefined {
    const metadata = msg.metadata || {};
    const value = metadata.threadId ?? metadata.threadTs ?? msg.threadId;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private resolveBotUsername(adapter: ChannelAdapter): string | undefined {
    const maybeInfo = (adapter as any).getBotInfo?.();
    if (!maybeInfo || typeof maybeInfo !== 'object') return undefined;

    if (typeof maybeInfo.username === 'string' && maybeInfo.username.trim()) {
      return maybeInfo.username.trim();
    }
    if (typeof maybeInfo.name === 'string' && maybeInfo.name.trim()) {
      return maybeInfo.name.trim();
    }
    return undefined;
  }

  private resolveAccountId(channel: string, adapter: ChannelAdapter): string | undefined {
    if (channel === 'signal') {
      const signalPhone = (adapter as any).phoneNumber;
      if (typeof signalPhone === 'string' && signalPhone.trim()) {
        return signalPhone.trim();
      }
    }

    const maybeInfo = (adapter as any).getBotInfo?.();
    if (!maybeInfo || typeof maybeInfo !== 'object') return undefined;

    const id = (maybeInfo as any).id;
    if (typeof id === 'string' && id.trim()) return id.trim();

    const username = (maybeInfo as any).username ?? (maybeInfo as any).name;
    if (typeof username === 'string' && username.trim()) return username.trim();

    return undefined;
  }

  private shouldRequireMention(channel: string): boolean {
    const byChannel = this.config.autoReply.requireMentionByChannel || {};
    const channelKey = channel as keyof typeof byChannel;
    const channelValue = byChannel[channelKey];
    if (typeof channelValue === 'boolean') {
      return channelValue;
    }
    return Boolean(this.config.autoReply.requireMention);
  }
}
