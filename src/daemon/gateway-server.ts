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
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'url';
import { getConfigPath, loadConfig, loadConfigWithCredentials, saveConfig } from '../config/index';
import { initializeProviders } from '../providers/index';
import { AgentOrchestrator } from '../agents/orchestrator';
import { SessionManager } from '../sessions/manager';
import { initializeTools } from '../tools/index';
import { setDefaultProvider } from '../agents/runtime';
import { ChannelManager } from '../channels/manager';
import { CronService } from '../cron/service';
import { setCronService } from '../tools/builtin/cron';
import { initCronTables } from '../cron/store';
import { createWorkspaceManager } from '../workspace/manager';
import { initFoxFangHome } from '../workspace/manager';
import { GITHUB_OAUTH_PROXY, disconnectGitHub, getGitHubToken, saveGitHubToken } from '../integrations/github';
import { getCredential } from '../credentials/index';

const PORT = parseInt(
  process.env.FOXFANG_GATEWAY_PORT || process.env.PORT || '8787',
  10
);
const CHANNELS = (process.env.FOXFANG_CHANNELS || '').split(',').filter(Boolean);
const SETUP_USERNAME = process.env.SETUP_USERNAME || '';
const SETUP_PASSWORD = process.env.SETUP_PASSWORD || '';

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
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
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
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.1-70b-instruct'],
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.1', 'qwen2.5', 'deepseek-coder'],
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
};

type SetupPayload = {
  defaultProvider?: string;
  defaultModel?: string;
  providers?: ProviderSetupInput[];
  channels?: {
    telegram?: ChannelSetupInput;
    discord?: ChannelSetupInput;
    slack?: ChannelSetupInput;
    signal?: ChannelSetupInput;
  };
  braveSearchApiKey?: string;
  firecrawlApiKey?: string;
};

