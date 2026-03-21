/**
 * Agent Orchestrator
 *
 * Thin router + context handoff pipeline:
 * user -> orchestrator -> primary specialist -> optional reviewer -> quality floor.
 */

import {
  AgentContext,
  AgentHandoff,
  AgentMessage,
  AgentRequest,
  AgentResponse,
  OutputSpec,
  QualityCheck,
  ReviewResult,
  RunRequest,
  RunResponse,
} from './types';
import { agentRegistry } from './registry';
import { parseDirectives, runAgent, runAgentStream } from './runtime';
import { resolveTokenBudget } from './budget';
import { buildCompactContext, buildHandoffPacket, buildOutputSpec, classifyRoute } from './routing';
import { SessionManager } from '../sessions/manager';
import { toolRegistry } from '../tools/index';
import { buildContext, Context } from '../context-engine';
import { storeMemory } from '../memory/database';
import { WorkspaceManager } from '../workspace/manager';
import { assembleContext } from '../context/assembler';
import { buildRollingSessionSummary, formatSessionSummary } from '../sessions/summary';
import { addAgentUsage, addToolTelemetry, createRequestTrace, flushRequestTrace } from '../observability/request-trace';

function safeLower(input: string): string {
  return input.toLowerCase();
}

function safeTrim(input: string, maxChars = 240): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function extractSalientTerms(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .slice(0, limit);
}

function estimateLexicalDensity(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;
  const unique = new Set(tokens);
  return unique.size / tokens.length;
}

function normalizeNumericToken(token: string): string {
  return token.replace(/,/g, '').replace(/\+$/, '').trim();
}

function extractNumericTokens(text: string): string[] {
  const cleaned = text
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '');
  const matches = cleaned.match(/\b\d[\d.,]*\+?\b/g) || [];
  return matches
    .map(normalizeNumericToken)
    .filter((token) => token.length > 0);
}

function hasStructuredActions(content: string, format: OutputSpec['format']): boolean {
  const listLike = /(^|\n)\s*(?:[-*]|\d+\.)\s+\S+/m.test(content);
  if (listLike) return true;

  const paragraphs = content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (format === 'plan' || format === 'bullet' || format === 'thread') {
    return paragraphs.length >= 2;
  }

  const sentenceCount = content
    .split(/[.!?]\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .length;
  return sentenceCount >= 2;
}

const DELIVERABLE_OPEN_TAG = '<deliverable>';
const DELIVERABLE_CLOSE_TAG = '</deliverable>';

function normalizeDeliverableOutput(content: string): string {
  const text = (content || '').trim();
  if (!text) return '';

  const tagRegex = /<deliverable>([\s\S]*?)<\/deliverable>/i;
  const tagMatch = text.match(tagRegex);
  if (tagMatch && tagMatch[1]?.trim()) {
    return tagMatch[1].trim();
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const deliverable = parsed?.deliverable;
      if (typeof deliverable === 'string' && deliverable.trim()) {
        return deliverable.trim();
      }
    } catch {
      // Ignore malformed JSON and keep raw text as fallback.
    }
  }

  return text;
}

function parseReviewResult(text: string): ReviewResult {
  const fallback: ReviewResult = {
    verdict: 'pass',
    issues: [],
    strengths: [],
    recommendedEdits: [],
  };

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    if (/revise|sửa|improve|fix/i.test(text)) {
      return {
        verdict: 'revise',
        issues: [safeTrim(text, 280)],
        strengths: [],
        recommendedEdits: ['Improve specificity and alignment to the brief.'],
      };
    }
    return fallback;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ReviewResult>;
    return {
      verdict: parsed.verdict === 'revise' ? 'revise' : 'pass',
      issues: Array.isArray(parsed.issues) ? parsed.issues.map((x) => String(x)).slice(0, 6) : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map((x) => String(x)).slice(0, 6) : [],
      recommendedEdits: Array.isArray(parsed.recommendedEdits)
        ? parsed.recommendedEdits.map((x) => String(x)).slice(0, 6)
        : [],
    };
  } catch {
    return fallback;
  }
}

