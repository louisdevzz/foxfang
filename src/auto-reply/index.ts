/**
 * Auto-Reply System
 * 
 * Features:
 * - Reply dispatcher with queue management
 * - Typing controller with TTL
 * - Command registry for slash commands
 * - Session management per channel
 * - Tool result streaming
 */

import { AgentOrchestrator } from '../agents/orchestrator';
import { createReplyDispatcher } from './dispatcher';
import { createTypingController } from './typing';
import { CommandRegistryManager, registerBuiltinCommands } from './commands';
import { 
  IncomingMessage, 
  ReplyPayload, 
  AutoReplyConfig,
  CommandContext 
} from './types';

// Re-export types
export * from './types';
export { createReplyDispatcher, ReplyDispatcher } from './dispatcher';
export { createTypingController } from './typing';
export { CommandRegistryManager, registerBuiltinCommands } from './commands';

export interface HandleMessageResult {
  content?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
  error?: string;
}

/**
 * AutoReplyHandler - Main entry point for auto-reply system
 */
export class AutoReplyHandler {
  private orchestrator: AgentOrchestrator;
  private config: AutoReplyConfig;
  private commandRegistry: CommandRegistryManager;
  private typingControllers: Map<string, ReturnType<typeof createTypingController>> = new Map();
  private sessions: Map<string, { messageCount: number; lastActivity: Date }> = new Map();

  constructor(orchestrator: AgentOrchestrator, config: AutoReplyConfig) {
    this.orchestrator = orchestrator;
    this.config = config;
    this.commandRegistry = new CommandRegistryManager();
    registerBuiltinCommands(this.commandRegistry);
  }

  /**
   * Get or create typing controller for a session
   */
  private getTypingController(
    sessionKey: string,
    sendTyping: () => Promise<void>
  ): ReturnType<typeof createTypingController> {
    let controller = this.typingControllers.get(sessionKey);
    if (!controller) {
      controller = createTypingController({
        onReplyStart: sendTyping,
        onCleanup: () => {
          this.typingControllers.delete(sessionKey);
        },
        typingIntervalSeconds: this.config.typingIntervalSeconds ?? 6,
        typingTtlMs: 2 * 60 * 1000, // 2 min TTL
      });
      this.typingControllers.set(sessionKey, controller);
    }
    return controller;
  }

  /**
   * Check if we should reply to this message
   */
  shouldReply(message: IncomingMessage, botUsername?: string): boolean {
    if (!this.config.enabled) return false;
    if (!this.config.allowedChannels.includes(message.channel)) return false;

    // Check mention requirement for groups
    if (this.config.requireMention && message.chat?.type !== 'private') {
      const wasMentioned = message.text?.includes(`@${botUsername}`) || message.wasMentioned;
      if (!wasMentioned) return false;
    }

    return true;
  }

  /**
   * Handle incoming message and generate reply
   */
  async handleMessage(
    message: IncomingMessage,
    sendTyping: () => Promise<void>,
    sendReply: (payload: ReplyPayload) => Promise<void>,
    botUsername?: string
  ): Promise<HandleMessageResult> {
    if (!this.shouldReply(message, botUsername)) {
      return {};
    }

    const sessionKey = `channel-${message.channel}-${message.from.id}`;
    const sessionId = `channel-${message.channel}-${message.from.id}`;

    // Track session
    this.sessions.set(sessionKey, {
      messageCount: (this.sessions.get(sessionKey)?.messageCount ?? 0) + 1,
      lastActivity: new Date(),
    });

    try {
      // Check if it's a command
      if (message.text && this.commandRegistry.isCommand(message.text)) {
        const commandResult = await this.commandRegistry.execute({
          message,
          args: [],
          sessionId,
        });

        if (commandResult) {
          await sendReply(commandResult);
          return { content: commandResult.text };
        }
      }

      // Setup typing controller
      const typingController = this.getTypingController(sessionKey, sendTyping);
      
      // Create dispatcher
      const dispatcher = createReplyDispatcher({
        deliver: async (payload, info) => {
          await sendReply(payload);
        },
        humanDelayMs: this.config.humanDelayMs ?? 800,
        onIdle: () => {
          typingController.markDispatchIdle();
        },
      });

      // Start typing
      await typingController.startTypingLoop();

      // Run agent
      const result = await this.orchestrator.run({
        sessionId,
        agentId: this.config.defaultAgent,
        message: message.text || '[Media message]',
        stream: false,
      });

      // Mark run complete
      typingController.markRunComplete();

      // Send final reply
      if (result.content) {
        const payload: ReplyPayload = {
          text: result.content,
          replyToMessageId: this.config.replyToMessage ? message.id : undefined,
          threadId: message.threadId,
        };
        dispatcher.sendFinalReply(payload);
      }

      // Mark dispatcher complete and wait
      dispatcher.markComplete();
      await dispatcher.waitForIdle();

      return {
        content: result.content,
        toolCalls: result.toolCalls?.map(tc => ({
          name: tc.name,
          args: tc.arguments,
        })),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Auto-reply failed:', error);
      
      const errorPayload: ReplyPayload = {
        text: '❌ Sorry, I encountered an error processing your message.',
        replyToMessageId: message.id,
      };
      await sendReply(errorPayload);
      
      return { error: errorMsg };
    }
  }

  /**
   * Register a custom command
   */
  registerCommand(name: string, description: string, handler: (ctx: CommandContext) => Promise<ReplyPayload | null>): void {
    this.commandRegistry.register({
      name,
      description,
      handler,
    });
  }

  /**
   * Get session stats
   */
  getSessionStats(): { totalSessions: number; totalMessages: number } {
    let totalMessages = 0;
    for (const session of this.sessions.values()) {
      totalMessages += session.messageCount;
    }
    return {
      totalSessions: this.sessions.size,
      totalMessages,
    };
  }

  /**
   * Clear all sessions
   */
  clearSessions(): void {
    this.sessions.clear();
  }
}

/**
 * Legacy function for simple use cases
 */
export async function handleIncomingMessage(
  message: IncomingMessage,
  orchestrator: AgentOrchestrator,
  config: AutoReplyConfig
): Promise<string | null> {
  const handler = new AutoReplyHandler(orchestrator, config);
  const result = await handler.handleMessage(
    message,
    async () => {}, // No typing indicator
    async (payload) => {}, // No reply sender
  );
  return result.content || null;
}

/**
 * Check if message should be processed (legacy)
 */
export function shouldReply(
  message: IncomingMessage,
  config: AutoReplyConfig,
  botUsername?: string
): boolean {
  const handler = new AutoReplyHandler({} as AgentOrchestrator, config);
  return handler.shouldReply(message, botUsername);
}