type SetupModelsPayload = {
  providerId?: string;
  apiKey?: string;
  baseUrl?: string;
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
    this.channelManager = new ChannelManager(CHANNELS);
    
    // Initialize cron tables
    initCronTables();
    
    this.setupWebSocket();
    this.initialize();
    
    server.listen(port, () => {
      console.log(`[Gateway] Server listening on port ${port}`);
      console.log(`[Gateway] Channels enabled: ${CHANNELS.join(', ') || 'none'}`);
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
        channels: CHANNELS,
      });
      return;
    }

    if (url.pathname.startsWith('/setup')) {
      await this.handleSetupRoute(req, res, method, url.pathname);
      return;
    }

    if (method === 'GET' && url.pathname === '/') {
      this.sendJson(res, 200, {
        name: 'foxfang-gateway',
        status: 'running',
        websocket: true,
        health: '/health',
        setup: '/setup',
      });
      return;
    }

    this.sendJson(res, 404, { error: 'Not found' });
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
      this.sendJson(res, 200, {
        ready: this.hasConfiguredProvider(config),
        defaultProvider: config.defaultProvider,
        defaultModel: config.defaultModel,
        providers: (config.providers || []).map((provider) => ({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey || '',
          defaultModel: (provider as any).defaultModel,
          enabled: provider.enabled !== false,
          hasApiKey: Boolean(provider.apiKey),
        })),
        channels: {
          telegram: {
            enabled: Boolean(config.channels?.telegram?.enabled),
            botToken: config.channels?.telegram?.botToken || '',
            hasBotToken: Boolean(config.channels?.telegram?.botToken),
          },
          discord: {
            enabled: Boolean(config.channels?.discord?.enabled),
            botToken: config.channels?.discord?.botToken || '',
            hasBotToken: Boolean(config.channels?.discord?.botToken),
          },
          slack: {
            enabled: Boolean(config.channels?.slack?.enabled),
            botToken: config.channels?.slack?.botToken || '',
            appToken: config.channels?.slack?.appToken || '',
            hasBotToken: Boolean(config.channels?.slack?.botToken),
            hasAppToken: Boolean(config.channels?.slack?.appToken),
          },
          signal: {
            enabled: Boolean(config.channels?.signal?.enabled),
            phoneNumber: config.channels?.signal?.phoneNumber || '',
          },
        },
        webTools: {
          braveSearchApiKey,
          firecrawlApiKey,
          hasBraveSearchApiKey: Boolean(braveSearchApiKey),
          hasFirecrawlApiKey: Boolean(firecrawlApiKey),
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

  private isSetupAuthValid(req: IncomingMessage, res: ServerResponse): boolean {
    if (!SETUP_USERNAME || !SETUP_PASSWORD) {
      this.sendJson(res, 503, {
        error: 'Setup auth is not configured. Set SETUP_USERNAME and SETUP_PASSWORD environment variables.',
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

    if (username !== SETUP_USERNAME || password !== SETUP_PASSWORD) {
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
    const forwardedProto = this.sanitizeString(req.headers['x-forwarded-proto']);
    const proto = forwardedProto.split(',')[0] || 'http';

    const forwardedHostHeader = req.headers['x-forwarded-host'];
    const forwardedHost = Array.isArray(forwardedHostHeader)
      ? this.sanitizeString(forwardedHostHeader[0])
      : this.sanitizeString(forwardedHostHeader);

    const hostHeader = req.headers.host || '';
    const host = forwardedHost || this.sanitizeString(hostHeader);

    if (!host) {
      return `http://127.0.0.1:${PORT}`;
    }

    return `${proto}://${host}`;
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

    if (state && !this.consumeGitHubOAuthState(state)) {
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
      channels.telegram = {
        enabled: Boolean(input.telegram.enabled),
        botToken: this.sanitizeString(input.telegram.botToken),
      };
    }

    if (input.discord) {
      channels.discord = {
        enabled: Boolean(input.discord.enabled),
        botToken: this.sanitizeString(input.discord.botToken),
      };
    }

    if (input.slack) {
      channels.slack = {
        enabled: Boolean(input.slack.enabled),
        botToken: this.sanitizeString(input.slack.botToken),
        appToken: this.sanitizeString(input.slack.appToken),
      };
    }

    if (input.signal) {
      channels.signal = {
        enabled: Boolean(input.signal.enabled),
        phoneNumber: this.sanitizeString(input.signal.phoneNumber),
      };
    }

    return channels;
  }

  private getDefaultSignalHttpUrl(): string {
    const configured = this.sanitizeString(process.env.SIGNAL_HTTP_URL);
    if (configured) {
      return configured;
    }
    return 'http://127.0.0.1:8686';
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

    if (config.channels?.signal?.enabled) {
      const signalPhone = this.sanitizeString(config.channels.signal.phoneNumber);
      if (!signalPhone) {
        throw new Error('Signal channel requires phone number');
      }
      const signalHttpUrl = this.sanitizeString(config.channels.signal.httpUrl);
      if (!signalHttpUrl) {
        config.channels.signal.httpUrl = this.getDefaultSignalHttpUrl();
      }
    }

    const braveSearchApiKey = this.sanitizeString(payload.braveSearchApiKey);
    if (braveSearchApiKey) {
      config.braveSearch = { ...(config.braveSearch || {}), apiKey: braveSearchApiKey };
    }

    const firecrawlApiKey = this.sanitizeString(payload.firecrawlApiKey);
    if (firecrawlApiKey) {
      config.firecrawl = {
        ...(config.firecrawl || {}),
        ...(firecrawlApiKey ? { apiKey: firecrawlApiKey } : {}),
      };
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

  private async initialize(): Promise<void> {
    // Initialize agents
    await this.initializeAgents();
    
    // Initialize cron service
    this.initializeCronService();
    
    // Connect channels
    if (CHANNELS.length > 0) {
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
            agentId: job.agentId || 'orchestrator',
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
      agentId: message.agentId || 'orchestrator',
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
    const foxfangHome = initFoxFangHome();
    const workspaceManager = createWorkspaceManager(
      'default_user',
      foxfangHome,
      undefined, // projectId
      undefined  // agentId
    );
    
    this.sessionManager = new SessionManager(config.sessions);
    this.orchestrator = new AgentOrchestrator(this.sessionManager, workspaceManager);
    
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