function runQualityCheck(content: string, handoff: AgentHandoff, outputSpec: OutputSpec): QualityCheck {
  const normalized = safeLower(content);
  const goalTerms = extractSalientTerms([
    handoff.taskGoal,
    handoff.expectedOutput,
    ...handoff.constraints,
  ].join(' '), 8);
  const goalMatches = goalTerms.filter((term) => normalized.includes(term)).length;
  const minLength = outputSpec.length === 'short' ? 60 : outputSpec.length === 'long' ? 220 : 120;
  const tooShort = content.trim().length < minLength;
  const tooGeneric = /as an ai|it depends|generic|overall/i.test(content);
  const lexicalDensity = estimateLexicalDensity(content);
  const hasStructure = hasStructuredActions(content, outputSpec.format);

  const evidenceText = [
    handoff.userIntent,
    handoff.taskGoal,
    handoff.expectedOutput,
    ...handoff.keyFacts,
    ...handoff.sourceSnippets,
  ].join(' ').toLowerCase();

  const evidenceNumbers = new Set(extractNumericTokens(evidenceText));
  const contentNumbers = extractNumericTokens(content);
  const unsupportedNumericClaims = contentNumbers.filter((token) => !evidenceNumbers.has(token));

  return {
    hasClearGoalMatch: goalMatches >= Math.min(2, goalTerms.length),
    hasEnoughSpecificity: content.trim().length >= minLength && lexicalDensity >= 0.45,
    hasActionableContent: hasStructure,
    hasUnsupportedClaims: unsupportedNumericClaims.length > 0,
    tooGeneric,
    tooShort,
  };
}

function buildReviewPrompt(params: {
  handoff: AgentHandoff;
  outputSpec: OutputSpec;
  draft: string;
}): string {
  return [
    'Review this draft with concise structured critique.',
    `Goal: ${params.handoff.taskGoal}`,
    `Expected output: ${params.handoff.expectedOutput}`,
    `Output format: ${params.outputSpec.format}, length: ${params.outputSpec.length}`,
    '',
    'Return STRICT JSON with this exact shape:',
    '{"verdict":"pass|revise","issues":["..."],"strengths":["..."],"recommendedEdits":["..."]}',
    '',
    'Draft:',
    params.draft,
  ].join('\n');
}

function buildHandoffPrompt(handoff: AgentHandoff, outputSpec: OutputSpec): string {
  const lines: string[] = [];
  lines.push('Use this handoff packet to complete the task.');
  lines.push('Output contract: return ONLY one deliverable wrapped in exact tags below.');
  lines.push(`Start with ${DELIVERABLE_OPEN_TAG} and end with ${DELIVERABLE_CLOSE_TAG}.`);
  lines.push(`Example: ${DELIVERABLE_OPEN_TAG}Your final user-facing answer here.${DELIVERABLE_CLOSE_TAG}`);
  lines.push('Do not include commentary outside these tags unless user explicitly asks for explanation.');
  lines.push('Do not add framing headers, prefaces, or postscript evaluation sections.');
  lines.push('Do not fabricate metrics, case-study outcomes, or numeric claims unless they are in provided facts/sources.');
  lines.push('If evidence is missing, use qualitative wording and avoid made-up proof points.');
  lines.push(`Intent: ${handoff.userIntent}`);
  lines.push(`Goal: ${handoff.taskGoal}`);
  if (handoff.targetAudience) lines.push(`Audience: ${handoff.targetAudience}`);
  if (handoff.brandVoice) lines.push(`Brand voice: ${handoff.brandVoice}`);
  if (handoff.constraints.length > 0) lines.push(`Constraints: ${handoff.constraints.join(' | ')}`);
  if (handoff.keyFacts.length > 0) lines.push(`Key facts: ${handoff.keyFacts.join(' | ')}`);
  if (handoff.sourceSnippets.length > 0) lines.push(`Source snippets: ${handoff.sourceSnippets.join(' | ')}`);
  lines.push(`Expected output: ${handoff.expectedOutput}`);
  lines.push(`Output spec: format=${outputSpec.format}, length=${outputSpec.length}`);
  return lines.join('\n');
}

function extractRelevantMemories(context: Context): string[] {
  const fromBrand = context.brandContext?.relevantMemories || [];
  const fromRecent = context.recentMemories || [];
  return [...fromBrand, ...fromRecent].filter(Boolean).slice(0, 7);
}

function extractProjectFacts(context: Context): string[] {
  if (!context.projectContext) return [];
  const facts: string[] = [];
  facts.push(`Project: ${context.projectContext.name}`);
  if (context.projectContext.brandName) facts.push(`Brand: ${context.projectContext.brandName}`);
  if (context.projectContext.description) facts.push(`Description: ${context.projectContext.description}`);
  if (context.projectContext.goals.length > 0) {
    facts.push(...context.projectContext.goals.slice(0, 3).map((goal) => `Goal: ${goal}`));
  }
  return facts.slice(0, 6);
}

