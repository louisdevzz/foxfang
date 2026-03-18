/**
 * Agent Runtime
 * 
 * Executes agent tasks with proper context and tool access.
 */

import { Agent, AgentContext, AgentMessage, AgentRunResult, ToolCall, ToolResult } from './types';
import { agentRegistry } from './registry';
import { getProvider } from '../providers/index';
import { toolRegistry } from '../tools/index';
import { ChatMessage } from '../providers/traits';

/**
 * Run an agent with the given context
 */
export async function runAgent(
  agentId: string,
  context: AgentContext
): Promise<AgentRunResult> {
  const agent = agentRegistry.get(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Build system prompt with context
  const systemPrompt = buildSystemPrompt(agent, context);

  // Get available tools for this agent
  const tools = agent.tools
    .map(name => toolRegistry.get(name))
    .filter(Boolean)
    .map(tool => ({
      name: tool!.name,
      description: tool!.description,
      parameters: tool!.parameters,
    }));

  // Convert messages to provider format (no 'tool' role)
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.messages
      .filter(m => m.role !== 'tool') // Filter out tool messages for now
      .map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
  ];

  // Get provider
  const provider = getProvider(agent.provider || 'default') || getProvider('openai');
  if (!provider) {
    throw new Error('No provider available');
  }

  // Call LLM
  const response = await provider.chat({
    model: agent.model || 'gpt-4o',
    messages,
    tools: tools.length > 0 ? tools : undefined,
  });

  // Handle tool calls
  if (response.toolCalls && response.toolCalls.length > 0) {
    // Convert provider tool calls to our format with IDs
    const toolCallsWithIds: ToolCall[] = response.toolCalls.map((tc, idx) => ({
      id: `call_${Date.now()}_${idx}`,
      name: tc.name,
      arguments: tc.arguments,
    }));

    const results = await executeToolCalls(toolCallsWithIds);
    
    // Add tool results to messages and continue
    const toolResultContent = results.map(r => 
      `${r.toolCallId}: ${r.error ? `Error: ${r.error}` : r.output}`
    ).join('\n');

    // Make another call with tool results
    const finalResponse = await provider.chat({
      model: agent.model || 'gpt-4o',
      messages: [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: `[Tool Results]\n${toolResultContent}` },
      ],
    });

    return {
      content: finalResponse.content,
      toolCalls: toolCallsWithIds,
      usage: finalResponse.usage,
    };
  }

  return {
    content: response.content,
    usage: response.usage,
  };
}

/**
 * Build system prompt with context
 */
function buildSystemPrompt(agent: Agent, context: AgentContext): string {
  let prompt = agent.systemPrompt;

  // Add brand context if available
  if (context.brandContext) {
    prompt += `\n\n=== BRAND CONTEXT ===\n${context.brandContext}\n`;
  }

  // Add relevant memories
  if (context.relevantMemories && context.relevantMemories.length > 0) {
    prompt += '\n=== RELEVANT MEMORIES ===\n';
    for (const memory of context.relevantMemories) {
      prompt += `- ${memory}\n`;
    }
  }

  // Add available tools
  prompt += '\n=== AVAILABLE TOOLS ===\n';
  for (const toolName of agent.tools) {
    const tool = toolRegistry.get(toolName);
    if (tool) {
      prompt += `- ${tool.name}: ${tool.description}\n`;
    }
  }

  return prompt;
}

/**
 * Execute tool calls
 */
async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of toolCalls) {
    try {
      const tool = toolRegistry.get(call.name);
      if (!tool) {
        results.push({
          toolCallId: call.id,
          output: '',
          error: `Tool not found: ${call.name}`,
        });
        continue;
      }

      const output = await tool.execute(call.arguments);
      results.push({
        toolCallId: call.id,
        output: JSON.stringify(output),
      });
    } catch (error) {
      results.push({
        toolCallId: call.id,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Parse agent directives from response
 */
export function parseDirectives(content: string): Array<{ type: string; target?: string; payload: string }> {
  const directives = [];
  
  // MESSAGE_AGENT: target | payload
  const messageMatch = content.match(/MESSAGE_AGENT:\s*(\S+)\s*\|\s*(.+)/i);
  if (messageMatch) {
    directives.push({
      type: 'MESSAGE_AGENT',
      target: messageMatch[1],
      payload: messageMatch[2],
    });
  }

  return directives;
}
