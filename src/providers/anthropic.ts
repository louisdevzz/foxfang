/**
 * Anthropic Provider
 */

import { Provider, ChatRequest, ChatResponse, StreamChunk } from './traits';
import { ProviderConfig } from './index';

interface AnthropicApiError {
  error?: { message?: string };
  message?: string;
}

interface AnthropicApiResponse {
  content?: Array<{ type: string; text?: string; name?: string; input?: any }>;
  usage?: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements Provider {
  name = 'Anthropic';
  private apiKey: string;
  private baseUrl = 'https://api.anthropic.com/v1';

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || '';
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model || 'claude-3-sonnet-20240229',
        max_tokens: 4096,
        messages: request.messages.map(m => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content,
        })),
        tools: request.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.json() as AnthropicApiError;
      throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
    }

    const data = await response.json() as AnthropicApiResponse;

    let content = '';
    const toolCalls: Array<{ name: string; arguments: any }> = [];

    for (const block of data.content || []) {
      if (block.type === 'text' && block.text) {
        content += block.text;
      } else if (block.type === 'tool_use' && block.name) {
        toolCalls.push({
          name: block.name,
          arguments: block.input,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model || 'claude-3-sonnet-20240229',
        max_tokens: 4096,
        messages: request.messages.map(m => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content,
        })),
        tools: request.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json() as AnthropicApiError;
      throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    const pendingToolCalls = new Map<number, { name: string; args: string }>();

    const flushToolCall = (index: number): StreamChunk | null => {
      const toolCall = pendingToolCalls.get(index);
      if (!toolCall?.name) {
        pendingToolCalls.delete(index);
        return null;
      }

      let args: any = {};
      try {
        args = toolCall.args ? JSON.parse(toolCall.args) : {};
      } catch {
        args = {};
      }

      pendingToolCalls.delete(index);
      return {
        type: 'tool_call',
        tool: toolCall.name,
        args,
      };
    };

    const flushAllToolCalls = function* (): Generator<StreamChunk> {
      for (const index of Array.from(pendingToolCalls.keys())) {
        const toolChunk = flushToolCall(index);
        if (toolChunk) {
          yield toolChunk;
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      let currentEvent: string | null = null;

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield* flushAllToolCalls();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const eventType = parsed.type || currentEvent;
            
            if (parsed.type === 'content_block_delta') {
              if (parsed.delta?.text) {
                yield { type: 'content', content: parsed.delta.text };
              }
            } else if (eventType === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
              pendingToolCalls.set(parsed.index ?? 0, {
                name: parsed.content_block.name || '',
                args: '',
              });
            } else if (eventType === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
              const index = parsed.index ?? 0;
              const existing = pendingToolCalls.get(index);
              if (existing && typeof parsed.delta.partial_json === 'string') {
                existing.args += parsed.delta.partial_json;
                pendingToolCalls.set(index, existing);
              }
            } else if (eventType === 'content_block_stop') {
              const toolChunk = flushToolCall(parsed.index ?? 0);
              if (toolChunk) {
                yield toolChunk;
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    yield* flushAllToolCalls();
  }

  async getStatus(): Promise<{ healthy: boolean; error?: string }> {
    if (!this.apiKey) {
      return { healthy: false, error: 'API key not configured' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      if (response.ok) {
        return { healthy: true };
      } else {
        return { healthy: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      return { healthy: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