function buildBrandBrief(context: Context): string | undefined {
  const raw = context.projectContext?.brandMd || context.brandContext?.brandMd;
  if (!raw) return undefined;
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 1200);
}

export class AgentOrchestrator {
  private sessionManager: SessionManager;
  private workspaceManager?: WorkspaceManager;

  constructor(sessionManager: SessionManager, workspaceManager?: WorkspaceManager) {
    this.sessionManager = sessionManager;
    this.workspaceManager = workspaceManager;
  }

  setWorkspaceManager(workspaceManager: WorkspaceManager): void {
    this.workspaceManager = workspaceManager;
  }

  async process(request: AgentRequest): Promise<AgentResponse> {
    const result = await this.run({
      sessionId: request.sessionId || `session-${Date.now()}`,
      agentId: 'orchestrator',
      message: request.query,
      projectId: request.projectId,
    });

    return {
      content: result.content,
      toolCalls: result.toolCalls,
    };
  }

  async run(request: RunRequest): Promise<RunResponse> {
    const requestStartedAt = Date.now();
    const requestId = `${request.sessionId}:${Date.now()}`;
    const trace = createRequestTrace(requestId);

    const session = await this.sessionManager.getSession(request.sessionId);
    let messages: AgentMessage[] = request.messages || [];
    if (messages.length === 0 && session?.messages) {
      messages = session.messages.slice(-20).map((m) => ({
        role: m.role === 'system' ? 'assistant' : m.role,
        content: m.content,
        timestamp: new Date(m.timestamp),
      }));
    }

    let enhancedMessage = request.message;
    if (request.message) {
      const hasUrl = /https?:\/\/[^\s]+/.test(request.message);
      const hasTwitterUrl = /https?:\/\/(x\.com|twitter\.com)[^\s]*/.test(request.message);
      if (hasTwitterUrl) {
        enhancedMessage = `${request.message}\n\n[Note: Use fetch_tweet tool to read this tweet]`;
      } else if (hasUrl) {
        enhancedMessage = `${request.message}\n\n[Note: Use fetch_url tool to read this URL]`;
      }
    }

    if (enhancedMessage) {
      messages.push({
        role: 'user',
        content: enhancedMessage,
        timestamp: new Date(),
      });
      await this.sessionManager.addMessage(request.sessionId, {
        role: 'user',
        content: enhancedMessage,
        timestamp: Date.now(),
      });
    }

    const context = await buildContext({
      projectId: request.projectId,
      sessionId: request.sessionId,
      query: enhancedMessage || messages[messages.length - 1]?.content,
    });

    const routeWithOrchestrator = request.agentId === 'orchestrator';
    let runResponse: RunResponse;
    if (routeWithOrchestrator) {
      runResponse = await this.runRouted(request, messages, context, trace);
    } else {
      runResponse = await this.runDirect(request, messages, context, trace);
    }

    trace.totalLatencyMs = Date.now() - requestStartedAt;
    flushRequestTrace(trace);
    await this.refreshSessionSummary(request.sessionId);
    return runResponse;
  }

  private async runDirect(
    request: RunRequest,
    messages: AgentMessage[],
    context: Context,
    trace: ReturnType<typeof createRequestTrace>,
  ): Promise<RunResponse> {
    const agentContext: AgentContext = {
      sessionId: request.sessionId,
      projectId: request.projectId,
      userId: 'default_user',
      messages,
      tools: agentRegistry.get(request.agentId)?.tools || [],
      brandContext: buildBrandBrief(context),
      relevantMemories: extractRelevantMemories(context).slice(0, 5),
      workspace: this.workspaceManager,
      budget: resolveTokenBudget({ agentId: request.agentId, mode: 'balanced' }),
    };

    if (request.stream) {
      return this.runStreaming(request.agentId, agentContext);
    }

    const result = await runAgent(request.agentId, agentContext);
    addAgentUsage(trace, request.agentId, result.usage
      ? { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens }
      : undefined);
    addToolTelemetry(trace, result.toolTelemetry);

    const directives = parseDirectives(result.content);
    if (directives.length > 0 && trace.numberOfDelegations < 1) {
      const directive = directives[0];
      if (directive.type === 'MESSAGE_AGENT' && directive.target) {
        trace.numberOfDelegations += 1;
        return this.run({
          ...request,
          agentId: directive.target,
          message: undefined,
          messages: [
            ...messages,
            {
              role: 'assistant',
              content: `Routing to ${directive.target}: ${directive.payload}`,
              timestamp: new Date(),
            },
          ],
          stream: false,
        });
      }
    }

    if (result.content.length > 50) {
      storeMemory(
        `Agent ${request.agentId}: ${result.content.slice(0, 200)}...`,
        'pattern',
        { projectId: request.projectId, importance: 7 },
      );
    }

    await this.sessionManager.addMessage(request.sessionId, {
      role: 'assistant',
      content: result.content,
      timestamp: Date.now(),
    });

    return {
      content: result.content,
      messages: [
        ...messages,
        { role: 'assistant', content: result.content, timestamp: new Date() },
      ],
      toolCalls: result.toolCalls,
    };
  }

