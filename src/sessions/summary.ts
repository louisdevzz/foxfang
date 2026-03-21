import type { SessionSummary } from '../agents/types';
import type { SessionMessage } from './manager';

const MAX_ENTRY_LENGTH = 240;

function compactLine(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, MAX_ENTRY_LENGTH);
}

function pickRecentByRole(messages: SessionMessage[], role: SessionMessage['role'], max: number): string[] {
  return messages
    .filter((msg) => msg.role === role && typeof msg.content === 'string' && msg.content.trim().length > 0)
    .slice(-max)
    .map((msg) => compactLine(msg.content));
}

function extractConstraints(messages: SessionMessage[]): string[] {
  const patterns = ['must', 'should', 'do not', 'không', 'phải', 'cần'];
  const recentUsers = pickRecentByRole(messages, 'user', 8);
  const constraints = recentUsers.filter((line) => {
    const normalized = line.toLowerCase();
    return patterns.some((token) => normalized.includes(token));
  });
  return constraints.slice(0, 5);
}

function extractDecisions(messages: SessionMessage[]): string[] {
  const patterns = ['we will', 'decide', 'chọn', 'quyết định', 'sẽ làm', 'implemented'];
  const recentAssistant = pickRecentByRole(messages, 'assistant', 8);
  const decisions = recentAssistant.filter((line) => {
    const normalized = line.toLowerCase();
    return patterns.some((token) => normalized.includes(token));
  });
  return decisions.slice(0, 5);
}

function extractOpenLoops(messages: SessionMessage[]): string[] {
  const recentUsers = pickRecentByRole(messages, 'user', 6);
  return recentUsers
    .filter((line) => line.includes('?'))
    .slice(0, 5);
}

export function buildRollingSessionSummary(
  messages: SessionMessage[],
  previous?: SessionSummary,
): SessionSummary {
  const recentUsers = pickRecentByRole(messages, 'user', 2);
  const latestGoal = recentUsers[recentUsers.length - 1] || previous?.currentGoal || '';

  return {
    currentGoal: latestGoal,
    importantDecisions: extractDecisions(messages),
    activeConstraints: extractConstraints(messages),
    openLoops: extractOpenLoops(messages),
    brandContext: previous?.brandContext,
  };
}

export function formatSessionSummary(summary?: SessionSummary): string {
  if (!summary) return '';

  const lines: string[] = [];
  if (summary.currentGoal) lines.push(`Current goal: ${summary.currentGoal}`);
  if (summary.importantDecisions.length > 0) {
    lines.push(`Important decisions: ${summary.importantDecisions.join(' | ')}`);
  }
  if (summary.activeConstraints.length > 0) {
    lines.push(`Active constraints: ${summary.activeConstraints.join(' | ')}`);
  }
  if (summary.openLoops.length > 0) {
    lines.push(`Open loops: ${summary.openLoops.join(' | ')}`);
  }
  if (summary.brandContext) {
    lines.push(`Brand context: ${compactLine(summary.brandContext)}`);
  }

  return lines.join('\n');
}
