import { AgentHandoff, AgentMessage, AgentRoute, OutputSpec } from './types';
import { Context } from '../context-engine';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { resolveFoxFangHome } from '../config/defaults';
import { loadConfig } from '../config/index';
import { getProvider, getProviderConfig } from '../providers/index';
import { agentRegistry } from './registry';

type RoutingRule = {
  agentId: AgentRoute['primaryAgent'];
  taskType: string;
  keywords: string[];
  needsReview?: boolean;
};

type RoutingPolicy = {
  defaultAgent: AgentRoute['primaryAgent'];
  rules: RoutingRule[];
  outputModeHints: {
    short: string[];
    deep: string[];
  };
  toolTriggers: string[];
  reviewTriggers: string[];
  highStakesTriggers: string[];
};

type ConfigRoutingShape = {
  agentRuntime?: {
    routing?: Partial<RoutingPolicy>;
  };
};

const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  defaultAgent: 'content-specialist',
  rules: [],
  outputModeHints: {
    short: ['short', 'brief', 'summary'],
    deep: ['deep', 'detailed', 'in-depth'],
  },
  toolTriggers: ['search', 'research', 'source', 'read link', 'check url'],
  reviewTriggers: ['review', 'optimize', 'improve', 'analyze', 'audit'],
  highStakesTriggers: ['launch', 'critical', 'important', 'brand-sensitive', 'public'],
};

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function sanitizeRule(value: unknown): RoutingRule | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const agentId = obj.agentId;
  const taskType = obj.taskType;
  const keywords = obj.keywords;
  if (
    (agentId !== 'content-specialist' && agentId !== 'strategy-lead' && agentId !== 'growth-analyst')
    || typeof taskType !== 'string'
    || !Array.isArray(keywords)
  ) {
    return null;
  }
  const cleanedKeywords = keywords
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
  if (cleanedKeywords.length === 0) return null;
  return {
    agentId,
    taskType: taskType.trim() || 'general',
    keywords: cleanedKeywords,
    needsReview: obj.needsReview === true,
  };
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : fallback;
}

function loadRoutingPolicy(): RoutingPolicy {
  const candidates = [
    join(resolveFoxFangHome(), 'foxfang.json'),
    join(process.cwd(), '.foxfang', 'foxfang.json'),
    join(homedir(), '.foxfang', 'foxfang.json'),
  ];

  for (const configFile of candidates) {
    if (!existsSync(configFile)) continue;
    try {
      const raw = JSON.parse(readFileSync(configFile, 'utf-8')) as ConfigRoutingShape;
      const configured = raw?.agentRuntime?.routing;
      if (!configured || typeof configured !== 'object') continue;

      const parsedRules = Array.isArray(configured.rules)
        ? configured.rules.map(sanitizeRule).filter((rule): rule is RoutingRule => Boolean(rule))
        : [];
      const defaultAgent = configured.defaultAgent;
      const safeDefaultAgent = (
        defaultAgent === 'content-specialist'
        || defaultAgent === 'strategy-lead'
        || defaultAgent === 'growth-analyst'
      )
        ? defaultAgent
        : DEFAULT_ROUTING_POLICY.defaultAgent;

      return {
        defaultAgent: safeDefaultAgent,
        rules: parsedRules.length > 0 ? parsedRules : DEFAULT_ROUTING_POLICY.rules,
        outputModeHints: {
          short: normalizeStringArray(configured.outputModeHints?.short, DEFAULT_ROUTING_POLICY.outputModeHints.short),
          deep: normalizeStringArray(configured.outputModeHints?.deep, DEFAULT_ROUTING_POLICY.outputModeHints.deep),
        },
        toolTriggers: normalizeStringArray(configured.toolTriggers, DEFAULT_ROUTING_POLICY.toolTriggers),
        reviewTriggers: normalizeStringArray(configured.reviewTriggers, DEFAULT_ROUTING_POLICY.reviewTriggers),
        highStakesTriggers: normalizeStringArray(configured.highStakesTriggers, DEFAULT_ROUTING_POLICY.highStakesTriggers),
      };
    } catch {
      // Try next candidate
    }
  }
  return DEFAULT_ROUTING_POLICY;
}

