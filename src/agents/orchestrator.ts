/**
 * Agent Orchestrator
 * 
 * Routes user requests to appropriate specialist agents and manages the conversation flow.
 */

import { AgentRequest, AgentResponse, RunRequest, RunResponse, AgentContext, AgentMessage, StreamChunk } from './types';
import { agentRegistry } from './registry';
import { runAgent, parseDirectives } from './runtime';
import { SessionManager } from '../sessions/manager';
import { toolRegistry } from '../tools/index';
import { buildContext } from '../context-engine';
import { storeMemory, searchMemories } from '../memory/database';

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
    const session = this.sessionManager.getSession(request.sessionId);
    const messages: AgentMessage[] = request.messages || [];
    
    if (request.message) {
      messages.push({
        role: 'user',
        content: request.message,
        timestamp: new Date(),
      });
    }

    // Build context with project info and memories
    const context = await buildContext({
      projectId: request.projectId,
      sessionId: request.sessionId,
      query: request.message || messages[messages.length - 1]?.content,
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
    const agentName = agent.name;

    // For now, simulate streaming
    // In production, this would use the provider's streaming API
    async function* streamGenerator(): AsyncGenerator<StreamChunk> {
      yield { type: 'text', content: `🦊 ${agentName} is thinking...\n\n` };
      
      // Simulate thinking delay
      await new Promise(r => setTimeout(r, 500));
      
      yield { type: 'text', content: 'Processing your request with context from ' };
      
      if (context.brandContext) {
        yield { type: 'text', content: 'BRAND.md, ' };
      }
      
      if (context.relevantMemories && context.relevantMemories.length > 0) {
        yield { type: 'text', content: `${context.relevantMemories.length} memories...\n\n` };
      } else {
        yield { type: 'text', content: 'no prior memories...\n\n' };
      }
      
      yield { type: 'done' };
    }

    return {
      content: '',
      stream: streamGenerator(),
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
