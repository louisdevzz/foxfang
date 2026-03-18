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
    telegram?: { enabled: boolean; botToken: string };
    discord?: { enabled: boolean; botToken: string };
    slack?: { enabled: boolean; botToken: string };
    signal?: { enabled: boolean; phoneNumber: string };
  };
  observability: { enabled: boolean };
  heartbeat: { enabled: boolean; intervalMs: number };
  cron: { enabled: boolean; pollIntervalMs: number };
  security: { allowedOrigins: string[] };
  gateway: { port: number; host: string; enableCors: boolean; maxRequestSize: string };
  // Optional web tool API keys
  braveSearch?: { apiKey: string };
  firecrawl?: { apiKey: string; baseUrl?: string };
}

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string;
  enabled: boolean;
  baseUrl?: string;
  models?: string[];
  headers?: Record<string, string>;
  apiType?: 'openai' | 'anthropic-messages';
}

const defaultConfig: AppConfig = {
  defaultProvider: 'openai',
  defaultModel: 'gpt-4o',
  providers: [],
  tools: {},
  sessions: { maxSessions: 100, ttl: 86400000 },
  memory: { enabled: true },
  daemon: { enabled: false, port: 8787, host: '127.0.0.1' },
  workspace: { homeDir: join(homedir(), '.foxfang') },
  observability: { enabled: true },
  heartbeat: { enabled: true, intervalMs: 30000 },
  cron: { enabled: true, pollIntervalMs: 60000 },
  security: { allowedOrigins: ['http://localhost:3000'] },
  gateway: { port: 8787, host: '0.0.0.0', enableCors: true, maxRequestSize: '10mb' },
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
    return { ...defaultConfig, ...parsed };
  } catch (error) {
    console.error('Failed to load config, using defaults:', error);
    return { ...defaultConfig };
  }
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