function detectOutputMode(text: string, policy: RoutingPolicy): 'short' | 'normal' | 'deep' {
  const normalized = normalizeText(text);
  if (policy.outputModeHints.deep.some((hint) => normalized.includes(hint))) {
    return 'deep';
  }
  if (policy.outputModeHints.short.some((hint) => normalized.includes(hint))) {
    return 'short';
  }
  return 'normal';
}

function detectNeedsTools(text: string, policy: RoutingPolicy): boolean {
  const normalized = normalizeText(text);
  return (
    /https?:\/\/[^\s]+/i.test(text)
    || policy.toolTriggers.some((hint) => normalized.includes(hint))
  );
}

function detectNeedsReview(params: {
  text: string;
  outputMode: 'short' | 'normal' | 'deep';
  policy: RoutingPolicy;
  matchedRule?: RoutingRule;
}): boolean {
  const normalized = normalizeText(params.text);
  const explicitReview = params.policy.reviewTriggers.some((hint) => normalized.includes(hint));
  const highStakes = params.policy.highStakesTriggers.some((hint) => normalized.includes(hint));
  const forcedByRule = params.matchedRule?.needsReview === true;
  const deepMode = params.outputMode === 'deep';
  return explicitReview || highStakes || forcedByRule || deepMode;
}

function scoreRule(normalizedMessage: string, rule: RoutingRule): number {
  let score = 0;
  for (const keyword of rule.keywords) {
    if (!keyword) continue;
    if (normalizedMessage.includes(keyword)) {
      score += keyword.includes(' ') ? 2 : 1;
    }
  }
  return score;
}

function resolveMatchedRule(message: string, policy: RoutingPolicy): RoutingRule | undefined {
  const normalized = normalizeText(message);
  let best: { rule: RoutingRule; score: number } | null = null;
  for (const rule of policy.rules) {
    const score = scoreRule(normalized, rule);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { rule, score };
    }
  }
  return best?.rule;
}

function inferTaskType(params: {
  message: string;
  policy: RoutingPolicy;
  matchedRule?: RoutingRule;
}): string {
  if (params.matchedRule) return params.matchedRule.taskType;
  const normalized = normalizeText(params.message);
  const explicitReview = params.policy.reviewTriggers.some((hint) => normalized.includes(hint));
  if (explicitReview) return 'review';
  const explicitStrategy = params.policy.rules.some((rule) => (
    rule.agentId === 'strategy-lead'
    && rule.keywords.some((hint) => normalized.includes(hint))
  ));
  if (explicitStrategy) return 'strategy';
  const explicitContent = params.policy.rules.some((rule) => (
    rule.agentId === 'content-specialist'
    && rule.keywords.some((hint) => normalized.includes(hint))
  ));
  if (explicitContent) return 'content';
  return 'general';
}

function resolvePrimaryAgent(params: {
  matchedRule?: RoutingRule;
  policy: RoutingPolicy;
}): AgentRoute['primaryAgent'] {
  if (params.matchedRule) return params.matchedRule.agentId;
  return params.policy.defaultAgent;
}

function classifyRouteHeuristic(message: string, policy: RoutingPolicy): AgentRoute {
  const outputMode = detectOutputMode(message, policy);
  const matchedRule = resolveMatchedRule(message, policy);
  const taskType = inferTaskType({
    message,
    policy,
    matchedRule,
  });
  const primaryAgent = resolvePrimaryAgent({
    matchedRule,
    policy,
  });

  return {
    primaryAgent,
    needsTools: detectNeedsTools(message, policy),
    needsReview: detectNeedsReview({
      text: message,
      outputMode,
      policy,
      matchedRule,
    }),
    taskType,
    outputMode,
  };
}

function normalizePrimaryAgent(value: unknown): AgentRoute['primaryAgent'] | undefined {
  if (value === 'content-specialist' || value === 'strategy-lead' || value === 'growth-analyst') {
    return value;
  }
  return undefined;
}

