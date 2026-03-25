/**
 * Providers Index
 */

import { Provider, ProviderStatus } from './traits';

const providers: Map<string, Provider> = new Map();
const providerConfigs: Map<string, ProviderConfig> = new Map();

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string;
  enabled: boolean;
  baseUrl?: string;
  defaultModel?: string;
  smallModel?: string;
  models?: string[];
  headers?: Record<string, string>;
  apiType?: string;
}

export function registerProvider(id: string, provider: Provider, config?: ProviderConfig): void {
  providers.set(id, provider);
  if (config) providerConfigs.set(id, config);
}

export function getProvider(id: string): Provider | undefined {
  return providers.get(id);
}

export function getProviderConfig(id: string): ProviderConfig | undefined {
  return providerConfigs.get(id);
}

export function getProviderWithFallback(id: string): Provider | undefined {
  const provider = providers.get(id);
  if (provider) return provider;
  
  // Fallback to first available
  return providers.values().next().value;
}

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const statuses: ProviderStatus[] = [];
  
  for (const [id, provider] of providers) {
    try {
      const status = await provider.getStatus();
      statuses.push({
        id,
        name: provider.name,
        healthy: status.healthy,
        error: status.error,
      });
    } catch (error) {
      statuses.push({
        id,
        name: provider.name,
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  return statuses;
}

export async function runHealthChecks(): Promise<void> {
  for (const [id, provider] of providers) {
    try {
      const status = await provider.getStatus();
      console.log(`Provider ${id}: ${status.healthy ? 'healthy' : 'unhealthy'}`);
    } catch (error) {
      console.error(`Provider ${id} health check failed:`, error);
    }
  }
}

export function initializeProviders(configs: ProviderConfig[]): void {
  for (const config of configs) {
    if (!config.enabled) continue;
    
    try {
      let provider: Provider;
      
      switch (config.id) {
        case 'openai':
          const { OpenAIProvider } = require('./openai');
          provider = new OpenAIProvider(config);
          break;
        case 'anthropic':
          const { AnthropicProvider } = require('./anthropic');
          provider = new AnthropicProvider(config);
          break;
        case 'kimi':
          const { KimiProvider } = require('./kimi');
          provider = new KimiProvider(config);
          break;
        case 'kimi-coding':
          // Kimi Coding uses Anthropic Messages API format
          const { KimiCodingProvider } = require('./kimi');
          provider = new KimiCodingProvider(config);
          break;
        case 'github-copilot': {
          const { GitHubCopilotProvider } = require('./github-copilot');
          provider = new GitHubCopilotProvider(config);
          break;
        }
        case 'gemini':
        case 'groq':
        case 'byteplus-ark':
        case 'alibabacloud':
        case 'openrouter':
        case 'ollama':
        case 'nvidia':
        case 'custom': {
          const { OpenAIProvider: OpenAICompatProvider } = require('./openai');
          provider = new OpenAICompatProvider(config);
          break;
        }
        default:
          console.warn(`Unknown provider: ${config.id}`);
          continue;
      }
      
      registerProvider(config.id, provider, config);
      console.log(`Registered provider: ${config.id}`);
    } catch (error) {
      console.error(`Failed to initialize provider ${config.id}:`, error);
    }
  }
}

export * from './traits';
