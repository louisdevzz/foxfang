import { ReasoningMode, TokenBudget } from './types';

function modeMultiplier(mode: ReasoningMode): number {
  if (mode === 'fast') return 0.8;
  if (mode === 'deep') return 1.35;
  return 1;
}

export function resolveTokenBudget(params: {
  agentId: string;
  mode?: ReasoningMode;
}): TokenBudget {
  const mode = params.mode || 'balanced';
  const mult = modeMultiplier(mode);

  const baseByProfile: Record<'orchestrator' | 'specialist' | 'reviewer', Omit<TokenBudget, 'remainingInputTokens' | 'remainingOutputTokens'>> = {
    orchestrator: {
      requestMaxInputTokens: 12000,
      requestMaxOutputTokens: 2048,
      maxToolIterations: 5,
      maxDelegations: 1,
      maxReviewPasses: 0,
    },
    specialist: {
      requestMaxInputTokens: 8000,
      requestMaxOutputTokens: 2048,
      maxToolIterations: 5,
      maxDelegations: 0,
      maxReviewPasses: 0,
    },
    reviewer: {
      requestMaxInputTokens: 8000,
      requestMaxOutputTokens: 2048,
      maxToolIterations: 3,
      maxDelegations: 0,
      maxReviewPasses: 0,
    },
  };

  const normalizedAgentId = (params.agentId || '').toLowerCase();
  const profile = normalizedAgentId === 'orchestrator'
    ? 'orchestrator'
    : /(review|reviewer|analyst|analysis|audit|qa|quality|critic)/i.test(normalizedAgentId)
      ? 'reviewer'
      : 'specialist';

  const base = baseByProfile[profile];

  const requestMaxInputTokens = Math.floor(base.requestMaxInputTokens * mult);
  const requestMaxOutputTokens = Math.floor(base.requestMaxOutputTokens * mult);

  return {
    ...base,
    requestMaxInputTokens,
    requestMaxOutputTokens,
    remainingInputTokens: requestMaxInputTokens,
    remainingOutputTokens: requestMaxOutputTokens,
  };
}

function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

export function trimMessagesToBudget<T extends { role: string; content: string }>(
  messages: T[],
  maxInputTokens: number,
) {
  // ALWAYS keep the system message (first message if role=system) — never drop it.
  const systemMessages: T[] = [];
  const otherMessages: T[] = [];
  let systemTokens = 0;

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg);
      systemTokens += estimateTokensFromText(msg.content);
    } else {
      otherMessages.push(msg);
    }
  }

  // Budget remaining after system messages
  const remainingBudget = Math.max(0, maxInputTokens - systemTokens);

  // Fill from most recent non-system messages
  const kept: T[] = [];
  let used = 0;
  for (let idx = otherMessages.length - 1; idx >= 0; idx -= 1) {
    const msg = otherMessages[idx];
    const tokens = estimateTokensFromText(msg.content);
    if (used + tokens > remainingBudget) {
      continue;
    }
    used += tokens;
    kept.unshift(msg);
  }

  return {
    messages: [...systemMessages, ...kept],
    usedTokens: systemTokens + used,
  };
}
