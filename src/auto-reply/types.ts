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
  }>;
  /** For replies/threads */
  replyToMessageId?: string;
  threadId?: string;
  timestamp: Date;
  /** Whether bot was mentioned (for group chats) */
  wasMentioned?: boolean;
  /** Command prefix if present (/command) */
  command?: string;
}

export interface AutoReplyConfig {
  enabled: boolean;
  defaultAgent: string;
  allowedChannels: string[];
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
}

export type CommandHandler = (ctx: CommandContext) => Promise<ReplyPayload | null>;

export interface CommandRegistry {
  name: string;
  description: string;
  handler: CommandHandler;
  /** Whether command requires auth/ownership */
  requireAuth?: boolean;
}
