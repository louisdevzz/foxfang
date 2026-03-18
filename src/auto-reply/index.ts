/**
 * Auto-Reply System
 * 
 * Handles automatic responses to incoming messages from channels.
 */

import { AgentOrchestrator } from '../agents/orchestrator';
import { SessionManager } from '../sessions/manager';

export interface IncomingMessage {
  id: string;
  channel: string; // 'telegram', 'discord', etc.
  from: {
    id: string;
    username?: string;
    name?: string;
  };
  text: string;
  timestamp: Date;
}

export interface AutoReplyConfig {
  enabled: boolean;
  defaultAgent: string;
  allowedChannels: string[];
  requireMention?: boolean;
}

/**
 * Process incoming message and generate reply
 */
export async function handleIncomingMessage(
  message: IncomingMessage,
  orchestrator: AgentOrchestrator,
  config: AutoReplyConfig
): Promise<string | null> {
  if (!config.enabled) {
    return null;
  }

  if (!config.allowedChannels.includes(message.channel)) {
    return null;
  }

  // Create or get session for this user
  const sessionId = `channel-${message.channel}-${message.from.id}`;

  try {
    const result = await orchestrator.run({
      sessionId,
      agentId: config.defaultAgent,
      message: message.text,
    });

    return result.content;
  } catch (error) {
    console.error('Auto-reply failed:', error);
    return 'Sorry, I encountered an error processing your message.';
  }
}

/**
 * Check if message should be processed
 */
export function shouldReply(
  message: IncomingMessage,
  config: AutoReplyConfig,
  botUsername?: string
): boolean {
  if (!config.enabled) return false;
  if (!config.allowedChannels.includes(message.channel)) return false;

  // If requireMention is set, check if bot was mentioned
  if (config.requireMention && botUsername) {
    const wasMentioned = message.text.includes(`@${botUsername}`);
    if (!wasMentioned) return false;
  }

  return true;
}
