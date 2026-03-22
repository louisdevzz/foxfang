/**
 * Session and sub-agent orchestration tools.
 *
 * These tools provide OpenClaw-like explicit control over sub-sessions:
 * - sessions_spawn: spawn a sub-session and run a task on a target agent
 * - sessions_send: send a message into an existing session
 * - subagents: list/inspect/close sub-agent sessions
 */

import { AgentOrchestrator } from '../../agents/orchestrator';
import { AgentMessage } from '../../agents/types';
import { SessionManager, SessionMessage } from '../../sessions/manager';
import { Tool, ToolCategory, ToolResult } from '../traits';

let runtimeOrchestrator: AgentOrchestrator | null = null;
let runtimeSessionManager: SessionManager | null = null;

function nowId(): string {
  return Date.now().toString(36);
}

function sanitizeSegment(value: string, maxLength = 60): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, maxLength);
}

function normalizeRecentMessages(messages: SessionMessage[], limit: number): AgentMessage[] {
  return messages
    .slice(-Math.max(0, limit))
    .map((msg) => ({
      role: msg.role === 'system' ? 'system' : msg.role,
      content: msg.content,
      timestamp: new Date(msg.timestamp),
    }));
}

type RuntimeDeps = {
  orchestrator: AgentOrchestrator;
  sessionManager: SessionManager;
};

function ensureRuntimeReady(): { ok: true; runtime: RuntimeDeps } | { ok: false; result: ToolResult } {
  if (!runtimeOrchestrator || !runtimeSessionManager) {
    return {
      ok: false,
      result: {
        success: false,
        error: 'Sub-agent tools are not initialized. Start FoxFang daemon/CLI runtime first.',
      },
    };
  }
  return {
    ok: true,
    runtime: {
      orchestrator: runtimeOrchestrator,
      sessionManager: runtimeSessionManager,
    },
  };
}

function isSubagentSessionId(id: string): boolean {
  return id.includes('__agent__') || id.includes('__spawn__');
}

function buildSpawnSessionId(parentSessionId: string | undefined, agentId: string): string {
  const target = sanitizeSegment(agentId || 'agent', 40) || 'agent';
  if (parentSessionId && parentSessionId.trim()) {
    return `${parentSessionId}__spawn__${target}__${nowId()}`;
  }
  return `spawn-${target}-${nowId()}`;
}

export function setSubagentToolsRuntime(orchestrator: AgentOrchestrator, sessionManager: SessionManager): void {
  runtimeOrchestrator = orchestrator;
  runtimeSessionManager = sessionManager;
}

export function clearSubagentToolsRuntime(): void {
  runtimeOrchestrator = null;
  runtimeSessionManager = null;
}

export class SessionsSpawnTool implements Tool {
  name = 'sessions_spawn';
  description = 'Spawn a sub-session for a target agent and run a task immediately.';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      agent_id: { type: 'string', description: 'Target agent id for the spawned sub-session.' },
      task: { type: 'string', description: 'Task/prompt to run in the spawned session.' },
      parent_session_id: { type: 'string', description: 'Optional parent session id to nest under.' },
      session_id: { type: 'string', description: 'Optional explicit session id. If omitted, one is generated.' },
      project_id: { type: 'string', description: 'Optional project id.' },
      inherit_recent_messages: { type: 'boolean', description: 'Include recent parent messages as one-turn context.' },
      recent_message_limit: { type: 'number', description: 'How many parent messages to include when inheriting (default: 4).' },
    },
    required: ['agent_id', 'task'],
  };

  async execute(args: {
    agent_id: string;
    task: string;
    parent_session_id?: string;
    session_id?: string;
    project_id?: string;
    inherit_recent_messages?: boolean;
    recent_message_limit?: number;
  }): Promise<ToolResult> {
    const runtime = ensureRuntimeReady();
    if (!runtime.ok) return runtime.result;

    const agentId = String(args.agent_id || '').trim();
    const task = String(args.task || '').trim();
    if (!agentId) return { success: false, error: 'agent_id is required.' };
    if (!task) return { success: false, error: 'task is required.' };

    const parentSessionId = String(args.parent_session_id || '').trim() || undefined;
    const sessionId = String(args.session_id || '').trim() || buildSpawnSessionId(parentSessionId, agentId);
    const includeParent = args.inherit_recent_messages === true;
    const messageLimit = Math.max(1, Math.min(12, Number(args.recent_message_limit || 4)));

    let inheritedMessages: AgentMessage[] | undefined;
    let inferredProjectId: string | undefined = args.project_id;

    if (parentSessionId && includeParent) {
      const parent = await runtime.runtime.sessionManager.getSession(parentSessionId);
      if (parent) {
        inheritedMessages = normalizeRecentMessages(parent.messages, messageLimit);
        if (!inferredProjectId && parent.projectId) inferredProjectId = parent.projectId;
      }
    }

    const existing = await runtime.runtime.sessionManager.getSession(sessionId);
    if (!existing) {
      await runtime.runtime.sessionManager.createSession(sessionId, {
        agentId,
        projectId: inferredProjectId,
      });
    }

    const run = await runtime.runtime.orchestrator.run({
      sessionId,
      agentId,
      projectId: inferredProjectId,
      message: task,
      messages: inheritedMessages,
      stream: false,
    });

    return {
      success: true,
      output: run.content,
      data: {
        session_id: sessionId,
        parent_session_id: parentSessionId,
        agent_id: agentId,
        project_id: inferredProjectId,
        inherited_messages: inheritedMessages?.length || 0,
        response: run.content,
      },
    };
  }
}

