/**
 * Configuration Management
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

const CONFIG_DIR = join(homedir(), '.foxfang');
const CONFIG_FILE = join(CONFIG_DIR, 'foxfang.json');

export interface AppConfig {
  defaultProvider: string;
  defaultModel: string;
  providers: ProviderConfig[];
  tools: { tools?: Record<string, any> };
  sessions: { maxSessions: number; ttl: number };
  memory: { enabled: boolean; vectorStore?: string };
  daemon: { enabled: boolean; port: number; host: string };
  workspace: { homeDir: string };
  channels?: {
    telegram?: {
      enabled: boolean;
      botToken?: string;
      requireMentionInGroups?: boolean;
      groupActivation?: 'mention' | 'always';
    };
    discord?: {
      enabled: boolean;
      botToken?: string;
      requireMentionInGroups?: boolean;
      groupActivation?: 'mention' | 'always';
    };
    slack?: {
      enabled: boolean;
      botToken?: string;
      appToken?: string;
      requireMentionInGroups?: boolean;
      groupActivation?: 'mention' | 'always';
    };
    signal?: { 
      enabled: boolean; 
      phoneNumber: string;
      httpUrl?: string;
      requireMentionInGroups?: boolean;
      groupActivation?: 'mention' | 'always';
    };
  };
  autoReply?: {
    /** Legacy boolean flag kept for compatibility */
    requireMentionInGroups?: boolean;
    /** Activation mode for group conversations */
    groupActivation?: 'mention' | 'always';
    /** Fallback agent when no binding matches */
    defaultAgent?: string;
    /** Default session grouping scope when no binding overrides it */
    defaultSessionScope?: 'from' | 'chat' | 'thread' | 'chat-thread';
    /** Optional route bindings by channel/account/chat/thread */
    bindings?: Array<{
      id?: string;
      enabled?: boolean;
      priority?: number;
      channel?: 'telegram' | 'discord' | 'slack' | 'signal' | string;
      chatType?: 'private' | 'group' | 'channel';
      chatId?: string | string[];
      threadId?: string | string[];
      fromId?: string | string[];
      accountId?: string | string[];
      metadata?: Record<string, string | string[]>;
      agentId: string;
      sessionScope?: 'from' | 'chat' | 'thread' | 'chat-thread';
    }>;
  };
  observability: { enabled: boolean };
  agentRuntime?: {
    defaultReasoningMode?: 'fast' | 'balanced' | 'deep';
    maxRecentMessages?: number;
    maxRelevantMemories?: number;
    maxSourceSnippets?: number;
    maxSnippetTokens?: number;
    maxDelegations?: number;
    maxReviewPasses?: number;
    maxRewritePasses?: number;
    maxToolIterations?: number;
    toolCompressionThresholdChars?: number;
    toolCacheTtlMs?: number;
    routing?: {
      defaultAgent?: string;
      rules?: Array<{
        agentId: string;
        taskType: string;
        keywords: string[];
        needsReview?: boolean;
      }>;
      outputModeHints?: {
        short?: string[];
        deep?: string[];
      };
      toolTriggers?: string[];
      reviewTriggers?: string[];
      highStakesTriggers?: string[];
    };
  };
  heartbeat: { enabled: boolean; intervalMs: number };
  cron: { enabled: boolean; pollIntervalMs: number };
  security: { allowedOrigins: string[] };
  gateway: {
    port: number;
    host: string;
    enableCors: boolean;
    maxRequestSize: string;
    auth?: {
      mode: 'token' | 'password';
      token?: string;
      password?: string;
    };
  };
  // Optional web tool API keys (now stored in credentials, config keeps only ref)
  braveSearch?: { apiKey?: string; apiKeyRef?: string };
  firecrawl?: { apiKey?: string; apiKeyRef?: string; baseUrl?: string };
  github?: { connected?: boolean; username?: string; connectedAt?: string };
  notion?: { apiKey?: string; apiKeyRef?: string; defaultDatabaseId?: string };
  agents?: Array<{
    id: string;
    name?: string;
    role?: string;
    description?: string;
    systemPrompt?: string;
    tools?: string[];
    model?: string;
    provider?: string;
    executionProfile?: {
      modelTier?: 'small' | 'medium' | 'large';
      verbosity?: 'low' | 'normal' | 'high';
      reasoningDepth?: 'light' | 'normal' | 'deep';
    };
  }>;
}

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string;
  enabled: boolean;
  baseUrl?: string;
  models?: string[];
  headers?: Record<string, string>;
  apiType?: 'openai' | 'anthropic-messages' | string;
}

