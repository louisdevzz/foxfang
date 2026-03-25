/**
 * Agent Registry
 * 
 * Manages available agents and their configurations.
 */

import { loadConfig } from '../config/index';
import { Agent, AgentRole } from './types';

const defaultAgents: Agent[] = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    role: 'orchestrator',
    description: 'Routes tasks to appropriate specialists and manages brand/project setup',
    systemPrompt: `Handle user requests directly. Route specialized content work to other agents via MESSAGE_AGENT: <agent-id> | <task>.`,
    tools: [
      'create_brand', 'list_brands', 'get_brand',
      'create_project', 'list_projects', 'get_project',
      'memory_recall', 'memory_search', 'memory_get',
      'skills_list', 'skills_add',
      'sessions_spawn', 'sessions_send', 'subagents',
      'github_connect', 'github_create_issue', 'github_create_pr', 'github_list_issues', 'github_list_prs',
    ],
    executionProfile: {
      modelTier: 'medium',
      verbosity: 'normal',
      reasoningDepth: 'normal',
    },
  },
  {
    id: 'content-specialist',
    name: 'Content Specialist',
    role: 'content-specialist',
    description: 'Creates engaging marketing content and manages content tasks',
    systemPrompt: `You create marketing content that sounds human, not corporate.

Match the brand voice from BRAND.md. Write for the platform — LinkedIn is not Twitter is not email.
Lead with a hook. End with a clear CTA. Track content tasks when needed.

Skip filler phrases. Write like someone who actually cares about the reader.`,
    tools: [
      'web_search', 'brave_search', 'firecrawl_search', 'firecrawl_scrape',
      'fetch_tweet', 'fetch_user_tweets', 'fetch_url',
      'notion_search', 'notion_get_page', 'notion_query_database', 'notion_create_page', 'notion_update_page', 'notion_list_databases',
      'personas_sync',
      'memory_recall', 'memory_store', 'memory_search', 'memory_get',
      'create_task', 'list_tasks', 'update_task_status',
      'skills_list', 'skills_add',
      'expand_cached_result', 'get_cached_snippet',
    ],
    executionProfile: {
      modelTier: 'large',
      verbosity: 'high',
      reasoningDepth: 'deep',
    },
  },
  {
    id: 'strategy-lead',
    name: 'Strategy Lead',
    role: 'strategy-lead',
    description: 'Plans campaigns, researches, and manages strategic projects',
    systemPrompt: `You plan marketing campaigns and research strategy — always grounded in data, never in guesswork.

Research the audience and competitors first. Then build the campaign structure, timeline, and messaging.
Track strategic work through project tasks. If you don't have enough info, ask — don't assume.`,
    tools: [
      'web_search', 'brave_search', 'firecrawl_search', 'firecrawl_scrape',
      'fetch_tweet', 'fetch_user_tweets', 'fetch_url',
      'notion_search', 'notion_get_page', 'notion_query_database', 'notion_create_page', 'notion_update_page', 'notion_list_databases',
      'personas_sync',
      'memory_recall', 'memory_store', 'memory_search', 'memory_get',
      'create_task', 'list_tasks', 'get_project',
      'skills_list', 'skills_add',
      'expand_cached_result', 'get_cached_snippet',
    ],
    executionProfile: {
      modelTier: 'large',
      verbosity: 'normal',
      reasoningDepth: 'deep',
    },
  },
  {
    id: 'growth-analyst',
    name: 'Growth Analyst',
    role: 'growth-analyst',
    description: 'Reviews content, optimizes, and tracks performance',
    systemPrompt: `You review content and find what's working and what's not.

Evaluate engagement potential, brand alignment (BRAND.md), clarity, and conversion.
Give specific, actionable feedback — not vague "make it better" notes. Track performance through tasks.`,
    tools: [
      'web_search', 'fetch_url',
      'memory_recall', 'memory_store', 'memory_search', 'memory_get',
      'create_task', 'list_tasks', 'update_task_status',
      'skills_list', 'skills_add',
      'expand_cached_result', 'get_cached_snippet',
    ],
    executionProfile: {
      modelTier: 'small',
      verbosity: 'low',
      reasoningDepth: 'normal',
    },
  },
];

function titleCaseFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    || id;
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeString(item))
    .filter(Boolean);
}

function sanitizeExecutionProfile(value: unknown): Agent['executionProfile'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const profile = value as Record<string, unknown>;
  const modelTier = profile.modelTier;
  const verbosity = profile.verbosity;
  const reasoningDepth = profile.reasoningDepth;
  if (
    (modelTier !== 'small' && modelTier !== 'medium' && modelTier !== 'large')
    || (verbosity !== 'low' && verbosity !== 'normal' && verbosity !== 'high')
    || (reasoningDepth !== 'light' && reasoningDepth !== 'normal' && reasoningDepth !== 'deep')
  ) {
    return undefined;
  }
  return {
    modelTier,
    verbosity,
    reasoningDepth,
  };
}

function sanitizeConfigAgent(value: unknown): Agent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = sanitizeString(raw.id);
  if (!id) return null;

  const name = sanitizeString(raw.name) || titleCaseFromId(id);
  const role = sanitizeString(raw.role) || (id === 'orchestrator' ? 'orchestrator' : 'specialist');
  const description = sanitizeString(raw.description) || `Dynamic agent: ${name}`;
  const systemPrompt = sanitizeString(raw.systemPrompt)
    || `You are ${name} (${id}). Follow user instructions and provide clear, grounded outputs.`;
  const tools = sanitizeStringArray(raw.tools);
  const model = sanitizeString(raw.model) || undefined;
  const provider = sanitizeString(raw.provider) || undefined;
  const executionProfile = sanitizeExecutionProfile(raw.executionProfile);

  return {
    id,
    name,
    role,
    description,
    systemPrompt,
    tools,
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(executionProfile ? { executionProfile } : {}),
  };
}

class AgentRegistry {
  private agents: Map<string, Agent> = new Map();
  private configHydrated = false;
  private hydratePromise?: Promise<void>;

  constructor() {
    for (const agent of defaultAgents) {
      this.agents.set(agent.id, agent);
    }
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getByRole(role: AgentRole): Agent | undefined {
    return Array.from(this.agents.values()).find(a => a.role === role);
  }

  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  register(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  ensure(agentId: string): Agent {
    const existing = this.get(agentId);
    if (existing) return existing;

    const fallback: Agent = {
      id: agentId,
      name: titleCaseFromId(agentId),
      role: agentId === 'orchestrator' ? 'orchestrator' : 'specialist',
      description: `Auto-generated fallback agent for "${agentId}"`,
      systemPrompt: `You are ${titleCaseFromId(agentId)} (${agentId}). Follow user instructions and provide clear, grounded outputs.`,
      tools: [],
    };
    this.register(fallback);
    return fallback;
  }

  async hydrateFromConfig(force = false): Promise<void> {
    if (this.configHydrated && !force) return;
    if (this.hydratePromise && !force) {
      await this.hydratePromise;
      return;
    }

    this.hydratePromise = (async () => {
      try {
        const config = await loadConfig();
        const configuredAgents = Array.isArray((config as any)?.agents) ? (config as any).agents : [];
        for (const candidate of configuredAgents) {
          const sanitized = sanitizeConfigAgent(candidate);
          if (!sanitized) continue;
          this.register(sanitized);
        }
      } catch {
        // Ignore config hydration failures to keep registry resilient.
      } finally {
        this.configHydrated = true;
      }
    })();

    await this.hydratePromise.finally(() => {
      this.hydratePromise = undefined;
    });
  }
}

export const agentRegistry = new AgentRegistry();

export async function hydrateAgentRegistryFromConfig(force = false): Promise<void> {
  await agentRegistry.hydrateFromConfig(force);
}

export async function ensureAgentRegistered(agentId: string): Promise<Agent> {
  await agentRegistry.hydrateFromConfig();
  return agentRegistry.ensure(agentId);
}
