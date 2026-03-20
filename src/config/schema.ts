// src/config/schema.ts
// Configuration schema and types

// Provider configuration
export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  priority?: number; // For provider routing
  models?: string[]; // Available models
}

// Tool configuration
export interface ToolConfig {
  enabled: boolean;
  timeout?: number;
  requireApproval?: boolean;
}

export interface ToolsPolicyConfig {
  tools?: Record<string, ToolConfig>;
}

// Memory configuration
export interface MemoryConfig {
  enabled: boolean;
  
  connectionString?: string;
  maxMessages?: number;
  ttl?: number; // Time to live in seconds
  embeddingProvider?: string;
  embeddingModel?: string;
}

// Session configuration
export interface SessionConfig {
  maxSessions: number;
  defaultTtl: number; // seconds
  cleanupInterval: number; // seconds
  persistToDisk: boolean;
  maxMessages?: number; // Max messages to keep in session history
}

// Plugin configuration
export interface PluginConfig {
  id: string;
  enabled: boolean;
  path?: string;
  config?: Record<string, any>;
}

// Security configuration
export interface SecurityConfig {
  enableSandbox: boolean;
  maxToolExecutionTime: number; // milliseconds
  maxTokensPerRequest: number;
  allowedOrigins: string[];
  requireAuthentication: boolean;
  apiKeyHeader?: string;
}

// Gateway configuration
export interface GatewayConfig {
  port: number;
  host: string;
  enableCors: boolean;
  maxRequestSize: string;
  rateLimit: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
  };
}

// Logging configuration
export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'pretty';
  destinations?: ('console' | 'file')[];
  filePath?: string;
}

export interface CronConfig {
  enabled: boolean;
  pollIntervalMs: number;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
}

export interface ObservabilityConfig {
  enabled: boolean;
}

export interface AutoReplyConfig {
  requireMentionInGroups?: boolean;
  groupActivation?: 'mention' | 'always';
}

// Twitter OAuth configuration
export interface TwitterOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

// Firecrawl configuration (optional)
export interface FirecrawlConfig {
  apiKey?: string;
  baseUrl?: string;
}

// Brave Search configuration (optional)
export interface BraveSearchConfig {
  apiKey?: string;
}

// GitHub integration metadata (optional)
export interface GitHubConfig {
  connected?: boolean;
  username?: string;
  connectedAt?: string;
}

// Main application configuration
export interface AppConfig {
  // Server settings
  gateway: GatewayConfig;
  
  // AI providers (multiple for failover)
  providers: ProviderConfig[];
  defaultProvider: string;
  defaultModel: string;
  
  // Tool system
  tools: ToolsPolicyConfig;
  
  // Memory/persistence
  memory: MemoryConfig;
  sessions: SessionConfig;
  
  // Plugins
  plugins: PluginConfig[];
  
  // Security
  security: SecurityConfig;
  
  // Logging
  logging: LoggingConfig;
  
  // Workspace
  workspaceDir: string;

  // Cron + Heartbeat + Observability
  cron: CronConfig;
  heartbeat: HeartbeatConfig;
  observability: ObservabilityConfig;
  autoReply?: AutoReplyConfig;
  
  // Twitter OAuth (optional)
  twitter?: TwitterOAuthConfig;

  // Web tools (optional)
  firecrawl?: FirecrawlConfig;
  braveSearch?: BraveSearchConfig;
  github?: GitHubConfig;

  // Agent defaults
  defaultSystemPrompt?: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
}

// Environment variable mapping
export interface EnvConfig {
  // Server
  PORT?: string;
  HOST?: string;
  
  // Provider (OpenAI)
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  
  // Provider (Anthropic)
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL?: string;
  
  // Provider (Google)
  GOOGLE_API_KEY?: string;
  GOOGLE_MODEL?: string;
  
  // Provider (Kimi)
  KIMI_API_KEY?: string;
  KIMI_BASE_URL?: string;
  KIMI_MODEL?: string;
  
  // Security
  API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  
  // Memory
  MEMORY_BACKEND?: string;
  DATABASE_URL?: string;
  
  // Logging
  LOG_LEVEL?: string;
  LOG_FORMAT?: string;
  
  // Workspace
  WORKSPACE_DIR?: string;

  // Cron/Heartbeat
  CRON_POLL_MS?: string;
  HEARTBEAT_INTERVAL_MS?: string;

  // Twitter OAuth
  TWITTER_CLIENT_ID?: string;
  TWITTER_CLIENT_SECRET?: string;
  TWITTER_CALLBACK_URL?: string;
}