  private async runRouted(
    request: RunRequest,
    messages: AgentMessage[],
    context: Context,
    trace: ReturnType<typeof createRequestTrace>,
  ): Promise<RunResponse> {
    const userMessage = request.message || messages[messages.length - 1]?.content || '';
    const route = await classifyRoute(userMessage);
    const summaryObj = await this.sessionManager.getSessionSummary(request.sessionId);
    const summaryText = formatSessionSummary(summaryObj);
    const compactContext = buildCompactContext({
      recentMessages: messages,
      sessionSummary: summaryText,
      relevantMemories: extractRelevantMemories(context),
      projectFacts: extractProjectFacts(context),
    });
    const handoff = buildHandoffPacket({
      message: userMessage,
      context,
      route,
    });
    const outputSpec = buildOutputSpec(userMessage, route);
    const assembled = assembleContext({
      agentId: route.primaryAgent,
      sessionSummary: compactContext.sessionSummary,
      recentMessages: compactContext.recentMessages.map((m) => `${m.role}: ${safeTrim(m.content, 220)}`),
      handoff,
      snippets: handoff.sourceSnippets,
      memories: compactContext.relevantMemories,
      outputSpec,
    });

    const specialistMessages: AgentMessage[] = [
      ...compactContext.recentMessages,
      {
        role: 'user',
        content: buildHandoffPrompt(handoff, outputSpec),
        timestamp: new Date(),
      },
    ];
    const specialistTools = route.needsTools
      ? (agentRegistry.get(route.primaryAgent)?.tools || [])
      : [];
    const specialistContext: AgentContext = {
      sessionId: request.sessionId,
      projectId: request.projectId,
      userId: 'default_user',
      messages: specialistMessages,
      tools: specialistTools,
      brandContext: buildBrandBrief(context),
      relevantMemories: assembled.memories,
      sessionSummary: summaryObj,
      handoff,
      outputSpec,
      sourceSnippets: assembled.snippets,
      systemAddendum: assembled.systemAddendum,
      reasoningMode: route.outputMode === 'deep' ? 'deep' : route.outputMode === 'short' ? 'fast' : 'balanced',
      budget: resolveTokenBudget({
        agentId: route.primaryAgent,
        mode: route.outputMode === 'deep' ? 'deep' : route.outputMode === 'short' ? 'fast' : 'balanced',
      }),
      workspace: this.workspaceManager,
    };

    if (request.stream) {
      return this.runStreaming(route.primaryAgent, specialistContext);
    }

    let primaryResult = await runAgent(route.primaryAgent, specialistContext);
    addAgentUsage(trace, route.primaryAgent, primaryResult.usage
      ? { promptTokens: primaryResult.usage.promptTokens, completionTokens: primaryResult.usage.completionTokens }
      : undefined);
    addToolTelemetry(trace, primaryResult.toolTelemetry);

    let finalContent = normalizeDeliverableOutput(primaryResult.content);
    let reviewPasses = 0;

    const shouldRunReviewer = route.needsReview && route.primaryAgent !== 'growth-analyst';
    if (shouldRunReviewer) {
      reviewPasses += 1;
      const reviewPrompt = buildReviewPrompt({
        handoff,
        outputSpec,
        draft: finalContent,
      });
      const reviewContext: AgentContext = {
        sessionId: request.sessionId,
        projectId: request.projectId,
        userId: 'default_user',
        messages: [{ role: 'user', content: reviewPrompt, timestamp: new Date() }],
        tools: agentRegistry.get('growth-analyst')?.tools || [],
        handoff,
        outputSpec,
        budget: resolveTokenBudget({ agentId: 'growth-analyst', mode: 'balanced' }),
        workspace: this.workspaceManager,
      };
      const reviewRun = await runAgent('growth-analyst', reviewContext);
      addAgentUsage(trace, 'growth-analyst', reviewRun.usage
        ? { promptTokens: reviewRun.usage.promptTokens, completionTokens: reviewRun.usage.completionTokens }
        : undefined);
      addToolTelemetry(trace, reviewRun.toolTelemetry);

      const review = parseReviewResult(reviewRun.content);
      if (review.verdict === 'revise' && review.recommendedEdits.length > 0) {
        const rewriteMessage = [
          `Return output only inside ${DELIVERABLE_OPEN_TAG}...${DELIVERABLE_CLOSE_TAG}.`,
          'Revise this draft based on critique while keeping the same intent.',
          `Edits: ${review.recommendedEdits.join(' | ')}`,
          '',
          'Draft:',
          finalContent,
        ].join('\n');

        const rewriteContext: AgentContext = {
          ...specialistContext,
          messages: [{ role: 'user', content: rewriteMessage, timestamp: new Date() }],
          budget: resolveTokenBudget({ agentId: route.primaryAgent, mode: 'balanced' }),
        };
        const rewriteRun = await runAgent(route.primaryAgent, rewriteContext);
        addAgentUsage(trace, route.primaryAgent, rewriteRun.usage
          ? { promptTokens: rewriteRun.usage.promptTokens, completionTokens: rewriteRun.usage.completionTokens }
          : undefined);
        addToolTelemetry(trace, rewriteRun.toolTelemetry);
        finalContent = normalizeDeliverableOutput(rewriteRun.content);
      }
    }
    trace.numberOfReviewPasses = reviewPasses;

    const quality = runQualityCheck(finalContent, handoff, outputSpec);
    const qualityFailed = !quality.hasClearGoalMatch
      || !quality.hasEnoughSpecificity
      || !quality.hasActionableContent
      || quality.hasUnsupportedClaims
      || quality.tooGeneric
      || quality.tooShort;
    if (qualityFailed) {
      const miniFixContext: AgentContext = {
        ...specialistContext,
        messages: [
          {
            role: 'user',
            content: [
              `Return output only inside ${DELIVERABLE_OPEN_TAG}...${DELIVERABLE_CLOSE_TAG}.`,
              'Revise this draft to be natural and direct.',
              'Keep only the user-facing deliverable (no preface, no "improvements" section).',
              'Remove any invented metrics, outcomes, or unsupported numeric claims.',
              'Improve specificity with concrete wording, but do not add fake proof points.',
              '',
              finalContent,
            ].join('\n'),
            timestamp: new Date(),
          },
        ],
        budget: resolveTokenBudget({ agentId: route.primaryAgent, mode: 'balanced' }),
      };
      const miniFixRun = await runAgent(route.primaryAgent, miniFixContext);
      addAgentUsage(trace, route.primaryAgent, miniFixRun.usage
        ? { promptTokens: miniFixRun.usage.promptTokens, completionTokens: miniFixRun.usage.completionTokens }
        : undefined);
      addToolTelemetry(trace, miniFixRun.toolTelemetry);
      finalContent = normalizeDeliverableOutput(miniFixRun.content);
    }

    if (finalContent.length > 50) {
      storeMemory(
        `Agent ${route.primaryAgent}: ${finalContent.slice(0, 200)}...`,
        'pattern',
        { projectId: request.projectId, importance: 7 },
      );
    }

    await this.sessionManager.addMessage(request.sessionId, {
      role: 'assistant',
      content: finalContent,
      timestamp: Date.now(),
    });

    return {
      content: finalContent,
      messages: [
        ...messages,
        { role: 'assistant', content: finalContent, timestamp: new Date() },
      ],
      toolCalls: primaryResult.toolCalls,
    };
  }

  private async refreshSessionSummary(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) return;
    const previous = await this.sessionManager.getSessionSummary(sessionId);
    const summary = buildRollingSessionSummary(session.messages, previous);
    await this.sessionManager.updateSessionSummary(sessionId, summary);
  }

  private async runStreaming(agentId: string, context: AgentContext): Promise<RunResponse> {
    const agent = agentRegistry.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const stream = runAgentStream(agentId, context);

    return {
      content: '',
      stream,
    };
  }

  getAvailableTools() {
    return toolRegistry.getAllSpecs();
  }

  getAvailableAgents() {
    return agentRegistry.list().map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
    }));
  }
}

export * from './types';
export { agentRegistry } from './registry';
export { runAgent } from './runtime';
