/**
 * Agent Types
 * 
 * Core type definitions for the agent system.
 */

export type AgentRole = 'orchestrator' | 'content-specialist' | 'strategy-lead' | 'growth-analyst';

export type ReasoningMode = 'fast' | 'balanced' | 'deep';

export type AgentExecutionProfile = {
  modelTier: 'small' | 'medium' | 'large';
  verbosity: 'low' | 'normal' | 'high';
  reasoningDepth: 'light' | 'normal' | 'deep';
};

export type AgentRoute = {
  primaryAgent: 'content-specialist' | 'strategy-lead' | 'growth-analyst';
  needsTools: boolean;
  needsReview: boolean;
  taskType: string;
  outputMode: 'short' | 'normal' | 'deep';
};

export type AgentHandoff = {
  userIntent: string;
  taskGoal: string;
  targetAudience?: string;
  brandVoice?: string;
  constraints: string[];
  keyFacts: string[];
  sourceSnippets: string[];
  expectedOutput: string;
};

export type OutputSpec = {
  format: 'bullet' | 'article' | 'thread' | 'plan' | 'json';
  length: 'short' | 'medium' | 'long';
  sections?: string[];
  mustInclude?: string[];
};

export type ReviewResult = {
  verdict: 'pass' | 'revise';
  issues: string[];
  strengths: string[];
  recommendedEdits: string[];
};

export type QualityCheck = {
  hasClearGoalMatch: boolean;
  hasEnoughSpecificity: boolean;
  hasActionableContent: boolean;
  hasUnsupportedClaims: boolean;
  tooGeneric: boolean;
  tooShort: boolean;
};

export type SessionSummary = {
  currentGoal: string;
  importantDecisions: string[];
  activeConstraints: string[];
  openLoops: string[];
  brandContext?: string;
};

export type TokenBudget = {
  requestMaxInputTokens: number;
  requestMaxOutputTokens: number;
  remainingInputTokens: number;
  remainingOutputTokens: number;
  maxToolIterations: number;
  maxDelegations: number;
  maxReviewPasses: number;
};

export type CompactToolResult = {
  source: string;
  title?: string;
  summary: string;
  keyPoints: string[];
  usefulQuotes?: string[];
  relevanceToTask: string;
  rawRef?: string;
};

export type RequestTrace = {
  requestId: string;
  agentsInvoked: string[];
  totalInputTokens: number;
  totalOutputTokens: number;
  perAgentUsage: Array<{
    agent: string;
    inputTokens: number;
    outputTokens: number;
  }>;
  toolCalls: Array<{
    tool: string;
    rawSize: number;
    compactSize: number;
  }>;
  numberOfDelegations: number;
  numberOfReviewPasses: number;
  totalLatencyMs: number;
};

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  systemPrompt: string;
  tools: string[]; // Tool names this agent can use
  model?: string;
  provider?: string;
  executionProfile?: AgentExecutionProfile;
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
  data?: any; // Structured data for model to format
  compact?: CompactToolResult;
  rawSize?: number;
  compactSize?: number;
  rawRef?: string;
}

export interface AgentContext {
  sessionId: string;
  projectId?: string;
  userId: string;
  messages: AgentMessage[];
  tools: string[];
  brandContext?: string; // BRAND.md content
  relevantMemories?: string[];
  sessionSummary?: SessionSummary;
  handoff?: AgentHandoff;
  outputSpec?: OutputSpec;
  sourceSnippets?: string[];
  systemAddendum?: string;
  reasoningMode?: ReasoningMode;
  budget?: TokenBudget;
  trace?: RequestTrace;
  workspace?: WorkspaceManagerLike; // For workspace file injection
}

// Minimal interface to avoid circular dependency with WorkspaceManager
export interface WorkspaceManagerLike {
  readFile(filename: string): string | null;
  getWorkspaceInfo?(): { homeDir: string; workspacePath: string };
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
  toolTelemetry?: Array<{
    tool: string;
    rawSize: number;
    compactSize: number;
  }>;
}

export interface AgentDirective {
  type: 'MESSAGE_AGENT' | 'USE_TOOL' | 'COMPLETE';
  target?: string;
  payload: any;
}