export class SessionsSendTool implements Tool {
  name = 'sessions_send';
  description = 'Send a message into an existing session (main or sub-agent) and return the response.';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      session_id: { type: 'string', description: 'Target session id.' },
      message: { type: 'string', description: 'Message to send.' },
      agent_id: { type: 'string', description: 'Optional agent override. Defaults to session agent.' },
      project_id: { type: 'string', description: 'Optional project id override.' },
    },
    required: ['session_id', 'message'],
  };

  async execute(args: {
    session_id: string;
    message: string;
    agent_id?: string;
    project_id?: string;
  }): Promise<ToolResult> {
    const runtime = ensureRuntimeReady();
    if (!runtime.ok) return runtime.result;

    const sessionId = String(args.session_id || '').trim();
    const message = String(args.message || '').trim();
    if (!sessionId) return { success: false, error: 'session_id is required.' };
    if (!message) return { success: false, error: 'message is required.' };

    const session = await runtime.runtime.sessionManager.getSession(sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${sessionId}`,
      };
    }

    const agentId = String(args.agent_id || '').trim() || session.agentId || 'orchestrator';
    const projectId = String(args.project_id || '').trim() || session.projectId || undefined;

    const run = await runtime.runtime.orchestrator.run({
      sessionId,
      agentId,
      projectId,
      message,
      stream: false,
    });

    return {
      success: true,
      output: run.content,
      data: {
        session_id: sessionId,
        agent_id: agentId,
        project_id: projectId,
        response: run.content,
      },
    };
  }
}

export class SubagentsTool implements Tool {
  name = 'subagents';
  description = 'Inspect sub-agent sessions: list, inspect history, or close a sub-session.';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      action: { type: 'string', description: 'Action: list | inspect | close.' },
      parent_session_id: { type: 'string', description: 'Optional parent session id filter for list.' },
      session_id: { type: 'string', description: 'Session id for inspect/close.' },
      limit: { type: 'number', description: 'Limit rows/messages (default: 20 for list, 10 for inspect).' },
      include_messages: { type: 'boolean', description: 'Include recent messages in inspect output.' },
    },
    required: ['action'],
  };

  async execute(args: {
    action: string;
    parent_session_id?: string;
    session_id?: string;
    limit?: number;
    include_messages?: boolean;
  }): Promise<ToolResult> {
    const runtime = ensureRuntimeReady();
    if (!runtime.ok) return runtime.result;

    const action = String(args.action || '').trim().toLowerCase();
    if (action === 'list') {
      return this.handleList(runtime.runtime.sessionManager, args);
    }
    if (action === 'inspect') {
      return this.handleInspect(runtime.runtime.sessionManager, args);
    }
    if (action === 'close') {
      return this.handleClose(runtime.runtime.sessionManager, args);
    }
    return {
      success: false,
      error: 'Invalid action. Use one of: list, inspect, close.',
    };
  }

  private async handleList(
    sessionManager: SessionManager,
    args: { parent_session_id?: string; limit?: number },
  ): Promise<ToolResult> {
    const limit = Math.max(1, Math.min(100, Number(args.limit || 20)));
    const parentSessionId = String(args.parent_session_id || '').trim() || undefined;
    const rows = await sessionManager.listSessions({ limit: 500 });

    const filtered = rows.filter((session) => {
      if (parentSessionId) return session.id.startsWith(`${parentSessionId}__`);
      return isSubagentSessionId(session.id);
    }).slice(0, limit);

    const output = filtered.length === 0
      ? 'No sub-agent sessions found.'
      : filtered.map((session) => (
        `- ${session.id} | agent=${session.agentId} | messages=${session.messageCount} | lastActive=${new Date(session.lastActive).toISOString()}`
      )).join('\n');

    return {
      success: true,
      output,
      data: {
        count: filtered.length,
        sessions: filtered.map((session) => ({
          id: session.id,
          agentId: session.agentId,
          projectId: session.projectId,
          messageCount: session.messageCount,
          createdAt: session.createdAt,
          lastActive: session.lastActive,
        })),
      },
    };
  }

  private async handleInspect(
    sessionManager: SessionManager,
    args: { session_id?: string; limit?: number; include_messages?: boolean },
  ): Promise<ToolResult> {
    const sessionId = String(args.session_id || '').trim();
    if (!sessionId) return { success: false, error: 'session_id is required for inspect.' };

    const session = await sessionManager.getSession(sessionId);
    if (!session) return { success: false, error: `Session not found: ${sessionId}` };

    const includeMessages = args.include_messages === true;
    const messageLimit = Math.max(1, Math.min(30, Number(args.limit || 10)));
    const recentMessages = includeMessages
      ? session.messages.slice(-messageLimit).map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      }))
      : undefined;

    const output = [
      `session=${session.id}`,
      `agent=${session.agentId}`,
      `project=${session.projectId || '-'}`,
      `messages=${session.messages.length}`,
      `createdAt=${new Date(session.createdAt).toISOString()}`,
      `lastActive=${new Date(session.lastActive).toISOString()}`,
    ].join('\n');

    return {
      success: true,
      output,
      data: {
        session: {
          id: session.id,
          agentId: session.agentId,
          projectId: session.projectId,
          createdAt: session.createdAt,
          lastActive: session.lastActive,
          messageCount: session.messages.length,
          ...(recentMessages ? { recentMessages } : {}),
        },
      },
    };
  }

  private async handleClose(
    sessionManager: SessionManager,
    args: { session_id?: string },
  ): Promise<ToolResult> {
    const sessionId = String(args.session_id || '').trim();
    if (!sessionId) return { success: false, error: 'session_id is required for close.' };
    const session = await sessionManager.getSession(sessionId);
    if (!session) return { success: false, error: `Session not found: ${sessionId}` };

    await sessionManager.deleteSession(sessionId);
    return {
      success: true,
      output: `Closed session ${sessionId}`,
      data: {
        session_id: sessionId,
        deleted: true,
      },
    };
  }
}
