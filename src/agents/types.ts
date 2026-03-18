/**
 * Agent Types
 * 
 * Core type definitions for the agent system.
 */

export type AgentRole = 'orchestrator' | 'content-specialist' | 'strategy-lead' | 'growth-analyst';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  systemPrompt: string;
  tools: string[]; // Tool names this agent can use
  model?: string;
  provider?: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  agentId?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  error?: string;
}

export interface AgentContext {
  sessionId: string;
  projectId?: string;
  userId: string;
  messages: AgentMessage[];
  tools: string[];
  brandContext?: string; // BRAND.md content
  relevantMemories?: string[];
}

export interface AgentRequest {
  query: string;
  projectId?: string;
  sessionId?: string;
}

export interface AgentResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface RunRequest {
  sessionId: string;
  agentId: string;
  messages?: AgentMessage[];
  message?: string;
  projectId?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  stream?: boolean;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done';
  content?: string;
  tool?: string;
  args?: any;
  result?: any;
}

export interface RunResponse {
  content: string;
  messages?: AgentMessage[];
  toolCalls?: ToolCall[];
  stream?: AsyncIterable<StreamChunk>;
}

export interface AgentRunResult {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AgentDirective {
  type: 'MESSAGE_AGENT' | 'USE_TOOL' | 'COMPLETE';
  target?: string;
  payload: any;
}
