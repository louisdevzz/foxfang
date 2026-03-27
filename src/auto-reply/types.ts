/**
 * Auto-Reply Types
 * 
 * Type definitions for the auto-reply system.
 */

export interface ReplyPayload {
  /** Text content */
  text?: string;
  /** Media URL (image, video) */
  mediaUrl?: string;
  /** Audio URL (voice message) */
  audioUrl?: string;
  /** Send as voice message (if audio) */
  audioAsVoice?: boolean;
  /** Reply to message ID */
  replyToMessageId?: string;
  /** Thread ID for threaded channels */
  threadId?: string;
  /** Channel-specific data */
  channelData?: Record<string, unknown>;
}

export interface IncomingMessage {
  id: string;
  channel: string; // 'telegram', 'discord', 'slack', 'signal'
  from: {
    id: string;
    username?: string;
    name?: string;
  };
  chat?: {
    id: string;
    type: 'private' | 'group' | 'channel';
    title?: string;
  };
  text?: string;
  /** Media attachments */
  media?: Array<{
    type: 'photo' | 'video' | 'audio' | 'document' | 'voice';
    url?: string;
    fileId?: string;
    caption?: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    localPath?: string;
    extractedText?: string;
    extractionMethod?: string;
    extractionError?: string;
  }>;
  /** For replies/threads */
  replyToMessageId?: string;
  threadId?: string;
  timestamp: Date;
  /** Whether bot was mentioned (for group chats) */
  wasMentioned?: boolean;
  /** Whether mention detection is available for this channel message */
  canDetectMention?: boolean;
  /** Command prefix if present (/command) */
  command?: string;
  /** Raw channel metadata for routing/bindings */
  metadata?: Record<string, unknown>;
}

export type AutoReplySessionScope = 'from' | 'chat' | 'thread' | 'chat-thread';

export interface AutoReplyBinding {
  /** Optional stable ID for observability/debugging */
  id?: string;
  /** Disable a binding without removing it */
  enabled?: boolean;
  /** Higher number = higher precedence (default 0) */
  priority?: number;
  /** Match specific channel */
  channel?: 'telegram' | 'discord' | 'slack' | 'signal' | string;
  /** Match chat kind */
  chatType?: 'private' | 'group' | 'channel';
  /** Match chat IDs (single or list) */
  chatId?: string | string[];
  /** Match thread IDs (single or list) */
  threadId?: string | string[];
  /** Match sender IDs (single or list) */
  fromId?: string | string[];
  /** Match connected account/bot identity (single or list) */
  accountId?: string | string[];
  /** Match raw metadata keys by exact value */
  metadata?: Record<string, string | string[]>;
  /** Agent selected when this binding matches */
  agentId: string;
  /** Session grouping mode for this binding */
  sessionScope?: AutoReplySessionScope;
}

export interface AutoReplyConfig {
  enabled: boolean;
  defaultAgent: string;
  allowedChannels: string[];
  bindings?: AutoReplyBinding[];
  defaultSessionScope?: AutoReplySessionScope;
  /** Require mention in group chats */
  requireMention?: boolean;
  /** Typing indicator interval (seconds) */
  typingIntervalSeconds?: number;
  /** Human-like delay between message blocks (ms) */
  humanDelayMs?: number;
  /** Reply to message (quote) by default */
  replyToMessage?: boolean;
}

export interface TypingController {
  onReplyStart: () => Promise<void>;
  startTypingLoop: () => Promise<void>;
  refreshTypingTtl: () => void;
  isActive: () => boolean;
  markRunComplete: () => void;
  markDispatchIdle: () => void;
  cleanup: () => void;
}

export interface CommandContext {
  message: IncomingMessage;
  args: string[];
  sessionId: string;
  /** Send an async reply back to the originating channel (used for deferred responses) */
  sendReply?: (payload: ReplyPayload) => Promise<void>;
}

export type CommandHandler = (ctx: CommandContext) => Promise<ReplyPayload | null>;

export interface CommandRegistry {
  name: string;
  description: string;
  handler: CommandHandler;
  /** Whether command requires auth/ownership */
  requireAuth?: boolean;
}