function normalizeOutputMode(value: unknown): AgentRoute['outputMode'] | undefined {
  if (value === 'short' || value === 'normal' || value === 'deep') {
    return value;
  }
  return undefined;
}

function normalizeTaskType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned : undefined;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Try to extract embedded JSON block below.
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    return null;
  }
  return null;
}

async function classifyRouteWithModel(params: {
  message: string;
  policy: RoutingPolicy;
}): Promise<Partial<AgentRoute> | null> {
  try {
    const config = await loadConfig();
    const preferredProviderId = config.defaultProvider;
    let providerId = preferredProviderId;
    let provider = preferredProviderId ? getProvider(preferredProviderId) : undefined;

    if (!provider) {
      for (const fallbackId of ['openai', 'anthropic', 'kimi', 'kimi-coding']) {
        const candidate = getProvider(fallbackId);
        if (candidate) {
          provider = candidate;
          providerId = fallbackId;
          break;
        }
      }
    }

    if (!provider) return null;

    const providerConfig = providerId ? getProviderConfig(providerId) : undefined;
    const model = providerConfig?.defaultModel || config.defaultModel || 'gpt-4o-mini';
    const agents = agentRegistry.list()
      .filter((agent) => agent.id !== 'orchestrator')
      .map((agent) => ({
        id: agent.id,
        role: agent.role,
        description: agent.description,
      }));

    const systemPrompt = [
      'You are a strict task router.',
      'Classify user intent into one primary agent and routing flags.',
      'Return JSON only. No markdown. No prose.',
      'JSON schema:',
      '{"primaryAgent":"content-specialist|strategy-lead|growth-analyst","taskType":"string","needsTools":boolean,"needsReview":boolean,"outputMode":"short|normal|deep"}',
    ].join('\n');

    const userPrompt = [
      `User message: ${params.message}`,
      `Default agent: ${params.policy.defaultAgent}`,
      `Configured routing rules: ${JSON.stringify(params.policy.rules.map((rule) => ({ agentId: rule.agentId, taskType: rule.taskType })))}`,
      `Review triggers: ${JSON.stringify(params.policy.reviewTriggers)}`,
      `High-stakes triggers: ${JSON.stringify(params.policy.highStakesTriggers)}`,
      `Output mode hints: ${JSON.stringify(params.policy.outputModeHints)}`,
      `Available agents: ${JSON.stringify(agents)}`,
      'Select the best single primaryAgent.',
    ].join('\n');

    const response = await provider.chat({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const parsed = extractJsonObject(response.content || '');
    if (!parsed) return null;

    const primaryAgent = normalizePrimaryAgent(parsed.primaryAgent);
    const outputMode = normalizeOutputMode(parsed.outputMode);
    const taskType = normalizeTaskType(parsed.taskType);

    return {
      ...(primaryAgent ? { primaryAgent } : {}),
      ...(taskType ? { taskType } : {}),
      ...(typeof parsed.needsTools === 'boolean' ? { needsTools: parsed.needsTools } : {}),
      ...(typeof parsed.needsReview === 'boolean' ? { needsReview: parsed.needsReview } : {}),
      ...(outputMode ? { outputMode } : {}),
    };
  } catch {
    return null;
  }
}

export async function classifyRoute(message: string): Promise<AgentRoute> {
  const policy = loadRoutingPolicy();
  const heuristic = classifyRouteHeuristic(message, policy);

  // If explicit routing rules already matched, keep deterministic behavior.
  if (policy.rules.length > 0 && heuristic.taskType !== 'general') {
    return heuristic;
  }

  const modelRoute = await classifyRouteWithModel({ message, policy });
  if (!modelRoute) return heuristic;

  return {
    primaryAgent: modelRoute.primaryAgent || heuristic.primaryAgent,
    needsTools: modelRoute.needsTools ?? heuristic.needsTools,
    needsReview: modelRoute.needsReview ?? heuristic.needsReview,
    taskType: modelRoute.taskType || heuristic.taskType,
    outputMode: modelRoute.outputMode || heuristic.outputMode,
  };
}

function pickTargetAudience(message: string, context?: Context): string | undefined {
  const normalized = message.toLowerCase();
  if (normalized.includes('linkedin')) return 'LinkedIn audience';
  if (normalized.includes('twitter') || normalized.includes('x.com')) return 'X/Twitter audience';
  if (normalized.includes('email')) return 'Email subscribers';
  if (context?.projectContext?.brandName) {
    return `${context.projectContext.brandName} target audience`;
  }
  return undefined;
}

function inferExpectedOutput(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('thread')) return 'A complete thread with hook, body tweets, and CTA.';
  if (normalized.includes('email')) return 'A polished marketing email with subject, body, and CTA.';
  if (normalized.includes('plan')) return 'A concrete plan with steps, rationale, and priorities.';
  if (normalized.includes('review')) return 'A structured review with clear issues and recommended edits.';
  return 'A complete response that directly solves the user request.';
}

function extractProjectFacts(context?: Context): string[] {
  if (!context?.projectContext) return [];
  const facts: string[] = [];
  facts.push(`Project: ${context.projectContext.name}`);
  if (context.projectContext.description) facts.push(`Project description: ${context.projectContext.description}`);
  if (context.projectContext.brandName) facts.push(`Brand: ${context.projectContext.brandName}`);
  if (context.projectContext.goals?.length) {
    facts.push(...context.projectContext.goals.slice(0, 3).map((goal) => `Goal: ${goal}`));
  }
  return facts.slice(0, 7);
}

function extractBrandVoice(context?: Context): string | undefined {
  const brandMd = context?.projectContext?.brandMd || context?.brandContext?.brandMd;
  if (!brandMd) return undefined;
  const compact = brandMd.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 280);
}

