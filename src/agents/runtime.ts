/**
 * Agent Runtime
 * 
 * Executes agent tasks with proper context and tool access.
 */

import { Agent, AgentContext, AgentRunResult, ToolCall, ToolResult } from './types';
import { agentRegistry } from './registry';
import { getProvider } from '../providers/index';
import { toolRegistry } from '../tools/index';
import { ChatMessage } from '../providers/traits';

let defaultProviderId: string | undefined;

export function setDefaultProvider(providerId: string): void {
  defaultProviderId = providerId;
}

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

  // Get provider - use agent's provider, or default, or first available
  const providerId = agent.provider || defaultProviderId;
  let provider = providerId ? getProvider(providerId) : undefined;
  if (!provider) {
    // Fallback to first available provider
    provider = getProvider('openai') || getProvider('anthropic') || getProvider('kimi') || getProvider('kimi-coding');
  }
  if (!provider) {
    throw new Error('No provider available. Please configure an AI provider first.');
  }

  // Get the actual provider ID for model selection
  const actualProviderId = agent.provider || defaultProviderId || 'openai';
  const defaultModel = actualProviderId === 'kimi-coding' ? 'kimi-code' : 
                       actualProviderId === 'kimi' ? 'moonshot-v1-8k' :
                       actualProviderId === 'anthropic' ? 'claude-3-5-sonnet-latest' :
                       'gpt-4o';

  // Call LLM
  let response;
  try {
    response = await provider.chat({
      model: agent.model || defaultModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });
  } catch (error) {
    console.error('Provider chat error:', error);
    throw new Error(`Failed to get response from ${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
  }

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
      model: agent.model || defaultModel,
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
 * Run agent with streaming response
 */
export async function* runAgentStream(
  agentId: string,
  context: AgentContext
): AsyncGenerator<{ type: 'text' | 'done'; content?: string }> {
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

  // Convert messages to provider format
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.messages
      .filter(m => m.role !== 'tool')
      .map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
  ];

  // Get provider
  const providerId = agent.provider || defaultProviderId;
  let provider = providerId ? getProvider(providerId) : undefined;
  if (!provider) {
    provider = getProvider('openai') || getProvider('anthropic') || getProvider('kimi') || getProvider('kimi-coding');
  }
  if (!provider) {
    throw new Error('No provider available');
  }

  const actualProviderId = agent.provider || defaultProviderId || 'openai';
  const defaultModel = actualProviderId === 'kimi-coding' ? 'kimi-code' : 
                       actualProviderId === 'kimi' ? 'moonshot-v1-8k' :
                       actualProviderId === 'anthropic' ? 'claude-3-5-sonnet-latest' :
                       'gpt-4o';

  // Stream response
  try {
    const stream = provider.chatStream({
      model: agent.model || defaultModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    for await (const chunk of stream) {
      yield { type: 'text', content: chunk.content || '' };
    }

    yield { type: 'done' };
  } catch (error) {
    yield { type: 'text', content: `\nError: ${error instanceof Error ? error.message : String(error)}\n` };
    yield { type: 'done' };
  }
}

/**
 * Build system prompt with context
 */
function buildSystemPrompt(agent: Agent, context: AgentContext): string {
  let prompt = agent.systemPrompt;

  // Add brand context if available
  if (context.brandContext) {
    prompt += `\n\n## Brand Context\n\n${context.brandContext}`;
  }

  // Add relevant memories
  if (context.relevantMemories && context.relevantMemories.length > 0) {
    prompt += `\n\n## Relevant Context\n\n${context.relevantMemories.join('\n')}`;
  }

  // Add tool instructions
  if (context.tools.length > 0) {
    prompt += `\n\n## Available Tools\n\nYou have access to the following tools:\n`;
    for (const toolName of context.tools) {
      const tool = toolRegistry.get(toolName);
      if (tool) {
        prompt += `- ${tool.name}: ${tool.description}\n`;
      }
    }
    prompt += '\nTo use a tool, respond with: USE_TOOL: <tool_name> | <json_arguments>';
  }

  return prompt;
}

/**
 * Execute tool calls and return results
 */
async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const toolCall of toolCalls) {
    try {
      const tool = toolRegistry.get(toolCall.name);
      if (!tool) {
        results.push({
          toolCallId: toolCall.id,
          output: '',
          error: `Tool not found: ${toolCall.name}`,
        });
        continue;
      }

      const result = await tool.execute(toolCall.arguments);
      results.push({
        toolCallId: toolCall.id,
        output: result.success ? String(result.output) : '',
        error: result.success ? undefined : result.error,
      });
    } catch (error) {
      results.push({
        toolCallId: toolCall.id,
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
  const messageMatch = content.match(/MESSAGE_AGENT:\s*(\w+)\s*\|\s*(.+)/i);
  if (messageMatch) {
    directives.push({
      type: 'MESSAGE_AGENT',
      target: messageMatch[1],
      payload: messageMatch[2].trim(),
    });
  }

  return directives;
}
