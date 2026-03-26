/**
 * Agent Executor
 *
 * Executes agent runs with session management, history pruning, and tracing.
 * No orchestrator agent — routing is deterministic via config bindings.
 * The model self-delegates to sub-agents via sessions_spawn tool.
 */

import {
  AgentContext,
  AgentMessage,
  AgentRequest,
  AgentResponse,
  RunRequest,
  RunResponse,
} from './types';
import { agentRegistry, ensureAgentRegistered, resolveDefaultAgentId } from './registry';
import { runAgent, runAgentStream } from './runtime';
import { resolveTokenBudget } from './budget';
import { pruneHistory, estimateTotalTokens } from './compaction';
import { SessionManager } from '../sessions/manager';
import { toolRegistry } from '../tools/index';
import { storeMemory } from '../memory/database';
import { WorkspaceManager } from '../workspace/manager';
import { buildRollingSessionSummary } from '../sessions/summary';
import { addAgentUsage, addToolTelemetry, createRequestTrace, flushRequestTrace } from '../observability/request-trace';

/**
 * AgentOrchestrator — the execution engine for agent runs.
 * Despite the name (kept for backward compatibility), this is NOT an orchestrator agent.
 * It simply executes whatever agent is resolved for the request.
 */
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
    const defaultAgentId = await resolveDefaultAgentId();
    const result = await this.run({
      sessionId: request.sessionId || `session-${Date.now()}`,
      agentId: defaultAgentId,
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

    // Resolve the agent — fully config-driven
    const agent = await ensureAgentRegistered(request.agentId);
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
        console.log(`[AgentExecutor] ✂️ Pruned ${pruned.droppedCount} old messages (${rawTokens} → ${pruned.keptTokens} est. tokens)`);
      }
    }

    const agentContext: AgentContext = {
      sessionId: request.sessionId,
      projectId: request.projectId,
      userId,
      messages: prunedMessages,
      tools: agent.tools || [],
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

      const content = result.content;

      if (content.length > 50) {
        storeMemory(
          `Agent ${request.agentId}: ${content.slice(0, 200)}...`,
          'pattern',
          { projectId: request.projectId, importance: 7 },
        );
      }

      await this.sessionManager.addMessage(request.sessionId, {
        role: 'assistant',
        content,
        timestamp: Date.now(),
      });

      runResponse = {
        content,
        messages: [
          ...messages,
          { role: 'assistant', content, timestamp: new Date() },
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
    return { content: '', stream };
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