export function buildHandoffPacket(params: {
  message: string;
  context?: Context;
  route: AgentRoute;
}): AgentHandoff {
  const { message, context, route } = params;
  const keyFacts = [
    ...extractProjectFacts(context),
    ...((context?.brandContext?.relevantMemories || []).slice(0, 3)),
  ].slice(0, 7);

  const constraints: string[] = [];
  if (route.outputMode === 'short') constraints.push('Keep output concise.');
  if (route.outputMode === 'deep') constraints.push('Provide deeper reasoning and specificity.');
  if (context?.projectContext?.goals?.length) {
    constraints.push(`Align with project goals: ${context.projectContext.goals.slice(0, 2).join(', ')}`);
  }

  return {
    userIntent: message,
    taskGoal: inferExpectedOutput(message),
    targetAudience: pickTargetAudience(message, context),
    brandVoice: extractBrandVoice(context),
    constraints,
    keyFacts,
    sourceSnippets: [],
    expectedOutput: inferExpectedOutput(message),
  };
}

export function buildOutputSpec(message: string, route: AgentRoute): OutputSpec {
  const normalized = message.toLowerCase();
  let format: OutputSpec['format'] = 'article';
  if (normalized.includes('json')) format = 'json';
  else if (normalized.includes('thread')) format = 'thread';
  else if (normalized.includes('plan')) format = 'plan';
  else if (normalized.includes('bullet')) format = 'bullet';

  const lengthMap: Record<AgentRoute['outputMode'], OutputSpec['length']> = {
    short: 'short',
    normal: 'medium',
    deep: 'long',
  };

  return {
    format,
    length: lengthMap[route.outputMode],
    sections: route.taskType === 'review'
      ? ['Verdict', 'Issues', 'Recommended Edits']
      : undefined,
    mustInclude: ['Direct answer', 'Actionable details'],
  };
}

export function buildCompactContext(params: {
  recentMessages: AgentMessage[];
  sessionSummary?: string;
  relevantMemories: string[];
  projectFacts: string[];
}) {
  return {
    recentMessages: params.recentMessages.slice(-4),
    sessionSummary: params.sessionSummary ?? '',
    relevantMemories: params.relevantMemories.slice(0, 5),
    projectFacts: params.projectFacts.slice(0, 6),
  };
}
