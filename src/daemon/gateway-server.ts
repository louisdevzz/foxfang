#!/usr/bin/env node
/**
 * FoxFang Gateway Server
 * 
 * Runs as a persistent service, manages:
 * - WebSocket connections from CLI
 * - Channel connections (Telegram, Discord, Slack, Signal)
 * - Message routing between channels and agents
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import chalk from 'chalk';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'url';
import { getConfigPath, loadConfig, loadConfigWithCredentials, saveConfig } from '../config/index';
import { initializeProviders } from '../providers/index';
import { AgentOrchestrator } from '../agents/orchestrator';
import { agentRegistry, hydrateAgentRegistryFromConfig, DEFAULT_AGENT_ID } from '../agents/registry';
import { SessionManager } from '../sessions/manager';
import { initializeTools, wireDelegateOrchestrator } from '../tools/index';
import { setDefaultProvider } from '../agents/runtime';
import { ChannelManager } from '../channels/manager';
import { CronService } from '../cron/service';
import { setCronService } from '../tools/builtin/cron';
import { initCronTables } from '../cron/store';
import { createWorkspaceManager } from '../workspace/manager';
import { initFoxFangHome } from '../workspace/manager';
import { GITHUB_OAUTH_PROXY, disconnectGitHub, getGitHubToken, saveGitHubToken } from '../integrations/github';
import { getCredential, saveCredential } from '../credentials/index';

const PORT = parseInt(
  process.env.FOXFANG_GATEWAY_PORT || process.env.PORT || '8787',
  10
);
const ENV_CHANNELS = (process.env.FOXFANG_CHANNELS || '')
  .split(',')
  .map((channel) => channel.trim())
  .filter(Boolean);

type ProviderPreset = {
  id: string;
  name: string;
  baseUrl?: string;
  models: string[];
};

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o4-mini'],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-6-20250514', 'claude-opus-4-6-20250605', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514'],
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  'kimi-coding': {
    id: 'kimi-coding',
    name: 'Kimi Coding',
    baseUrl: 'https://api.kimi.com/coding/',
    models: ['kimi-code', 'k2p5'],
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview'],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b', 'moonshotai/kimi-k2-instruct-0905', 'openai/gpt-oss-120b'],
  },
  'byteplus-ark': {
    id: 'byteplus-ark',
    name: 'BytePlus Ark',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    models: ['doubao-seed-1-8-251228', 'seed-1-6-250915', 'doubao-1-5-pro-32k', 'doubao-1-5-lite-32k'],
  },
  alibabacloud: {
    id: 'alibabacloud',
    name: 'Alibaba Cloud (Qwen)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-max', 'qwen3.5-plus', 'qwen3.5-flash', 'qwen-plus', 'qwen-flash', 'qwen-turbo', 'qwq-plus', 'qwen3-coder-plus', 'qwen-long'],
  },
  'github-copilot': {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    baseUrl: '',
    models: ['gpt-4.1', 'gpt-5-mini', 'gpt-5.4-mini', 'claude-sonnet-4.6', 'claude-opus-4.6', 'gemini-2.5-pro', 'gemini-3-flash'],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openrouter/free', 'google/gemini-2.0-flash-exp:free', 'meta-llama/llama-4-maverick:free', 'deepseek/deepseek-chat:free', 'openai/gpt-4o', 'anthropic/claude-sonnet-4'],
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.1', 'qwen2.5', 'deepseek-coder'],
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: [], // Fetched dynamically from NVIDIA API
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    baseUrl: '',
    models: [],
  },
};

type ProviderSetupInput = {
  id: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enabled?: boolean;
};

type ChannelSetupInput = {
  enabled?: boolean;
  botToken?: string;
  appToken?: string;
  phoneNumber?: string;
  httpUrl?: string;
  requireMentionInGroups?: boolean;
  groupActivation?: string;
};

type SetupPayload = {
  defaultProvider?: string;
  defaultModel?: string;
  providers?: ProviderSetupInput[];
  autoReply?: {
    defaultAgent?: string;
    defaultSessionScope?: string;
    bindings?: Array<{
      id?: string;
      enabled?: boolean;
      priority?: number;
      channel?: string;
      chatType?: string;
      chatId?: string | string[];
      threadId?: string | string[];
      fromId?: string | string[];
      accountId?: string | string[];
      metadata?: Record<string, string | string[]>;
      agentId?: string;
      sessionScope?: string;
    }>;
  };
  channels?: {
    telegram?: ChannelSetupInput;
    discord?: ChannelSetupInput;
    slack?: ChannelSetupInput;
    signal?: ChannelSetupInput;
  };
  braveSearchApiKey?: string;
  firecrawlApiKey?: string;
  notionApiKey?: string;
};

type SetupModelsPayload = {
  providerId?: string;
  apiKey?: string;
  baseUrl?: string;
};

type SignalRegisterPayload = {
  phoneNumber?: string;
  useVoice?: boolean;
  captcha?: string;
};

type SignalVerifyPayload = {
  phoneNumber?: string;
  code?: string;
  pin?: string;
};

type SignalQrPayload = {
  deviceName?: string;
};

interface ClientConnection {
  ws: WebSocket;
  id: string;
  type: 'cli' | 'channel';
  channelName?: string;
}

class GatewayServer {
  private wss: WebSocketServer;
  private clients: Map<string, ClientConnection> = new Map();
  private orchestrator: AgentOrchestrator | null = null;
  private sessionManager: SessionManager | null = null;
  private channelManager: ChannelManager;
  private cronService: CronService | null = null;
  private startedAt = Date.now();
  private restartScheduled = false;
  private githubOAuthStates: Map<string, number> = new Map();
  private enabledChannels: string[] = [...ENV_CHANNELS];

  constructor(port: number) {
    const server = createServer((req, res) => {
      void this.handleHttpRequest(req, res).catch((error) => {
        console.error('[Gateway] HTTP route error:', error);
        if (!res.headersSent) {
          this.sendJson(res, 500, { error: 'Internal server error' });
        } else {
          res.end();
        }
      });
    });
    this.wss = new WebSocketServer({ server });
    this.channelManager = new ChannelManager(this.enabledChannels, {
      autoReply: {
        // Auto-reply is initially disabled to avoid using a hard-coded default
        // agent before config/agent registry hydration completes in initialize().
        enabled: false,
        defaultAgent: 'main',
        requireMention: false,
        replyToMessage: true,
      },
    });
    
    // Initialize cron tables
    initCronTables();
    
    this.setupWebSocket();
    void this.initialize().catch((err) => {
      console.error('[Gateway] Initialization failed:', err);
      process.exit(1);
    });
    
    server.listen(port, async () => {
      console.log(`[Gateway] Server listening on port ${port}`);
      
      // Display UI URL with auth token if available
      try {
        const config = await loadConfigWithCredentials();
        const auth = config.gateway?.auth;
        if (auth) {
          let accessUrl: string;
          if (auth.mode === 'token' && auth.token) {
            accessUrl = `http://localhost:${port}/?token=${encodeURIComponent(auth.token)}`;
          } else if (auth.mode === 'password' && auth.password) {
            accessUrl = `http://localhost:${port}/?token=${encodeURIComponent(auth.password)}`;
          } else {
            accessUrl = `http://localhost:${port}/`;
          }
          console.log(`[Gateway] Web UI: ${accessUrl}`);
          console.log(chalk.dim(`         Click or copy the link above to open the dashboard`));
        }
      } catch (error) {
        console.log(`[Gateway] Web UI: http://localhost:${port}/`);
      }
    });
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://localhost');

    if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
      this.sendJson(res, 200, {
        status: 'ok',
        uptimeMs: Date.now() - this.startedAt,
        clients: this.clients.size,
        channels: this.enabledChannels,
      });
      return;
    }

    // Setup routes (with Basic Auth)
    if (url.pathname.startsWith('/setup')) {
      await this.handleSetupRoute(req, res, method, url.pathname);
      return;
    }

    // API routes (with Bearer Token Auth)
    if (url.pathname.startsWith('/api')) {
      await this.handleApiRoute(req, res, method, url.pathname);
      return;
    }

    // Serve UI static files (React SPA) - all other routes
    // Check if requesting a static file (has extension)
    const hasExtension = /\.[^/]+$/.test(url.pathname);
    
    if (hasExtension || url.pathname === '/') {
      // Serve static file directly
      const uiPath = url.pathname === '/' ? '/index.html' : url.pathname;
      await this.serveStaticFile(res, '/ui' + uiPath);
    } else {
      // SPA fallback - serve index.html for client-side routes
      await this.serveStaticFile(res, '/ui/index.html');
    }
  }

  private async handleSetupRoute(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string
  ): Promise<void> {
    if (!this.isSetupAuthValid(req, res)) {
      return;
    }

    if (method === 'GET' && pathname === '/setup') {
      this.sendHtml(res, this.renderSetupPage());
      return;
    }

    // --- GitHub Copilot device code login ---
    if (method === 'POST' && pathname === '/setup/copilot/login') {
      try {
        const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
        const codeRes = await fetch('https://github.com/login/device/code', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `client_id=${COPILOT_CLIENT_ID}&scope=read:user`,
        });
        if (!codeRes.ok) {
          this.sendJson(res, 500, { ok: false, error: `Device code request failed: ${codeRes.status}` });
          return;
        }
        const codeData = await codeRes.json() as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
        this.sendJson(res, 200, {
          ok: true,
          device_code: codeData.device_code,
          user_code: codeData.user_code,
          verification_uri: codeData.verification_uri,
          expires_in: codeData.expires_in,
          interval: codeData.interval,
        });
      } catch (error) {
        this.sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (method === 'POST' && pathname === '/setup/copilot/poll') {
      try {
        const body = await this.readJsonBody<{ device_code?: string }>(req);
        const deviceCode = body?.device_code;
        if (!deviceCode) {
          this.sendJson(res, 400, { ok: false, error: 'device_code is required' });
          return;
        }
        const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
        const pollInterval = 5000;
        const maxAttempts = 180; // 15 minutes max
        let attempts = 0;

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          attempts++;

          const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `client_id=${COPILOT_CLIENT_ID}&device_code=${deviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
          });
          const tokenData = await tokenRes.json() as { access_token?: string; error?: string };

          if (tokenData.access_token) {
            this.sendJson(res, 200, { ok: true, token: tokenData.access_token });
            return;
          }
          if (tokenData.error === 'authorization_pending') continue;
          if (tokenData.error === 'slow_down') { await new Promise((r) => setTimeout(r, 2000)); continue; }
          if (tokenData.error === 'expired_token') {
            this.sendJson(res, 400, { ok: false, error: 'Device code expired. Please try again.' });
            return;
          }
          if (tokenData.error === 'access_denied') {
            this.sendJson(res, 400, { ok: false, error: 'Authorization denied by user.' });
            return;
          }
        }
        this.sendJson(res, 408, { ok: false, error: 'Device code flow timed out.' });
      } catch (error) {
        this.sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (method === 'POST' && pathname === '/setup/github/connect-url') {
      const state = this.createGitHubOAuthState();
      const origin = this.getRequestOrigin(req);
      const callbackUrl = `${origin}/setup/github/oauth/callback`;
      const authUrl =
        `${GITHUB_OAUTH_PROXY}/start?redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;

      this.sendJson(res, 200, {
        ok: true,
        authUrl,
      });
      return;
    }

    if (method === 'POST' && pathname === '/setup/github/disconnect') {
      await disconnectGitHub();
      const config = await loadConfig();
      config.github = {
        connected: false,
        username: '',
        connectedAt: '',
      };
      await saveConfig(config);
      this.sendJson(res, 200, {
        ok: true,
        message: 'GitHub disconnected.',
      });
      return;
    }

    if (method === 'GET' && pathname === '/setup/github/oauth/callback') {
      await this.handleGitHubOAuthCallback(req, res);
      return;
    }

    if (method === 'GET' && pathname === '/setup/status') {
      const config = await loadConfigWithCredentials();
      const availableAgents = await this.resolveAvailableAgents(config);
      const configPath = await getConfigPath().catch(() => '');
      const githubToken = await getGitHubToken().catch(() => null);
      const githubUsername = githubToken?.username || config.github?.username || '';
      const braveSearchApiKey = await this.resolveToolApiKey(
        config.braveSearch?.apiKey,
        config.braveSearch?.apiKeyRef,
        'brave-search',
      );
      const firecrawlApiKey = await this.resolveToolApiKey(
        config.firecrawl?.apiKey,
        config.firecrawl?.apiKeyRef,
        'firecrawl',
      );
      const notionApiKey = await this.resolveToolApiKey(
        config.notion?.apiKey,
        config.notion?.apiKeyRef,
        'notion',
      );
      this.sendJson(res, 200, {
        ready: this.hasConfiguredProvider(config),
        defaultProvider: config.defaultProvider,
        defaultModel: config.defaultModel,
        providers: (config.providers || []).map((provider) => ({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          defaultModel: (provider as any).defaultModel,
          enabled: provider.enabled !== false,
          hasApiKey: Boolean(provider.apiKey),
        })),
        channels: {
          telegram: {
            enabled: Boolean(config.channels?.telegram?.enabled),
            hasBotToken: Boolean(config.channels?.telegram?.botToken),
            groupActivation: this.resolveChannelGroupActivation(config, 'telegram'),
          },
          discord: {
            enabled: Boolean(config.channels?.discord?.enabled),
            hasBotToken: Boolean(config.channels?.discord?.botToken),
            groupActivation: this.resolveChannelGroupActivation(config, 'discord'),
          },
          slack: {
            enabled: Boolean(config.channels?.slack?.enabled),
            hasBotToken: Boolean(config.channels?.slack?.botToken),
            hasAppToken: Boolean(config.channels?.slack?.appToken),
            groupActivation: this.resolveChannelGroupActivation(config, 'slack'),
          },
          signal: {
            enabled: Boolean(config.channels?.signal?.enabled),
            phoneNumber: config.channels?.signal?.phoneNumber || '',
            httpUrl: config.channels?.signal?.httpUrl || '',
            groupActivation: this.resolveChannelGroupActivation(config, 'signal'),
          },
        },
        autoReply: {
          defaultAgent: this.resolveAutoReplyDefaultAgent(config),
          defaultSessionScope: this.resolveAutoReplyDefaultSessionScope(config),
          bindings: this.resolveAutoReplyBindings(config),
        },
        availableAgents,
        webTools: {
          hasBraveSearchApiKey: Boolean(braveSearchApiKey),
          hasFirecrawlApiKey: Boolean(firecrawlApiKey),
          hasNotionApiKey: Boolean(notionApiKey),
        },
        github: {
          connected: Boolean(githubToken),
          username: githubUsername,
        },
        configPath,
        configSnapshot: this.createSetupConfigSnapshot(config),
      });
      return;
    }

    if (method === 'GET' && pathname === '/setup/signal/status') {
      try {
        const status = await this.getSignalSetupStatus();
        this.sendJson(res, 200, { ok: true, ...status });
      } catch (error) {
        this.sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (method === 'POST' && pathname === '/setup/signal/register') {
      try {
        const payload = await this.readJsonBody<SignalRegisterPayload>(req);
        const result = await this.registerSignalAccount(payload);
        this.sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        this.sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (method === 'POST' && pathname === '/setup/signal/verify') {
      try {
        const payload = await this.readJsonBody<SignalVerifyPayload>(req);
        const result = await this.verifySignalAccount(payload);
        this.sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        this.sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (method === 'POST' && pathname === '/setup/signal/qrcodelink') {
      try {
        const payload = await this.readJsonBody<SignalQrPayload>(req);
        const result = await this.createSignalLinkQr(payload);
        this.sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        this.sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (method === 'POST' && pathname === '/setup/models') {
      try {
        const payload = await this.readJsonBody<SetupModelsPayload>(req);
        const result = await this.resolveProviderModels(payload);
        this.sendJson(res, 200, result);
      } catch (error) {
        this.sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (method === 'POST' && pathname === '/setup/config') {
      try {
        const payload = await this.readJsonBody<SetupPayload>(req);
        await this.persistSetupConfig(payload);
        this.sendJson(res, 200, {
          ok: true,
          message: 'Configuration saved. FoxFang is restarting to apply changes.',
          restarting: true,
        });
        this.scheduleRestart('web setup config updated');
      } catch (error) {
        this.sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    this.sendJson(res, 404, { error: 'Setup endpoint not found' });
  }

  private async handleApiRoute(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string
  ): Promise<void> {
    // Auth check for API routes
    if (!(await this.isApiAuthValid(req, res))) {
      return;
    }

    // CORS headers for API
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // GET /api/auth - Verify token and return user info
    if (method === 'GET' && pathname === '/api/auth') {
      this.sendJson(res, 200, {
        ok: true,
        authenticated: true,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // GET /api/stats - Get dashboard stats
    if (method === 'GET' && pathname === '/api/stats') {
      this.sendJson(res, 200, {
        projects: 5,
        boards: 12,
        campaigns: 8,
        agents: 4,
        activeTasks: 24,
        completedTasks: 156,
      });
      return;
    }

    // GET /api/boards - List boards
    if (method === 'GET' && pathname === '/api/boards') {
      this.sendJson(res, 200, [
        { id: 1, name: 'Content Calendar', tasks: 24, status: 'active' },
        { id: 2, name: 'Q1 Marketing', tasks: 18, status: 'active' },
        { id: 3, name: 'Social Media', tasks: 32, status: 'active' },
        { id: 4, name: 'Product Launch', tasks: 45, status: 'paused' },
      ]);
      return;
    }

    // GET /api/campaigns - List campaigns
    if (method === 'GET' && pathname === '/api/campaigns') {
      this.sendJson(res, 200, [
        { id: 1, name: 'Q1 Product Launch', status: 'active', progress: 65, budget: '$5,000' },
        { id: 2, name: 'Social Media Blitz', status: 'active', progress: 42, budget: '$2,500' },
      ]);
      return;
    }

    // GET /api/agents - List agents
    if (method === 'GET' && pathname === '/api/agents') {
      this.sendJson(res, 200, [
        { id: 1, name: 'Content Specialist', role: 'content-specialist', status: 'online', tasks: 156 },
        { id: 2, name: 'Strategy Lead', role: 'strategy-lead', status: 'online', tasks: 89 },
        { id: 3, name: 'Growth Analyst', role: 'growth-analyst', status: 'offline', tasks: 234 },
      ]);
      return;
    }

    // POST /api/gateway/regenerate-token - Generate new gateway token
    if (method === 'POST' && pathname === '/api/gateway/regenerate-token') {
      try {
        const newToken = Array.from({ length: 32 }, () =>
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]
        ).join('');

        const config = await loadConfigWithCredentials();
        config.gateway = {
          ...config.gateway,
          auth: {
            ...(config.gateway?.auth || { mode: 'token' }),
            token: newToken,
          },
        };
        await saveConfig(config);

        this.sendJson(res, 200, {
          ok: true,
          token: newToken,
          message: 'Token regenerated successfully. You will need to login again with the new token.',
        });
      } catch (error) {
        this.sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to regenerate token',
        });
      }
      return;
    }

    this.sendJson(res, 404, { error: 'API endpoint not found' });
  }

  private async isApiAuthValid(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Unauthorized. Provide Bearer token.' }));
      return false;
    }

    const token = authHeader.slice(7);

    // Load auth from config
    try {
      const config = await loadConfigWithCredentials();
      const auth = config.gateway?.auth;

      if (!auth || (auth.mode === 'token' && !auth.token) || (auth.mode === 'password' && !auth.password)) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'Gateway auth is not configured. Run `pnpm foxfang wizard` to set up authentication.'
        }));
        return false;
      }

      // Support both token and password modes for API
      const validToken = auth.mode === 'token' ? auth.token : auth.password;

      if (token !== validToken) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid token.' }));
        return false;
      }
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to validate token.' }));
      return false;
    }

    return true;
  }

  private async isSetupAuthValid(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    // Load auth from config
    let auth: { mode: 'token' | 'password'; token?: string; password?: string } | undefined;
    try {
      const config = await loadConfigWithCredentials();
      auth = config.gateway?.auth;
    } catch (error) {
      this.sendJson(res, 500, { error: 'Failed to load configuration.' });
      return false;
    }

    if (!auth || (auth.mode === 'token' && !auth.token) || (auth.mode === 'password' && !auth.password)) {
      this.sendJson(res, 503, {
        error: 'Gateway auth is not configured. Run `pnpm foxfang wizard` to set up authentication.',
      });
      return false;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      this.sendSetupAuthChallenge(res);
      return false;
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) {
      this.sendSetupAuthChallenge(res);
      return false;
    }

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    // For setup page: username is "admin" or "setup", password is the gateway token/password
    const validPassword = auth.mode === 'token' ? auth.token : auth.password;
    const validUsernames = ['admin', 'setup', 'foxfang'];

    if (!validUsernames.includes(username) || password !== validPassword) {
      this.sendSetupAuthChallenge(res);
      return false;
    }

    return true;
  }

  private sendSetupAuthChallenge(res: ServerResponse): void {
    res.statusCode = 401;
    res.setHeader('www-authenticate', 'Basic realm="FoxFang Setup"');
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  private async readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
      throw new Error('Request body is empty');
    }
    return JSON.parse(raw) as T;
  }

  private createGitHubOAuthState(): string {
    const state = randomBytes(18).toString('base64url');
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.githubOAuthStates.set(state, expiresAt);

    for (const [existingState, existingExpiry] of this.githubOAuthStates.entries()) {
      if (existingExpiry < Date.now()) {
        this.githubOAuthStates.delete(existingState);
      }
    }

    return state;
  }

  private consumeGitHubOAuthState(state: string): boolean {
    if (!state) return false;
    const expiresAt = this.githubOAuthStates.get(state);
    this.githubOAuthStates.delete(state);
    return Boolean(expiresAt && expiresAt > Date.now());
  }

  private getRequestOrigin(req: IncomingMessage): string {
    // Prefer an explicitly configured, trusted public base URL.
    const configuredBaseUrl = process.env.PUBLIC_BASE_URL;
    if (configuredBaseUrl && /^https?:\/\//i.test(configuredBaseUrl)) {
      return configuredBaseUrl.replace(/\/+$/, '');
    }

    // Derive protocol from x-forwarded-proto if present and valid.
    const forwardedProtoRaw = this.sanitizeString(req.headers['x-forwarded-proto']);
    let proto = (forwardedProtoRaw.split(',')[0] || '').toLowerCase();
    if (proto !== 'http' && proto !== 'https') {
      const isEncrypted = (req.socket as any)?.encrypted === true;
      proto = isEncrypted ? 'https' : 'http';
    }

    // Prefer x-forwarded-host only if it passes validation.
    const forwardedHostHeader = req.headers['x-forwarded-host'];
    const forwardedHost = Array.isArray(forwardedHostHeader)
      ? this.sanitizeString(forwardedHostHeader[0])
      : this.sanitizeString(forwardedHostHeader);

    const hostHeader = req.headers.host || '';
    const candidateForwardedHost = forwardedHost || '';
    const candidateDirectHost = this.sanitizeString(hostHeader);

    let host = '';
    if (candidateForwardedHost && this.isValidHost(candidateForwardedHost)) {
      host = candidateForwardedHost;
    } else if (candidateDirectHost && this.isValidHost(candidateDirectHost)) {
      host = candidateDirectHost;
    }

    if (!host) {
      return `http://127.0.0.1:${PORT}`;
    }

    return `${proto}://${host}`;
  }

  private isValidHost(host: string): boolean {
    if (!host) return false;
    // Allow valid hostnames (no consecutive/leading/trailing dots) with an optional port.
    // Rejects values with schemes, paths, or other unsafe characters.
    const HOST_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(?::\d+)?$/;
    return HOST_REGEX.test(host);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private renderGitHubOAuthCallbackPage(payload: { ok: boolean; message: string }): string {
    const safeMessage = this.escapeHtml(payload.message);
    const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>GitHub OAuth</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px;">
    <h2>${payload.ok ? 'GitHub connected' : 'GitHub connection failed'}</h2>
    <p>${safeMessage}</p>
    <p>You can close this window.</p>
    <script>
      try {
        const payload = ${serialized};
        if (window.opener && window.opener !== window) {
          window.opener.postMessage({ type: 'foxfang-github-oauth', ...payload }, window.location.origin);
          window.close();
        }
      } catch (_) {}
    </script>
  </body>
</html>`;
  }

  private async handleGitHubOAuthCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const callbackUrl = new URL(req.url || '/', 'http://localhost');
    const error = this.sanitizeString(callbackUrl.searchParams.get('error'));
    const token = this.sanitizeString(callbackUrl.searchParams.get('token'));
    const username = this.sanitizeString(callbackUrl.searchParams.get('username'));
    const state = this.sanitizeString(callbackUrl.searchParams.get('state'));

    if (!state || !this.consumeGitHubOAuthState(state)) {
      this.sendHtml(res, this.renderGitHubOAuthCallbackPage({
        ok: false,
        message: 'Invalid or expired OAuth state. Please try Connect GitHub again.',
      }));
      return;
    }

    if (error) {
      this.sendHtml(res, this.renderGitHubOAuthCallbackPage({
        ok: false,
        message: `OAuth error: ${error}`,
      }));
      return;
    }

    if (!token) {
      this.sendHtml(res, this.renderGitHubOAuthCallbackPage({
        ok: false,
        message: 'No token received from OAuth proxy.',
      }));
      return;
    }

    await saveGitHubToken(token, username || undefined, ['repo', 'read:user']);
    const config = await loadConfig();
    config.github = {
      connected: true,
      username: username || '',
      connectedAt: new Date().toISOString(),
    };
    await saveConfig(config);

    this.sendHtml(res, this.renderGitHubOAuthCallbackPage({
      ok: true,
      message: `Connected as ${username || 'GitHub user'}.`,
    }));
  }

  private hasConfiguredProvider(config: any): boolean {
    return (
      Array.isArray(config?.providers) &&
      config.providers.some((provider: any) =>
        provider?.enabled !== false && (provider?.id === 'ollama' || Boolean(provider?.apiKey))
      )
    );
  }

  private sanitizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private maskSecret(value: string): string {
    const normalized = this.sanitizeString(value);
    if (!normalized) return '';
    const suffix = normalized.length > 4 ? normalized.slice(-4) : normalized;
    return `***${suffix}`;
  }

  private createSetupConfigSnapshot(input: unknown): unknown {
    const secretKeyPattern = /(api[-_]?key|token|password|secret|authorization|cookie)/i;

    const walk = (value: unknown, key = ''): unknown => {
      if (Array.isArray(value)) {
        return value.map((item) => walk(item, key));
      }
      if (!value || typeof value !== 'object') {
        if (typeof value === 'string' && secretKeyPattern.test(key)) {
          return this.maskSecret(value);
        }
        return value;
      }

      const result: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entryValue === 'string' && secretKeyPattern.test(entryKey)) {
          result[entryKey] = this.maskSecret(entryValue);
          continue;
        }
        result[entryKey] = walk(entryValue, entryKey);
      }
      return result;
    };

    return walk(input);
  }

  private async resolveToolApiKey(
    apiKeyValue: unknown,
    apiKeyRefValue: unknown,
    fallbackProvider: string,
  ): Promise<string> {
    const inlineApiKey = this.sanitizeString(apiKeyValue);
    if (inlineApiKey) {
      return inlineApiKey;
    }

    const ref = this.sanitizeString(apiKeyRefValue);
    const providerFromRef = ref.startsWith('credential:')
      ? this.sanitizeString(ref.slice('credential:'.length))
      : '';
    const provider = providerFromRef || fallbackProvider;
    if (!provider) {
      return '';
    }

    const credential = await getCredential(provider).catch(() => null);
    return this.sanitizeString(credential?.apiKey);
  }

  private getProviderPreset(providerId: string): ProviderPreset | undefined {
    return PROVIDER_PRESETS[providerId];
  }

  private normalizeBaseUrl(baseUrl: string): string {
    if (!baseUrl) return '';
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  private resolveProviderBaseUrl(providerId: string, baseUrl?: string): string {
    const input = this.normalizeBaseUrl(this.sanitizeString(baseUrl));
    if (input) return input;
    const preset = this.getProviderPreset(providerId);
    return this.normalizeBaseUrl(preset?.baseUrl || '');
  }

  private extractModelIds(data: any): string[] {
    const values: string[] = [];
    const push = (value: unknown) => {
      const id = this.sanitizeString(value);
      if (id) values.push(id);
    };

    if (Array.isArray(data?.data)) {
      for (const item of data.data) {
        push(item?.id || item?.name);
      }
    }
    if (Array.isArray(data?.models)) {
      for (const item of data.models) {
        push(item?.id || item?.name || item?.model);
      }
    }
    if (Array.isArray(data?.result?.data)) {
      for (const item of data.result.data) {
        push(item?.id || item?.name);
      }
    }

    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }

  private async fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchModelsFromProvider(
    providerId: string,
    apiKey: string,
    baseUrl: string
  ): Promise<string[]> {
    if (!baseUrl) return [];
    if (providerId === 'custom') return [];
    if (providerId === 'kimi-coding') return [];
    if (providerId === 'github-copilot') return [];
    if (providerId === 'byteplus-ark') return [];

    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl);
    const headers: Record<string, string> = {};

    if (providerId === 'anthropic') {
      if (!apiKey) return [];
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      const response = await this.fetchWithTimeout(`${normalizedBaseUrl}/models`, { method: 'GET', headers });
      if (!response.ok) return [];
      const payload = await response.json();
      return this.extractModelIds(payload);
    }

    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }

    // NVIDIA NIM API handling - fetch from models.dev for curated list
    if (providerId === 'nvidia') {
      if (!apiKey) return [];
      try {
        const response = await this.fetchWithTimeout('https://models.dev/api.json', { 
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'foxfang-gateway/1.0.0',
          }
        });
        if (!response.ok) {
          console.log(`[Gateway] models.dev API response: ${response.status}`);
          return [];
        }
        const payload = await response.json();
        // Extract NVIDIA models from models.dev
        const nvidiaProvider = payload?.nvidia;
        if (!nvidiaProvider || !nvidiaProvider.models) {
          console.log('[Gateway] No NVIDIA provider found in models.dev');
          return [];
        }
        return Object.keys(nvidiaProvider.models);
      } catch (error) {
        console.log(`[Gateway] Failed to fetch from models.dev: ${error}`);
        return [];
      }
    }

    const openaiModels = async (): Promise<string[]> => {
      const response = await this.fetchWithTimeout(`${normalizedBaseUrl}/models`, { method: 'GET', headers });
      if (!response.ok) return [];
      const payload = await response.json();
      return this.extractModelIds(payload);
    };

    const ollamaTags = async (): Promise<string[]> => {
      const ollamaBase = normalizedBaseUrl.endsWith('/v1')
        ? normalizedBaseUrl.slice(0, -3)
        : normalizedBaseUrl;
      const response = await this.fetchWithTimeout(`${ollamaBase}/api/tags`, { method: 'GET' });
      if (!response.ok) return [];
      const payload = await response.json();
      return this.extractModelIds(payload);
    };

    let models = await openaiModels();
    if (providerId === 'ollama' && models.length === 0) {
      models = await ollamaTags();
    }

    return models;
  }

  private async resolveProviderModels(payload: SetupModelsPayload): Promise<{
    ok: boolean;
    providerId: string;
    baseUrl: string;
    models: string[];
    source: 'remote' | 'preset';
    error?: string;
  }> {
    const providerId = this.sanitizeString(payload.providerId);
    if (!providerId) {
      throw new Error('providerId is required');
    }

    const apiKey = this.sanitizeString(payload.apiKey);
    const baseUrl = this.resolveProviderBaseUrl(providerId, payload.baseUrl);
    const presetModels = [...(this.getProviderPreset(providerId)?.models || [])];

    try {
      const remoteModels = await this.fetchModelsFromProvider(providerId, apiKey, baseUrl);
      if (remoteModels.length > 0) {
        return {
          ok: true,
          providerId,
          baseUrl,
          models: remoteModels,
          source: 'remote',
        };
      }
    } catch (error) {
      return {
        ok: true,
        providerId,
        baseUrl,
        models: presetModels,
        source: 'preset',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      ok: true,
      providerId,
      baseUrl,
      models: presetModels,
      source: 'preset',
    };
  }

  private normalizeProvider(input: ProviderSetupInput): any {
    const providerId = this.sanitizeString(input.id);
    if (!providerId) {
      throw new Error('Provider id is required');
    }

    const preset = this.getProviderPreset(providerId);
    const providerName = this.sanitizeString(input.name) || preset?.name || providerId;
    const apiKey = this.sanitizeString(input.apiKey);
    const baseUrl = this.resolveProviderBaseUrl(providerId, input.baseUrl);
    const defaultModel = this.sanitizeString(input.model);
    const enabled = input.enabled !== false;

    const provider: Record<string, any> = {
      id: providerId,
      name: providerName,
      enabled,
    };

    if (apiKey) provider.apiKey = apiKey;
    if (baseUrl) provider.baseUrl = baseUrl;
    if (defaultModel) provider.defaultModel = defaultModel;

    if (providerId === 'kimi-coding') {
      provider.headers = { 'User-Agent': 'claude-code/0.1.0' };
      provider.apiType = 'anthropic-messages';
    }

    return provider;
  }

  private normalizeChannels(input?: SetupPayload['channels']): any {
    if (!input || typeof input !== 'object') {
      return undefined;
    }

    const channels: Record<string, any> = {};

    if (input.telegram) {
      const groupActivation = this.normalizeGroupActivation(
        input.telegram.groupActivation,
        input.telegram.requireMentionInGroups
      );
      channels.telegram = {
        enabled: Boolean(input.telegram.enabled),
        botToken: this.sanitizeString(input.telegram.botToken),
        groupActivation,
        requireMentionInGroups: groupActivation === 'mention',
      };
    }

    if (input.discord) {
      const groupActivation = this.normalizeGroupActivation(
        input.discord.groupActivation,
        input.discord.requireMentionInGroups
      );
      channels.discord = {
        enabled: Boolean(input.discord.enabled),
        botToken: this.sanitizeString(input.discord.botToken),
        groupActivation,
        requireMentionInGroups: groupActivation === 'mention',
      };
    }

    if (input.slack) {
      const groupActivation = this.normalizeGroupActivation(
        input.slack.groupActivation,
        input.slack.requireMentionInGroups
      );
      channels.slack = {
        enabled: Boolean(input.slack.enabled),
        botToken: this.sanitizeString(input.slack.botToken),
        appToken: this.sanitizeString(input.slack.appToken),
        groupActivation,
        requireMentionInGroups: groupActivation === 'mention',
      };
    }

    if (input.signal) {
      const groupActivation = this.normalizeGroupActivation(
        input.signal.groupActivation,
        input.signal.requireMentionInGroups
      );
      channels.signal = {
        enabled: Boolean(input.signal.enabled),
        phoneNumber: this.sanitizeString(input.signal.phoneNumber),
        httpUrl: this.sanitizeString(input.signal.httpUrl),
        groupActivation,
        requireMentionInGroups: groupActivation === 'mention',
      };
    }

    return channels;
  }

  private normalizeAutoReply(input: SetupPayload['autoReply'] | undefined, existing: any): any {
    const current = existing && typeof existing === 'object' ? { ...existing } : {};
    if (!input || typeof input !== 'object') {
      return current;
    }

    const defaultAgent = this.sanitizeString(input.defaultAgent);
    if (defaultAgent) {
      current.defaultAgent = defaultAgent;
    }

    const scopeRaw = this.sanitizeString(input.defaultSessionScope).toLowerCase();
    if (scopeRaw === 'from' || scopeRaw === 'chat' || scopeRaw === 'thread' || scopeRaw === 'chat-thread') {
      current.defaultSessionScope = scopeRaw;
    }

    if (Array.isArray(input.bindings)) {
      current.bindings = input.bindings;
    }

    const wrapped = { autoReply: current };
    const normalizedBindings = this.resolveAutoReplyBindings(wrapped);
    current.bindings = normalizedBindings;

    return current;
  }

  private normalizeGroupActivation(
    activationInput?: string,
    requireMentionInput?: boolean
  ): 'mention' | 'always' {
    const normalized = this.sanitizeString(activationInput).toLowerCase();
    if (normalized === 'mention') return 'mention';
    if (normalized === 'always') return 'always';
    if (typeof requireMentionInput === 'boolean') {
      return requireMentionInput ? 'mention' : 'always';
    }
    return 'always';
  }

  private resolveGlobalGroupActivation(config: any): 'mention' | 'always' {
    const normalized = this.sanitizeString(config?.autoReply?.groupActivation).toLowerCase();
    if (normalized === 'mention') return 'mention';
    if (normalized === 'always') return 'always';
    if (typeof config?.autoReply?.requireMentionInGroups === 'boolean') {
      return config.autoReply.requireMentionInGroups ? 'mention' : 'always';
    }
    return 'always';
  }

  private resolveChannelGroupActivation(
    config: any,
    channelName: 'telegram' | 'discord' | 'slack' | 'signal'
  ): 'mention' | 'always' {
    const channelConfig = config?.channels?.[channelName];
    const normalized = this.sanitizeString(channelConfig?.groupActivation).toLowerCase();
    if (normalized === 'mention') return 'mention';
    if (normalized === 'always') return 'always';
    if (typeof channelConfig?.requireMentionInGroups === 'boolean') {
      return channelConfig.requireMentionInGroups ? 'mention' : 'always';
    }
    return this.resolveGlobalGroupActivation(config);
  }

  private resolveRequireMentionByChannel(config: any): {
    telegram: boolean;
    discord: boolean;
    slack: boolean;
    signal: boolean;
  } {
    return {
      telegram: this.resolveChannelGroupActivation(config, 'telegram') === 'mention',
      discord: this.resolveChannelGroupActivation(config, 'discord') === 'mention',
      slack: this.resolveChannelGroupActivation(config, 'slack') === 'mention',
      signal: this.resolveChannelGroupActivation(config, 'signal') === 'mention',
    };
  }

  private resolveAutoReplyDefaultAgent(config: any): string {
    const value = this.sanitizeString(config?.autoReply?.defaultAgent);
    if (value) {
      return value;
    }

    // Prefer a default/first agent from the hydrated registry, if available.
    const registryAgents = agentRegistry.list();
    const registryDefault = registryAgents.find((agent) => agent.isDefault);
    if (registryDefault?.id) {
      const sanitized = this.sanitizeString(registryDefault.id);
      if (sanitized) return sanitized;
    } else if (registryAgents.length > 0 && registryAgents[0].id) {
      const sanitized = this.sanitizeString(registryAgents[0].id);
      if (sanitized) return sanitized;
    }

    // Fallback to configured agents in config, if any.
    const configuredAgents = Array.isArray(config?.agents)
      ? config.agents
      : Array.isArray(config?.agents?.list)
      ? config.agents.list
      : [];
    const configDefault = configuredAgents.find((agent: any) => agent?.default === true);
    if (configDefault?.id) {
      const sanitized = this.sanitizeString(configDefault.id);
      if (sanitized) return sanitized;
    } else if (configuredAgents.length > 0 && configuredAgents[0]?.id) {
      const sanitized = this.sanitizeString(configuredAgents[0].id);
      if (sanitized) return sanitized;
    }

    // Last resort: the legacy hardcoded fallback ID.
    return DEFAULT_AGENT_ID;
  }

  private resolveAutoReplyDefaultSessionScope(config: any): 'from' | 'chat' | 'thread' | 'chat-thread' {
    const value = this.sanitizeString(config?.autoReply?.defaultSessionScope).toLowerCase();
    if (value === 'from' || value === 'chat' || value === 'thread' || value === 'chat-thread') {
      return value;
    }
    return 'chat-thread';
  }

  private async resolveAvailableAgents(config: any): Promise<string[]> {
    try {
      await hydrateAgentRegistryFromConfig();
    } catch {
      // Ignore hydration errors; continue with config-only fallback below.
    }

    // Seed with the registry-resolved default so the first entry is always valid.
    const defaultId = agentRegistry.resolveDefaultAgentId();
    const ids = new Set<string>([defaultId]);
    for (const agent of agentRegistry.list()) {
      if (agent.id) ids.add(agent.id);
    }

    // Support both config.agents (array) and config.agents.list (nested)
    const configured = Array.isArray(config?.agents)
      ? config.agents
      : Array.isArray(config?.agents?.list)
      ? config.agents.list
      : [];
    for (const agent of configured) {
      const id = this.sanitizeString(agent?.id);
      if (id) ids.add(id);
    }

    const bindings = Array.isArray(config?.autoReply?.bindings) ? config.autoReply.bindings : [];
    for (const binding of bindings) {
      const id = this.sanitizeString(binding?.agentId);
      if (id) ids.add(id);
    }

    return Array.from(ids).sort((a, b) => {
      if (a === defaultId) return -1;
      if (b === defaultId) return 1;
      return a.localeCompare(b);
    });
  }

  private sanitizeBindingStringList(value: unknown): string[] {
    if (typeof value === 'string') {
      const item = this.sanitizeString(value);
      return item ? [item] : [];
    }
    if (!Array.isArray(value)) return [];
    const items = value
      .map((item) => this.sanitizeString(item))
      .filter(Boolean);
    return Array.from(new Set(items));
  }

  private resolveAutoReplyBindings(config: any): Array<{
    id?: string;
    enabled?: boolean;
    priority?: number;
    channel?: string;
    chatType?: 'private' | 'group' | 'channel';
    chatId?: string | string[];
    threadId?: string | string[];
    fromId?: string | string[];
    accountId?: string | string[];
    metadata?: Record<string, string | string[]>;
    agentId: string;
    sessionScope?: 'from' | 'chat' | 'thread' | 'chat-thread';
  }> {
    const rawBindings = Array.isArray(config?.autoReply?.bindings) ? config.autoReply.bindings : [];
    const normalized: Array<{
      id?: string;
      enabled?: boolean;
      priority?: number;
      channel?: string;
      chatType?: 'private' | 'group' | 'channel';
      chatId?: string | string[];
      threadId?: string | string[];
      fromId?: string | string[];
      accountId?: string | string[];
      metadata?: Record<string, string | string[]>;
      agentId: string;
      sessionScope?: 'from' | 'chat' | 'thread' | 'chat-thread';
    }> = [];

    for (const candidate of rawBindings) {
      if (!candidate || typeof candidate !== 'object') continue;
      const binding = candidate as Record<string, unknown>;
      const agentId = this.sanitizeString(binding.agentId);
      if (!agentId) continue;

      const chatTypeRaw = this.sanitizeString(binding.chatType).toLowerCase();
      const chatType: 'private' | 'group' | 'channel' | undefined =
        (chatTypeRaw === 'private' || chatTypeRaw === 'group' || chatTypeRaw === 'channel')
        ? chatTypeRaw
        : undefined;

      const scopeRaw = this.sanitizeString(binding.sessionScope).toLowerCase();
      const sessionScope: 'from' | 'chat' | 'thread' | 'chat-thread' | undefined = (
        scopeRaw === 'from'
        || scopeRaw === 'chat'
        || scopeRaw === 'thread'
        || scopeRaw === 'chat-thread'
      )
        ? scopeRaw
        : undefined;

      const metadataRaw = binding.metadata;
      const metadata: Record<string, string | string[]> = {};
      if (metadataRaw && typeof metadataRaw === 'object' && !Array.isArray(metadataRaw)) {
        for (const [key, value] of Object.entries(metadataRaw as Record<string, unknown>)) {
          const cleanKey = this.sanitizeString(key);
          if (!cleanKey) continue;
          const list = this.sanitizeBindingStringList(value);
          if (list.length === 0) continue;
          metadata[cleanKey] = list.length === 1 ? list[0] : list;
        }
      }

      const oneOrMany = (input: unknown): string | string[] | undefined => {
        const list = this.sanitizeBindingStringList(input);
        if (list.length === 0) return undefined;
        return list.length === 1 ? list[0] : list;
      };

      const priorityNum = Number(binding.priority);
      const normalizedBinding = {
        id: this.sanitizeString(binding.id) || undefined,
        enabled: binding.enabled === false ? false : true,
        priority: Number.isFinite(priorityNum) ? priorityNum : 0,
        channel: this.sanitizeString(binding.channel) || undefined,
        chatType,
        chatId: oneOrMany(binding.chatId),
        threadId: oneOrMany(binding.threadId),
        fromId: oneOrMany(binding.fromId),
        accountId: oneOrMany(binding.accountId),
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        agentId,
        sessionScope,
      };

      normalized.push(normalizedBinding);
    }

    return normalized;
  }

  private getDefaultSignalHttpUrl(): string {
    const configured = this.sanitizeString(process.env.SIGNAL_HTTP_URL);
    if (configured) {
      return configured;
    }
    return 'http://signal-api:8080';
  }

  private normalizeSignalHttpUrl(value: unknown): string {
    const normalized = this.sanitizeString(value).replace(/\/+$/, '');
    if (!normalized || normalized === 'http://signal-cli:8080') {
      return this.getDefaultSignalHttpUrl();
    }
    return normalized;
  }

  private normalizePhoneNumber(value: unknown): string {
    return this.sanitizeString(value).replace(/\s+/g, '');
  }

  private async readHttpResponseBody(response: Response): Promise<unknown> {
    const contentType = this.sanitizeString(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      return response.json().catch(() => ({}));
    }
    return response.text().catch(() => '');
  }

  private extractSignalApiError(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload.trim();
    }
    if (payload && typeof payload === 'object') {
      const errorValue = (payload as Record<string, unknown>).error;
      if (typeof errorValue === 'string' && errorValue.trim()) {
        return errorValue.trim();
      }
      return JSON.stringify(payload);
    }
    return '';
  }

  private async detectSignalApiMode(baseUrl: string): Promise<'rest-wrapper' | 'daemon-rpc' | 'unknown'> {
    try {
      const restHealth = await this.fetchWithTimeout(`${baseUrl}/v1/health`, { method: 'GET' }, 6000);
      if (restHealth.ok) {
        return 'rest-wrapper';
      }
    } catch {
      // ignore
    }

    try {
      const daemonHealth = await this.fetchWithTimeout(`${baseUrl}/api/v1/check`, { method: 'GET' }, 6000);
      if (daemonHealth.ok) {
        return 'daemon-rpc';
      }
    } catch {
      // ignore
    }

    return 'unknown';
  }

  private normalizeSignalAccounts(payload: unknown): string[] {
    if (!Array.isArray(payload)) return [];
    return payload
      .map((item) => {
        if (typeof item === 'string') {
          return this.normalizePhoneNumber(item);
        }
        if (item && typeof item === 'object') {
          const raw = (item as Record<string, unknown>).number || (item as Record<string, unknown>).username;
          return this.normalizePhoneNumber(raw);
        }
        return '';
      })
      .filter(Boolean);
  }

  private async getSignalSetupStatus(): Promise<{
    baseUrl: string;
    mode: 'rest-wrapper' | 'daemon-rpc' | 'unknown';
    phoneNumber: string;
    accounts: string[];
    isRegistered: boolean;
    supportsOnboarding: boolean;
    accountsError?: string;
  }> {
    const config = await loadConfig();
    const baseUrl = this.normalizeSignalHttpUrl(config.channels?.signal?.httpUrl);
    const phoneNumber = this.normalizePhoneNumber(config.channels?.signal?.phoneNumber);
    const mode = await this.detectSignalApiMode(baseUrl);

    let accounts: string[] = [];
    let accountsError = '';

    if (mode === 'rest-wrapper') {
      try {
        const response = await this.fetchWithTimeout(`${baseUrl}/v1/accounts`, { method: 'GET' }, 10000);
        const body = await this.readHttpResponseBody(response);
        if (!response.ok) {
          accountsError = this.extractSignalApiError(body) || `HTTP ${response.status}`;
        } else {
          accounts = this.normalizeSignalAccounts(body);
        }
      } catch (error) {
        accountsError = error instanceof Error ? error.message : String(error);
      }
    }

    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const isRegistered = normalizedPhone ? accounts.includes(normalizedPhone) : false;

    return {
      baseUrl,
      mode,
      phoneNumber,
      accounts,
      isRegistered,
      supportsOnboarding: mode === 'rest-wrapper',
      ...(accountsError ? { accountsError } : {}),
    };
  }

  private async requireSignalRestWrapper(): Promise<{
    baseUrl: string;
    phoneNumber: string;
  }> {
    const status = await this.getSignalSetupStatus();
    if (status.mode !== 'rest-wrapper') {
      throw new Error(
        `Signal onboarding requires bbernhard/signal-cli-rest-api (/v1). Current mode: ${status.mode}.`
      );
    }
    return {
      baseUrl: status.baseUrl,
      phoneNumber: status.phoneNumber,
    };
  }

  private async registerSignalAccount(payload: SignalRegisterPayload): Promise<{
    message: string;
    phoneNumber: string;
  }> {
    const { baseUrl, phoneNumber: configPhone } = await this.requireSignalRestWrapper();
    const phoneNumber = this.normalizePhoneNumber(payload.phoneNumber) || configPhone;
    if (!phoneNumber) {
      throw new Error('Signal phone number is required');
    }

    const requestBody: Record<string, unknown> = {};
    if (payload.useVoice === true) requestBody.use_voice = true;
    const captcha = this.sanitizeString(payload.captcha);
    if (captcha) requestBody.captcha = captcha;

    const response = await this.fetchWithTimeout(
      `${baseUrl}/v1/register/${encodeURIComponent(phoneNumber)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      15000
    );

    const body = await this.readHttpResponseBody(response);
    if (!response.ok) {
      const error = this.extractSignalApiError(body) || `HTTP ${response.status}`;
      throw new Error(error);
    }

    return {
      message: 'Registration started. Check SMS/voice code and verify in setup.',
      phoneNumber,
    };
  }

  private async verifySignalAccount(payload: SignalVerifyPayload): Promise<{
    message: string;
    phoneNumber: string;
  }> {
    const { baseUrl, phoneNumber: configPhone } = await this.requireSignalRestWrapper();
    const phoneNumber = this.normalizePhoneNumber(payload.phoneNumber) || configPhone;
    const code = this.sanitizeString(payload.code);
    if (!phoneNumber) {
      throw new Error('Signal phone number is required');
    }
    if (!code) {
      throw new Error('Verification code is required');
    }

    const pin = this.sanitizeString(payload.pin);
    const requestBody = pin ? { pin } : {};

    const response = await this.fetchWithTimeout(
      `${baseUrl}/v1/register/${encodeURIComponent(phoneNumber)}/verify/${encodeURIComponent(code)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      15000
    );

    const body = await this.readHttpResponseBody(response);
    if (!response.ok) {
      const error = this.extractSignalApiError(body) || `HTTP ${response.status}`;
      throw new Error(error);
    }

    return {
      message: 'Signal number verified successfully.',
      phoneNumber,
    };
  }

  private async createSignalLinkQr(payload: SignalQrPayload): Promise<{
    message: string;
    deviceName: string;
    imageDataUrl: string;
  }> {
    const { baseUrl } = await this.requireSignalRestWrapper();
    const deviceName = this.sanitizeString(payload.deviceName) || 'FoxFang';
    const response = await this.fetchWithTimeout(
      `${baseUrl}/v1/qrcodelink?device_name=${encodeURIComponent(deviceName)}`,
      { method: 'GET' },
      15000
    );

    const contentType = this.sanitizeString(response.headers.get('content-type') || '') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());

    if (!response.ok) {
      const raw = buffer.toString('utf8');
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // leave raw text
      }
      const error = this.extractSignalApiError(parsed) || `HTTP ${response.status}`;
      throw new Error(error);
    }

    if (contentType.toLowerCase().includes('application/json')) {
      const raw = buffer.toString('utf8');
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // leave raw text
      }
      const error = this.extractSignalApiError(parsed);
      if (error) {
        throw new Error(error);
      }
      throw new Error('Signal API did not return QR image data.');
    }

    return {
      message: 'Scan this QR in Signal > Settings > Linked devices.',
      deviceName,
      imageDataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    };
  }

  private async resolveEnabledChannels(): Promise<string[]> {
    if (ENV_CHANNELS.length > 0) {
      return [...ENV_CHANNELS];
    }

    const config = await loadConfig().catch(() => null);
    if (!config?.channels || typeof config.channels !== 'object') {
      return [];
    }

    return Object.entries(config.channels)
      .filter(([, channelConfig]) => Boolean(channelConfig?.enabled))
      .map(([channelName]) => channelName.trim())
      .filter(Boolean);
  }

  private async persistSetupConfig(payload: SetupPayload): Promise<void> {
    const config = await loadConfig();
    const existingProviderMap = new Map<string, any>(
      (config.providers || []).map((provider: any) => [provider.id, provider])
    );

    const providers = (payload.providers || []).map((provider) => {
      const normalized = this.normalizeProvider(provider);
      const existing = existingProviderMap.get(normalized.id);
      if (!normalized.apiKey && existing?.apiKey) {
        normalized.apiKey = existing.apiKey;
      }
      if (!normalized.baseUrl && existing?.baseUrl) {
        normalized.baseUrl = existing.baseUrl;
      }
      if (!normalized.defaultModel && existing?.defaultModel) {
        normalized.defaultModel = existing.defaultModel;
      }
      return normalized;
    });

    const enabledProviders = providers.filter((provider) => provider.enabled !== false);

    if (enabledProviders.length === 0) {
      throw new Error('At least one enabled provider is required');
    }

    for (const provider of enabledProviders) {
      if (provider.id !== 'ollama' && !provider.apiKey) {
        throw new Error(`Provider "${provider.id}" is missing API key`);
      }
    }

    const defaultProviderInput = this.sanitizeString(payload.defaultProvider);
    const defaultProvider = enabledProviders.some((provider) => provider.id === defaultProviderInput)
      ? defaultProviderInput
      : enabledProviders[0].id;

    const selectedDefault = enabledProviders.find((provider) => provider.id === defaultProvider);
    const defaultModelInput = this.sanitizeString(payload.defaultModel);
    const defaultModel = defaultModelInput || selectedDefault?.defaultModel || 'gpt-4o-mini';

    config.providers = providers;
    config.defaultProvider = defaultProvider;
    config.defaultModel = defaultModel;

    const normalizedChannels = this.normalizeChannels(payload.channels);
    if (normalizedChannels) {
      const nextChannels: Record<string, any> = { ...(config.channels || {}) };
      for (const channelName of Object.keys(normalizedChannels)) {
        const incoming = normalizedChannels[channelName] || {};
        const existing = nextChannels[channelName] || {};
        const merged = { ...existing, ...incoming };

        if (typeof incoming.botToken === 'string' && incoming.botToken.trim() === '' && existing.botToken) {
          merged.botToken = existing.botToken;
        }
        if (typeof incoming.appToken === 'string' && incoming.appToken.trim() === '' && existing.appToken) {
          merged.appToken = existing.appToken;
        }

        nextChannels[channelName] = merged;
      }
      config.channels = nextChannels as any;
    }

    config.autoReply = this.normalizeAutoReply(payload.autoReply, config.autoReply);

    if (config.channels?.signal?.enabled) {
      const signalPhone = this.sanitizeString(config.channels.signal.phoneNumber);
      if (!signalPhone) {
        throw new Error('Signal channel requires phone number');
      }
      config.channels.signal.httpUrl = this.normalizeSignalHttpUrl(config.channels.signal.httpUrl);
    }

    const braveSearchApiKey = this.sanitizeString(payload.braveSearchApiKey);
    if (braveSearchApiKey) {
      await saveCredential('brave-search', {
        provider: 'brave-search',
        apiKey: braveSearchApiKey,
        createdAt: new Date().toISOString(),
      });
      config.braveSearch = { ...(config.braveSearch || {}), apiKeyRef: 'credential:brave-search' };
      delete (config.braveSearch as any).apiKey;
    }

    const firecrawlApiKey = this.sanitizeString(payload.firecrawlApiKey);
    if (firecrawlApiKey) {
      await saveCredential('firecrawl', {
        provider: 'firecrawl',
        apiKey: firecrawlApiKey,
        createdAt: new Date().toISOString(),
      });
      config.firecrawl = { ...(config.firecrawl || {}), apiKeyRef: 'credential:firecrawl' };
      delete (config.firecrawl as any).apiKey;
    }

    const notionApiKey = this.sanitizeString(payload.notionApiKey);
    if (notionApiKey && notionApiKey.startsWith('secret_')) {
      await saveCredential('notion', {
        provider: 'notion',
        apiKey: notionApiKey,
        createdAt: new Date().toISOString(),
      });
      config.notion = { ...(config.notion || {}), apiKeyRef: 'credential:notion' };
      delete (config.notion as any).apiKey;
    }

    await saveConfig(config);
  }

  private scheduleRestart(reason: string): void {
    if (this.restartScheduled) {
      return;
    }
    this.restartScheduled = true;
    console.log(`[Gateway] Restart scheduled: ${reason}`);
    setTimeout(async () => {
      try {
        this.cronService?.stop();
        await this.channelManager.disconnectAll();
      } catch (error) {
        console.error('[Gateway] Error while preparing restart:', error);
      } finally {
        // Non-zero exit to trigger restart with ON_FAILURE policy on Railway.
        process.exit(1);
      }
    }, 350);
  }

  private renderSetupPage(): string {
    const setupPagePath = join(__dirname, 'setup-page.html');
    if (existsSync(setupPagePath)) {
      return readFileSync(setupPagePath, 'utf8');
    }
    return '<!doctype html><html><body><h1>FoxFang Setup</h1><p>Setup page file is missing. Rebuild project and ensure static assets are copied.</p></body></html>';
  }

  private sendHtml(res: ServerResponse, html: string): void {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  }

  private sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }

  private serveStaticFile(res: ServerResponse, pathname: string): void {
    try {
      // Security: prevent directory traversal
      const safePath = pathname.replace(/\.{2,}/g, '').replace(/^\/ui/, '');
      const filePath = join(__dirname, 'ui', safePath || 'index.html');
      
      if (!existsSync(filePath)) {
        this.sendJson(res, 404, { error: 'Not found' });
        return;
      }

      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        this.sendJson(res, 403, { error: 'Forbidden' });
        return;
      }

      // Determine content type based on file extension
      const ext = filePath.split('.').pop()?.toLowerCase();
      const contentTypes: Record<string, string> = {
        'html': 'text/html',
        'js': 'application/javascript',
        'css': 'text/css',
        'json': 'application/json',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
      };

      const content = readFileSync(filePath);
      res.statusCode = 200;
      res.setHeader('content-type', contentTypes[ext || ''] || 'application/octet-stream');
      res.setHeader('cache-control', 'public, max-age=3600');
      res.end(content);
    } catch (error) {
      console.error('[Gateway] Error serving static file:', error);
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  private async initialize(): Promise<void> {
    this.enabledChannels = await this.resolveEnabledChannels();
    const config = await loadConfig().catch(() => ({} as any));
    const requireMentionByChannel = this.resolveRequireMentionByChannel(config);
    const autoReplyDefaultAgent = this.resolveAutoReplyDefaultAgent(config);
    const autoReplyDefaultSessionScope = this.resolveAutoReplyDefaultSessionScope(config);
    const autoReplyBindings = this.resolveAutoReplyBindings(config);
    this.channelManager = new ChannelManager(this.enabledChannels, {
      autoReply: {
        enabled: true,
        defaultAgent: autoReplyDefaultAgent,
        defaultSessionScope: autoReplyDefaultSessionScope,
        bindings: autoReplyBindings,
        requireMention: false,
        requireMentionByChannel,
        replyToMessage: true,
      },
    });
    console.log(`[Gateway] Channels enabled: ${this.enabledChannels.join(', ') || 'none'}`);
    console.log(
      `[Gateway] Group reply mode: telegram=${requireMentionByChannel.telegram ? 'mention' : 'always'}, ` +
      `discord=${requireMentionByChannel.discord ? 'mention' : 'always'}, ` +
      `slack=${requireMentionByChannel.slack ? 'mention' : 'always'}, ` +
      `signal=${requireMentionByChannel.signal ? 'mention' : 'always'}`
    );
    console.log(
      `[Gateway] Auto-reply default agent=${autoReplyDefaultAgent}, sessionScope=${autoReplyDefaultSessionScope}, bindings=${autoReplyBindings.length}`
    );

    // Initialize agents
    await this.initializeAgents();
    
    // Initialize cron service
    this.initializeCronService();
    
    // Connect channels
    if (this.enabledChannels.length > 0) {
      this.channelManager.setOrchestrator(this.orchestrator!);
      await this.channelManager.connectAll();
    }
  }

  private initializeCronService(): void {
    this.cronService = new CronService({
      executeJob: async (job) => {
        if (!this.orchestrator) {
          return { success: false, error: 'Orchestrator not available' };
        }

        try {
          let message: string;
          if (job.payload.kind === 'systemEvent') {
            message = `[Cron: ${job.name}] ${job.payload.text}`;
          } else {
            message = `[Cron: ${job.name}] ${job.payload.message}`;
          }

          const result = await this.orchestrator.run({
            sessionId: job.sessionKey || `cron-${job.id}`,
            agentId: job.agentId || agentRegistry.resolveDefaultAgentId(),
            message,
            stream: false,
          });

          return {
            success: true,
            output: result.content,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      deliverResult: async (job, result) => {
        // TODO: Implement delivery to channels
        return { success: false, error: 'Delivery not implemented' };
      },
      onError: (error) => {
        console.error('[CronService] Error:', error);
      },
    });

    // Start cron service
    this.cronService.start();
    
    // Make it available to the cron tool
    setCronService(this.cronService);
    
    console.log('[Gateway] Cron service initialized');
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws, req) => {
      const { query } = parse(req.url || '', true);
      const clientType = query.type as string || 'cli';
      const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const connection: ClientConnection = {
        ws,
        id: clientId,
        type: clientType as 'cli' | 'channel',
        channelName: query.channel as string | undefined,
      };
      
      this.clients.set(clientId, connection);
      console.log(`[Gateway] Client connected: ${clientId} (${clientType})`);
      
      ws.on('message', (data) => this.handleMessage(clientId, data));
      ws.on('close', () => this.handleDisconnect(clientId));
      ws.on('error', (err) => console.error(`[Gateway] Client ${clientId} error:`, err));
      
      // Send welcome
      this.sendToClient(clientId, {
        type: 'connected',
        clientId,
        gatewayVersion: '1.0.0',
      });
    });
  }

  private async handleMessage(clientId: string, data: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    try {
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const message = JSON.parse(dataBuffer.toString());
      console.log(`[Gateway] Message from ${clientId}:`, message.type);
      
      switch (message.type) {
        case 'chat':
          await this.handleChatMessage(clientId, message);
          break;
        case 'channel:message':
          await this.handleChannelMessage(clientId, message);
          break;
        case 'ping':
          this.sendToClient(clientId, { type: 'pong' });
          break;
        case 'status':
          this.sendToClient(clientId, {
            type: 'status',
            clients: this.clients.size,
            channels: Array.from(this.clients.values())
              .filter(c => c.type === 'channel')
              .map(c => c.channelName),
          });
          break;
        default:
          console.log(`[Gateway] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error(`[Gateway] Error handling message:`, err);
      this.sendToClient(clientId, {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleChatMessage(clientId: string, message: any): Promise<void> {
    if (!this.orchestrator) {
      await this.initializeAgents();
    }
    
    if (!this.orchestrator) {
      this.sendToClient(clientId, { type: 'error', error: 'Orchestrator not available' });
      return;
    }
    
    // Stream response
    const result = await this.orchestrator.run({
      sessionId: message.sessionId || `gateway-${Date.now()}`,
      agentId: message.agentId || agentRegistry.resolveDefaultAgentId(),
      message: message.content,
      projectId: message.projectId,
      stream: true,
    });
    
    if (result.stream) {
      for await (const chunk of result.stream) {
        this.sendToClient(clientId, {
          type: 'chat:chunk',
          chunk,
        });
      }
      
      this.sendToClient(clientId, { type: 'chat:done' });
    }
  }

  private async handleChannelMessage(clientId: string, message: any): Promise<void> {
    // Handle incoming messages from channels (Telegram, Discord, etc.)
    console.log(`[Gateway] Channel message from ${clientId}:`, message.channel, message.content);
    
    // TODO: Route to appropriate agent and send response back to channel
    this.sendToClient(clientId, {
      type: 'channel:ack',
      messageId: message.messageId,
    });
  }

  private async initializeAgents(): Promise<void> {
    const config = await loadConfigWithCredentials();
    initializeProviders(config.providers);
    setDefaultProvider(config.defaultProvider);
    initializeTools(config.tools?.tools || {});
    
    // Initialize FoxFang home and workspace
    const foxfangHome = initFoxFangHome(config.workspace?.homeDir);
    const workspaceManager = createWorkspaceManager(
      'default_user',
      foxfangHome,
      undefined, // projectId
      undefined  // agentId
    );
    
    this.sessionManager = new SessionManager(config.sessions);
    this.orchestrator = new AgentOrchestrator(this.sessionManager, workspaceManager);
    wireDelegateOrchestrator(this.orchestrator);
    
    // Set workspace manager for channel manager too
    this.channelManager.setWorkspaceManager(workspaceManager);
    
    console.log('[Gateway] Agents initialized');
  }

  private handleDisconnect(clientId: string): void {
    this.clients.delete(clientId);
    console.log(`[Gateway] Client disconnected: ${clientId}`);
  }

  private sendToClient(clientId: string, data: any): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  public broadcast(data: any): void {
    const message = JSON.stringify(data);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

// Start server
const server = new GatewayServer(PORT);

// Handle process signals
process.on('SIGTERM', async () => {
  console.log('[Gateway] SIGTERM received, shutting down...');
  server['cronService']?.stop();
  await server['channelManager'].disconnectAll();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Gateway] SIGINT received, shutting down...');
  server['cronService']?.stop();
  await server['channelManager'].disconnectAll();
  process.exit(0);
});
