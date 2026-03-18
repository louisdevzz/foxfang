/**
 * Kimi Provider
 */

import { Provider, ChatRequest, ChatResponse, StreamChunk } from './traits';
import { ProviderConfig } from './index';

interface KimiApiError {
  error?: { message?: string };
  message?: string;
}

interface KimiApiResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Kimi Coding Provider
 * 
 * Uses Anthropic Messages API format with special User-Agent header
 * Base URL: https://api.kimi.com/coding/
 */
export class KimiCodingProvider implements Provider {
  name = 'Kimi Coding';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || '';
    this.baseUrl = config.baseUrl || 'https://api.kimi.com/coding/';
    // Remove trailing slash for consistency
    this.baseUrl = this.baseUrl.replace(/\/$/, '');
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'User-Agent': 'claude-code/0.1.0',
    };
  }

  private transformMessages(messages: Array<{role: string; content: string}>): Array<{role: string; content: string}> {
    // Kimi Coding uses Anthropic format which is compatible with OpenAI format
    // but may need role mapping
    return messages.map(m => ({
      role: m.role === 'system' ? 'user' : m.role, // Anthropic doesn't have system role
      content: m.content,
    }));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: request.model || 'kimi-code',
        messages: this.transformMessages(request.messages),
        max_tokens: 4096,
        tools: request.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kimi Coding API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as {
      content?: Array<{type?: string; text?: string; name?: string; input?: any}>;
      completion?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    
    // Debug: log raw response structure
    console.error('[KimiCoding] Response:', JSON.stringify(data, null, 2).slice(0, 500));
    
    const result: ChatResponse = {
      content: data.content?.[0]?.text || data.completion || '',
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };

    // Handle tool use if present
    if (data.content?.[0]?.type === 'tool_use') {
      result.toolCalls = [{
        name: data.content[0].name || '',
        arguments: data.content[0].input,
      }];
    }

    return result;
  }

  async *chatStream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: request.model || 'kimi-code',
        messages: this.transformMessages(request.messages),
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kimi Coding API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent: string | null = null;
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('event:')) {
          currentEvent = trimmedLine.slice(6).trim();
        } else if (trimmedLine.startsWith('data:')) {
          const data = trimmedLine.slice(5).trim();
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            
            // Handle Anthropic SSE format: content_block_delta with text_delta
            if (currentEvent === 'content_block_delta' && parsed.delta) {
              if (parsed.delta.type === 'text_delta' && parsed.delta.text) {
                yield { type: 'content', content: parsed.delta.text };
              }
            }
            // Handle message_delta for stop reason
            else if (currentEvent === 'message_delta' && parsed.delta?.stop_reason) {
              // Stream ending
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  async getStatus(): Promise<{ healthy: boolean; error?: string }> {
    if (!this.apiKey) {
      return { healthy: false, error: 'API key not configured' };
    }

    try {
      // Kimi Coding doesn't have a models endpoint, try a minimal request
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'kimi-code',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });

      if (response.ok || response.status === 400) { // 400 is ok, means auth worked
        return { healthy: true };
      } else {
        return { healthy: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      return { healthy: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class KimiProvider implements Provider {
  name = 'Kimi';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || '';
    this.baseUrl = config.baseUrl || 'https://api.moonshot.cn/v1';
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || 'kimi-coding',
        messages: request.messages,
        tools: request.tools?.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.json() as KimiApiError;
      throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
    }

    const data = await response.json() as KimiApiResponse;
    
    const message = data.choices?.[0]?.message;
    const result: ChatResponse = {
      content: message?.content || '',
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    };

    if (message?.tool_calls) {
      result.toolCalls = message.tool_calls.map((tc: any) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    return result;
  }

  async *chatStream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || 'kimi-coding',
        messages: request.messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json() as KimiApiError;
      throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              yield { type: 'content', content: delta.content };
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  async getStatus(): Promise<{ healthy: boolean; error?: string }> {
    if (!this.apiKey) {
      return { healthy: false, error: 'API key not configured' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
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