const defaultConfig: AppConfig = {
  defaultProvider: 'kimi-coding',
  defaultModel: 'k2p5',
  providers: [],
  tools: {},
  sessions: { maxSessions: 100, ttl: 86400000 },
  memory: { enabled: true },
  daemon: { enabled: false, port: 8787, host: '127.0.0.1' },
  workspace: { homeDir: join(homedir(), '.foxfang') },
  autoReply: {
    requireMentionInGroups: false,
    groupActivation: 'always',
    defaultAgent: 'orchestrator',
    defaultSessionScope: 'chat-thread',
    bindings: [],
  },
  observability: { enabled: true },
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
  heartbeat: { enabled: true, intervalMs: 30000 },
  cron: { enabled: true, pollIntervalMs: 60000 },
  security: { allowedOrigins: ['http://localhost:3000'] },
  gateway: { port: 8787, host: '0.0.0.0', enableCors: true, maxRequestSize: '10mb' },
  agents: [],
};

export async function loadConfig(): Promise<AppConfig> {
  await mkdir(CONFIG_DIR, { recursive: true });
  
  if (!existsSync(CONFIG_FILE)) {
    await saveConfig(defaultConfig);
    return { ...defaultConfig };
  }
  
  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    const merged = { ...defaultConfig, ...parsed } as AppConfig;
    merged.autoReply = {
      ...(defaultConfig.autoReply || {}),
      ...((parsed?.autoReply as AppConfig['autoReply']) || {}),
    };
    return merged;
  } catch (error) {
    console.error('Failed to load config, using defaults:', error);
    return { ...defaultConfig };
  }
}

/**
 * Load config with credentials merged from keychain/credentials store
 * This is the main function to use when initializing the app
 */
export async function loadConfigWithCredentials(): Promise<AppConfig> {
  const config = await loadConfig();
  
  // Dynamically import credentials to avoid circular dependency
  const { getCredential, isKeychainAvailable } = await import('../credentials/index');
  
  // Merge credentials from keychain into provider configs
  if (config.providers) {
    for (const provider of config.providers) {
      if (!provider.apiKey) {
        // Try to load from credentials store
        const credential = await getCredential(provider.id);
        if (credential) {
          provider.apiKey = credential.apiKey;
          if (credential.baseUrl) provider.baseUrl = credential.baseUrl;
          if (credential.headers) provider.headers = credential.headers;
          if (credential.apiType) provider.apiType = credential.apiType;
        }
      }
    }
  }
  
  // Merge channel credentials
  if (config.channels) {
    const { getCredential } = await import('../credentials/index');
    const channels = ['telegram', 'discord', 'slack'] as const;
    
    for (const channel of channels) {
      const channelConfig = config.channels[channel];
      if (channelConfig && !channelConfig.botToken) {
        const credential = await getCredential(`channel:${channel}`);
        if (credential) {
          channelConfig.botToken = credential.apiKey;
        }
      }
    }
  }
  
  return config;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function getConfigPath(): Promise<string> {
  return CONFIG_FILE;
}

export async function resetConfig(): Promise<void> {
  await saveConfig(defaultConfig);
}

export async function getConfig(): Promise<AppConfig> {
  return loadConfig();
}

export async function editConfig(): Promise<void> {
  const editor = process.env.EDITOR || 'nano';
  const child = spawn(editor, [CONFIG_FILE], {
    stdio: 'inherit',
  });
  
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Editor exited with code ${code}`));
      }
    });
  });
}
