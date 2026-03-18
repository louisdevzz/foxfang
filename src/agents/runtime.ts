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
    
    // Build tool results for model (pass data, not formatted output)
    const toolResultsForModel = results.map(r => {
      const toolName = toolCallsWithIds.find(tc => tc.id === r.toolCallId)?.name;
      if (r.error) {
        return `${toolName}: Error: ${r.error}`;
      }
      // Pass data object to let model format the response naturally
      const data = r.data || r.output;
      return `${toolName}: ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }).join('\n');

    // Make another call with tool results
    // Include the assistant's tool call intent so model has full context
    const assistantToolCallMsg = response.content || `I'll use the ${toolCallsWithIds.map(tc => tc.name).join(', ')} tool to help you.`;
    
    const finalResponse = await provider.chat({
      model: agent.model || defaultModel,
      messages: [
        ...messages,
        { role: 'assistant', content: assistantToolCallMsg },
        { role: 'user', content: `[Tool Results - use this to answer the user]\n${toolResultsForModel}\n\nNow provide a helpful response to the user based on these results.` },
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
 * Handles tool calls in the stream and executes them
 */
export async function* runAgentStream(
  agentId: string,
  context: AgentContext
): AsyncGenerator<{ type: 'text' | 'tool_call' | 'tool_result' | 'done'; content?: string; tool?: string; args?: any; result?: any }> {
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

  // Stream response with tool call handling
  const pendingToolCalls: ToolCall[] = [];
  let fullContent = '';

  try {
    const stream = provider.chatStream({
      model: agent.model || defaultModel,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        fullContent += chunk.content || '';
        yield { type: 'text', content: chunk.content || '' };
      } else if (chunk.type === 'tool_call') {
        const toolCall: ToolCall = {
          id: `call_${Date.now()}_${pendingToolCalls.length}`,
          name: chunk.tool || '',
          arguments: chunk.args,
        };
        pendingToolCalls.push(toolCall);
        yield { type: 'tool_call', tool: chunk.tool, args: chunk.args };
      }
    }

    // Execute any pending tool calls
    if (pendingToolCalls.length > 0) {
      const results = await executeToolCalls(pendingToolCalls);
      
      for (const result of results) {
        yield { 
          type: 'tool_result', 
          tool: pendingToolCalls.find(tc => tc.id === result.toolCallId)?.name,
          result: result.error ? { error: result.error } : { data: result.data || result.output }
        };
      }

      // Continue conversation with tool results (pass data to model, not formatted output)
      const toolResultContent = results.map(r => {
        const toolName = pendingToolCalls.find(tc => tc.id === r.toolCallId)?.name;
        if (r.error) {
          return `${toolName}: Error: ${r.error}`;
        }
        // Pass data object to model, let it format the response
        const data = r.data || r.output;
        return `${toolName}: ${typeof data === 'object' ? JSON.stringify(data) : data}`;
      }).join('\n');

      // Make follow-up call with tool results
      const followUpStream = provider.chatStream({
        model: agent.model || defaultModel,
        messages: [
          ...messages,
          { role: 'assistant', content: fullContent },
          { role: 'user', content: `[Tool Results]\n${toolResultContent}` },
        ],
      });

      for await (const chunk of followUpStream) {
        if (chunk.type === 'content') {
          yield { type: 'text', content: chunk.content || '' };
        }
      }
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
    prompt += `\n\n## Available Tools\n\nYou have access to the following tools. Use them when needed to help the user:\n`;
    for (const toolName of context.tools) {
      const tool = toolRegistry.get(toolName);
      if (tool) {
        prompt += `- ${tool.name}: ${tool.description}\n`;
      }
    }
    prompt += '\nWhen you need to use a tool, the system will automatically detect and execute it.';
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
        data: result.success ? result.data : undefined,
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
