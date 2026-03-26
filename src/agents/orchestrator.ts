/**
 * Agent Orchestrator
 *
 * Clean direct-execution pattern following OpenClaw.
 * user -> orchestrator -> agent with full system prompt (SOUL.md personality).
 */

import {
  AgentContext,
  AgentMessage,
  AgentRequest,
  AgentResponse,
  RunRequest,
  RunResponse,
} from './types';
import { agentRegistry, ensureAgentRegistered } from './registry';
import { parseDirectives, runAgent, runAgentStream } from './runtime';
import { resolveTokenBudget } from './budget';
import { pruneHistory, estimateTotalTokens } from './compaction';
import { SessionManager } from '../sessions/manager';
import { toolRegistry } from '../tools/index';
import { storeMemory } from '../memory/database';
import { WorkspaceManager } from '../workspace/manager';
import { buildRollingSessionSummary } from '../sessions/summary';
import { addAgentUsage, addToolTelemetry, createRequestTrace, flushRequestTrace } from '../observability/request-trace';

function sanitizeSegment(value: string, maxLength = 60): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, maxLength);
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

  private buildSubAgentSessionId(parentSessionId: string, agentId: string): string {
    return `${parentSessionId}__agent__${sanitizeSegment(agentId, 40)}`;
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

    const enhancedMessage = request.message;

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

    // Direct execution — full system prompt with SOUL.md personality
    const directAgent = await ensureAgentRegistered(request.agentId);
    const userId = request.userId || 'default_user';

    // Use minimal prompt mode for channel sessions to reduce token usage
    const isChannelSession = request.sessionId.startsWith('channel-');
    const promptMode = isChannelSession ? 'minimal' as const : 'full' as const;

    const budget = resolveTokenBudget({ agentId: request.agentId, mode: 'balanced' });

    // Prune history if it exceeds budget — drops oldest messages first
    const rawTokens = estimateTotalTokens(messages);
    let prunedMessages = messages;
    if (rawTokens > budget.requestMaxInputTokens * 0.5) {
      const pruned = pruneHistory({
        messages,
        maxContextTokens: budget.requestMaxInputTokens * 2,
        maxHistoryShare: 0.5,
      });
      prunedMessages = pruned.messages;
      if (pruned.droppedCount > 0) {
        console.log(`[Orchestrator] ✂️ Pruned ${pruned.droppedCount} old messages (${rawTokens} → ${pruned.keptTokens} est. tokens)`);
      }
    }

    const agentContext: AgentContext = {
      sessionId: request.sessionId,
      projectId: request.projectId,
      userId,
      messages: prunedMessages,
      tools: directAgent.tools || [],
      workspace: this.workspaceManager,
      budget,
      promptMode,
      isChannelSession,
    };

    let runResponse: RunResponse;

    if (request.stream) {
      runResponse = await this.runStreaming(request.agentId, agentContext);
    } else {
      const result = await runAgent(request.agentId, agentContext);
      addAgentUsage(trace, request.agentId, result.usage
        ? { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens }
        : undefined);
      addToolTelemetry(trace, result.toolTelemetry);

      // Handle MESSAGE_AGENT delegation
      const currentDelegationDepth = request.delegationDepth ?? 0;
      const maxDelegations = Math.max(0, agentContext.budget?.maxDelegations ?? 1);
      const directives = parseDirectives(result.content);
      if (directives.length > 0 && currentDelegationDepth < maxDelegations) {
        const directive = directives[0];
        if (directive.type === 'MESSAGE_AGENT' && directive.target) {
          trace.numberOfDelegations += 1;
          trace.totalLatencyMs = Date.now() - requestStartedAt;
          flushRequestTrace(trace);
          return this.run({
            ...request,
            delegationDepth: currentDelegationDepth + 1,
            sessionId: this.buildSubAgentSessionId(request.sessionId, directive.target),
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

      let directContent = result.content;
      if (directives.length > 0 && currentDelegationDepth >= maxDelegations) {
        const stripped = directContent.replace(/MESSAGE_AGENT:\s*[^\n]+/gi, '').trim();
        directContent = stripped || 'Delegation limit reached. Please clarify the exact next step to continue.';
      }
      const yieldDirective = directives.find((d) => d.type === 'YIELD');
      if ((!directContent || !directContent.trim()) && yieldDirective?.payload) {
        directContent = yieldDirective.payload;
      }

      if (directContent.length > 50) {
        storeMemory(
          `Agent ${request.agentId}: ${directContent.slice(0, 200)}...`,
          'pattern',
          { projectId: request.projectId, importance: 7 },
        );
      }

      await this.sessionManager.addMessage(request.sessionId, {
        role: 'assistant',
        content: directContent,
        timestamp: Date.now(),
      });

      runResponse = {
        content: directContent,
        messages: [
          ...messages,
          { role: 'assistant', content: directContent, timestamp: new Date() },
        ],
        toolCalls: result.toolCalls,
      };
    }

    trace.totalLatencyMs = Date.now() - requestStartedAt;
    flushRequestTrace(trace);
    await this.refreshSessionSummary(request.sessionId);
    return runResponse;
  }

  private async refreshSessionSummary(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) return;
    const previous = await this.sessionManager.getSessionSummary(sessionId);
    const summary = buildRollingSessionSummary(session.messages, previous);
    await this.sessionManager.updateSessionSummary(sessionId, summary);
  }

  private async runStreaming(agentId: string, context: AgentContext): Promise<RunResponse> {
    await ensureAgentRegistered(agentId);

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
