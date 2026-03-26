/**
 * History Compaction
 *
 * Two-level strategy pattern:
 * Level 1 — Pruning: drop oldest message chunks when history > budget
 * Level 2 — Summarization: LLM-assisted compaction for long conversations
 *
 * Repairs orphaned tool_use/tool_result pairs after pruning.
 */

import { AgentMessage } from './types';

const SAFETY_MARGIN = 1.2;
const MAX_HISTORY_SHARE = 0.5; // history should use at most 50% of context window
const DEFAULT_CONTEXT_TOKENS = 128_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: AgentMessage): number {
  return estimateTokens(msg.content);
}

/**
 * Prune conversation history to fit within token budget.
 * Keeps the most recent messages, drops oldest first.
 * Repairs orphaned tool results (tool result without preceding tool call).
 */
export function pruneHistory(params: {
  messages: AgentMessage[];
  maxContextTokens?: number;
  maxHistoryShare?: number;
}): {
  messages: AgentMessage[];
  droppedCount: number;
  keptTokens: number;
} {
  const {
    messages,
    maxContextTokens = DEFAULT_CONTEXT_TOKENS,
    maxHistoryShare = MAX_HISTORY_SHARE,
  } = params;

  if (messages.length === 0) {
    return { messages: [], droppedCount: 0, keptTokens: 0 };
  }

  const budgetTokens = Math.floor((maxContextTokens * maxHistoryShare) / SAFETY_MARGIN);

  // Fill from most recent messages
  const kept: AgentMessage[] = [];
  let usedTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateMessageTokens(msg);
    if (usedTokens + tokens > budgetTokens && kept.length > 0) {
      break; // budget exhausted, stop adding older messages
    }
    usedTokens += tokens;
    kept.unshift(msg);
  }

  const droppedCount = messages.length - kept.length;

  // Repair: if first kept message is a tool result, drop it (orphaned)
  while (kept.length > 0 && kept[0].role === 'tool') {
    kept.shift();
  }

  // Add a summary marker if messages were dropped
  if (droppedCount > 0 && kept.length > 0) {
    const marker: AgentMessage = {
      role: 'system',
      content: `[${droppedCount} earlier messages pruned to save context. Focus on the recent conversation.]`,
      timestamp: new Date(),
    };
    kept.unshift(marker);
  }

  return {
    messages: kept,
    droppedCount,
    keptTokens: usedTokens,
  };
}

/**
 * Build a compact summary of conversation history for injection as context.
 * This is a simpler alternative to LLM-based summarization.
 * Extracts key information: user requests, decisions, active tasks.
 */
export function buildCompactHistorySummary(messages: AgentMessage[]): string {
  if (messages.length === 0) return '';

  const userMessages = messages
    .filter(m => m.role === 'user')
    .slice(-5); // last 5 user messages

  const assistantMessages = messages
    .filter(m => m.role === 'assistant')
    .slice(-3); // last 3 assistant responses

  const lines: string[] = ['[Conversation Summary]'];

  if (userMessages.length > 0) {
    lines.push('Recent user requests:');
    for (const msg of userMessages) {
      const brief = msg.content.slice(0, 100).replace(/\n/g, ' ');
      lines.push(`- ${brief}${msg.content.length > 100 ? '...' : ''}`);
    }
  }

  if (assistantMessages.length > 0) {
    lines.push('Recent responses:');
    for (const msg of assistantMessages) {
      const brief = msg.content.slice(0, 80).replace(/\n/g, ' ');
      lines.push(`- ${brief}${msg.content.length > 80 ? '...' : ''}`);
    }
  }

  return lines.join('\n');
}

/**
 * Estimate total tokens for a list of messages.
 */
export function estimateTotalTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}
