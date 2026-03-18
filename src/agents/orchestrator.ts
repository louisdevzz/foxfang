/**
 * Agent Orchestrator
 * 
 * Routes user requests to appropriate specialist agents and manages the conversation flow.
 */

import { AgentRequest, AgentResponse, RunRequest, RunResponse, AgentContext, AgentMessage, StreamChunk } from './types';
import { agentRegistry } from './registry';
import { runAgent, runAgentStream, parseDirectives } from './runtime';
import { SessionManager } from '../sessions/manager';
import { toolRegistry } from '../tools/index';
import { buildContext } from '../context-engine';
import { storeMemory } from '../memory/database';
import { understandLinks } from '../link-understanding';

export class AgentOrchestrator {
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Process a simple query (non-streaming)
   */
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

  /**
   * Run with full context and streaming support
   */
  async run(request: RunRequest): Promise<RunResponse> {
    const session = await this.sessionManager.getSession(request.sessionId);
    
    // Load messages from session if not provided in request
    let messages: AgentMessage[] = request.messages || [];
    if (messages.length === 0 && session?.messages) {
      // Convert session messages to agent messages (last 20 for context window)
      messages = session.messages.slice(-20).map(m => ({
        role: m.role === 'system' ? 'assistant' : m.role, // system -> assistant for context
        content: m.content,
        timestamp: new Date(m.timestamp),
      }));
    }
    
    // Detect and fetch content from any links in the user's message (best-effort)
    let enhancedMessage = request.message;
    if (request.message) {
      try {
        const linkResult = await understandLinks(request.message);
        if (linkResult.hasLinks) {
          // Append link context to user's message (like OpenClaw does)
          enhancedMessage = `${request.message}\n\n${linkResult.context}`;
        }
      } catch {
        // Link understanding is best-effort — fall back to original message
        // so a fetch failure never blocks the user's actual request
        enhancedMessage = request.message;
      }
    }

    if (enhancedMessage) {
      messages.push({
        role: 'user',
        content: enhancedMessage,
        timestamp: new Date(),
      });
      
      // Save the enhanced message to session so follow-ups retain link context
      await this.sessionManager.addMessage(request.sessionId, {
        role: 'user',
        content: enhancedMessage,
        timestamp: Date.now(),
      });
    }

    // Build context with project info and memories
    const context = await buildContext({
      projectId: request.projectId,
      sessionId: request.sessionId,
      query: enhancedMessage || messages[messages.length - 1]?.content,
    });

    const agentContext: AgentContext = {
      sessionId: request.sessionId,
      projectId: request.projectId,
      userId: 'default_user',
      messages,
      tools: agentRegistry.get(request.agentId)?.tools || [],
      brandContext: context.projectContext?.brandMd,
      relevantMemories: context.recentMemories,
    };

    // Run the agent
    if (request.stream) {
      return this.runStreaming(request.agentId, agentContext);
    }

    const result = await runAgent(request.agentId, agentContext);

    // Handle agent directives
    const directives = parseDirectives(result.content);
    for (const directive of directives) {
      if (directive.type === 'MESSAGE_AGENT' && directive.target) {
        // Route to another agent
        return this.run({
          ...request,
          agentId: directive.target,
          messages: [
            ...messages,
            { role: 'assistant', content: `Routing to ${directive.target}: ${directive.payload}`, timestamp: new Date() },
          ],
        });
      }
    }

    // Store important interactions in memory
    if (result.content.length > 50) {
      storeMemory(
        `Agent ${request.agentId}: ${result.content.slice(0, 200)}...`,
        'pattern',
        { projectId: request.projectId, importance: 7 }
      );
    }
    
    // Save assistant response to session
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

  /**
   * Run with streaming response
   */
  private async runStreaming(agentId: string, context: AgentContext): Promise<RunResponse> {
    const agent = agentRegistry.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Run agent with streaming
    const stream = runAgentStream(agentId, context);

    return {
      content: '',
      stream,
    };
  }

  /**
   * Get available tools
   */
  getAvailableTools() {
    return toolRegistry.getAllSpecs();
  }

  /**
   * Get available agents
   */
  getAvailableAgents() {
    return agentRegistry.list().map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
    }));
  }
}

// Export types
export * from './types';
export { agentRegistry } from './registry';
export { runAgent } from './runtime';
