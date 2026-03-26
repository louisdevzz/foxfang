/**
 * Agent Registry
 *
 * Config-driven agent system — no hardcoded agents.
 * All agents are defined in foxfang.json under either agents[] or agents.list[].
 * A minimal "main" fallback agent is created only when no agents are configured.
 */

import { loadConfig } from '../config/index';
import { Agent } from './types';
import { toolRegistry } from '../tools/index';

export const DEFAULT_AGENT_ID = 'main';

/**
 * Build the fallback "main" agent whose tool list is resolved lazily at runtime
 * so that tools added after this agent is registered are still available.
 */
function buildDefaultMainAgent(): Agent {
  return {
    id: DEFAULT_AGENT_ID,
    name: 'Main',
    role: 'assistant',
    description: 'Default FoxFang assistant with all available tools',
    systemPrompt: '',
    get tools() {
      return toolRegistry.getAllSpecs().map((t) => t.name);
    },
  } as Agent;
}

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
  return { modelTier, verbosity, reasoningDepth };
}

function sanitizeConfigAgent(value: unknown): Agent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = sanitizeString(raw.id);
  if (!id) return null;

  const name = sanitizeString(raw.name) || titleCaseFromId(id);
  const role = sanitizeString(raw.role) || 'assistant';
  const description = sanitizeString(raw.description) || `Agent: ${name}`;
  const systemPrompt = sanitizeString(raw.systemPrompt) || '';
  const isDefault = raw.default === true;

  // Tools:
  //   - undefined or null  => no tools (safe default; requires explicit opt-in)
  //   - ['*'] (or including '*') => all registered tools
  //   - ['tool1', 'tool2'] => specific tools
  let tools: string[];
  if (raw.tools === undefined || raw.tools === null) {
    // No tools specified = grant no tools by default (safe)
    tools = [];
  } else {
    tools = sanitizeStringArray(raw.tools);
    // Explicit wildcard opt-in: '*' means all registered tools
    if (tools.includes('*')) {
      tools = toolRegistry.getAllSpecs().map(t => t.name);
    }
  }

  const model = sanitizeString(raw.model) || undefined;
  const provider = sanitizeString(raw.provider) || undefined;
  const executionProfile = sanitizeExecutionProfile(raw.executionProfile);

  // Skills filter: undefined = all; [] = none; ["skill1"] = specific
  const skills = raw.skills !== undefined ? sanitizeStringArray(raw.skills) : undefined;

  // Subagent policy
  const subagents = raw.subagents as Record<string, unknown> | undefined;

  return {
    id,
    name,
    role,
    description,
    systemPrompt,
    tools,
    isDefault,
    skills,
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(executionProfile ? { executionProfile } : {}),
    ...(subagents ? { subagents: {
      allowAgents: sanitizeStringArray(subagents.allowAgents),
      ...(subagents.model ? { model: sanitizeString(subagents.model) } : {}),
    }} : {}),
  };
}

class AgentRegistry {
  private agents: Map<string, Agent> = new Map();
  private configHydrated = false;
  private hydratePromise?: Promise<void>;

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  register(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  /**
   * Resolve the default agent ID.
   * Priority: agent with default=true → first agent in list → "main"
   */
  resolveDefaultAgentId(): string {
    const defaultAgent = Array.from(this.agents.values()).find(a => a.isDefault);
    if (defaultAgent) return defaultAgent.id;
    const first = Array.from(this.agents.values())[0];
    if (first) return first.id;
    return DEFAULT_AGENT_ID;
  }

  private static readonly MAX_DYNAMIC_FALLBACKS = 50;
  private dynamicFallbackCount = 0;

  /**
   * Get or create an agent by ID.
   * Unknown agent IDs result in a safe fallback with NO tools to avoid
   * unintentionally bypassing tool allowlists. Callers should use
   * resolveDefaultAgentId() to obtain a known-valid agent ID before calling ensure().
   */
  ensure(agentId: string): Agent {
    const existing = this.get(agentId);
    if (existing) return existing;

    // Guard against memory exhaustion from many unique user-supplied agent IDs.
    if (this.dynamicFallbackCount >= AgentRegistry.MAX_DYNAMIC_FALLBACKS) {
      console.warn(`[AgentRegistry] Dynamic fallback limit reached; returning resolved default for unknown agent "${agentId}".`);
      return this.get(this.resolveDefaultAgentId()) ?? this.list()[0] ?? {
        id: DEFAULT_AGENT_ID,
        name: 'Main',
        role: 'assistant',
        description: 'Default FoxFang assistant',
        systemPrompt: '',
        tools: [],
      };
    }

    // Create a safe fallback agent with no tools so that user-controlled
    // agentId inputs cannot bypass tool allowlists.
    const fallback: Agent = {
      id: agentId,
      name: titleCaseFromId(agentId),
      role: 'assistant',
      description: `Agent: ${titleCaseFromId(agentId)}`,
      systemPrompt: '',
      tools: [],
    };
    this.register(fallback);
    this.dynamicFallbackCount++;
    console.warn(`[AgentRegistry] Unknown agent "${agentId}" — created safe fallback with no tools. Configure this agent in foxfang.json to grant capabilities.`);
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

        // Load agents from config.agents (array) or config.agents.list (object)
        let configuredAgents: unknown[] = [];
        const agentsField = (config as any)?.agents;
        if (Array.isArray(agentsField)) {
          configuredAgents = agentsField;
        } else if (agentsField && Array.isArray(agentsField.list)) {
          configuredAgents = agentsField.list;
        }

        for (const candidate of configuredAgents) {
          const sanitized = sanitizeConfigAgent(candidate);
          if (!sanitized) continue;
          this.register(sanitized);
        }

        // If no agents configured, register the default "main" agent
        if (this.agents.size === 0) {
          this.register(buildDefaultMainAgent());
          console.log(`[AgentRegistry] No agents configured, using default "main" agent`);
        }

        console.log(`[AgentRegistry] Loaded ${this.agents.size} agent(s): ${Array.from(this.agents.keys()).join(', ')}`);
      } catch {
        // Config load failed — ensure at least the default agent exists
        if (this.agents.size === 0) {
          this.register(buildDefaultMainAgent());
        }
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

export async function resolveDefaultAgentId(): Promise<string> {
  await agentRegistry.hydrateFromConfig();
  return agentRegistry.resolveDefaultAgentId();
}
