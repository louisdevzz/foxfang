// src/config/defaults.ts
// Default configuration values

import { homedir } from 'os';
import { join } from 'path';
import { AppConfig } from './schema';

// Resolve the default FoxFang home directory (~/.foxfang)
export function resolveFoxFangHome(): string {
  return process.env.FOXFANG_HOME || join(homedir(), '.foxfang');
}

export const defaultConfig: AppConfig = {
  gateway: {
    port: 8787,
    host: '0.0.0.0',
    enableCors: true,
    maxRequestSize: '10mb',
    rateLimit: {
      enabled: true,
      windowMs: 60000, // 1 minute
      maxRequests: 100
    }
  },

  providers: [],
  defaultProvider: 'openai',
  defaultModel: 'gpt-4o-mini',

  tools: {
    tools: {}
  },

  memory: {
    enabled: true,
    
    maxMessages: 50,
    ttl: 86400, // 24 hours
  },

  sessions: {
    maxSessions: 1000,
    defaultTtl: 3600, // 1 hour
    cleanupInterval: 3600, // 1 hour
    persistToDisk: true
  },

  plugins: [],

  security: {
    enableSandbox: false,
    maxToolExecutionTime: 30000, // 30 seconds
    maxTokensPerRequest: 4000,
    allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    requireAuthentication: false
  },

  logging: {
    level: 'info',
    format: 'pretty',
    destinations: ['console']
  },

  workspaceDir: resolveFoxFangHome(),
  cron: {
    enabled: true,
    pollIntervalMs: 30000
  },
  heartbeat: {
    enabled: true,
    intervalMs: 15000
  },
  observability: {
    enabled: true
  },
  agentRuntime: {
    defaultReasoningMode: 'balanced',
    maxRecentMessages: 4,
    maxRelevantMemories: 5,
    maxSourceSnippets: 3,
    maxSnippetTokens: 300,
    maxDelegations: 1,
    maxReviewPasses: 1,
    maxRewritePasses: 1,
    maxToolIterations: 5,
    toolCompressionThresholdChars: 1500,
    toolCacheTtlMs: 24 * 60 * 60 * 1000,
    routing: {
      defaultAgent: 'content-specialist',
      rules: [],
      outputModeHints: {
        short: ['short', 'brief', 'summary'],
        deep: ['deep', 'detailed', 'in-depth'],
      },
      toolTriggers: ['search', 'research', 'source', 'read link', 'check url'],
      reviewTriggers: ['review', 'optimize', 'improve', 'analyze', 'audit'],
      highStakesTriggers: ['launch', 'critical', 'important', 'brand-sensitive', 'public'],
    },
  },
  defaultSystemPrompt: `You are a helpful AI assistant for FoxFang.

You can help with:
- Marketing strategy and planning
- Content creation and optimization  
- Campaign analysis and insights
- Social media management
- Brand guidelines enforcement

Be professional, concise, and helpful. Use available tools when appropriate.`,
  defaultTemperature: 0.7,
  defaultMaxTokens: 2000
};

// Built-in tool defaults
export const builtinToolDefaults: Record<string, { enabled: boolean; timeout: number; requireApproval: boolean }> = {
  search_web: { enabled: true, timeout: 10000, requireApproval: false },
  memory_recall: { enabled: true, timeout: 5000, requireApproval: false },
  memory_store: { enabled: true, timeout: 5000, requireApproval: false },
  shell: { enabled: false, timeout: 30000, requireApproval: true },
  file_read: { enabled: true, timeout: 5000, requireApproval: false },
  file_write: { enabled: false, timeout: 5000, requireApproval: true },
};
