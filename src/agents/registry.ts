/**
 * Agent Registry
 *
 * Config-driven agent system — no hardcoded agents.
 * All agents are defined in foxfang.json under agents.list[].
 * A minimal "main" fallback agent is created only when no agents are configured.
 */

import { loadConfig } from '../config/index';
import { Agent } from './types';
import { toolRegistry } from '../tools/index';

export const DEFAULT_AGENT_ID = 'main';

/**
 * Build the fallback "main" agent with ALL registered tools.
 * Used only when no agents are configured in foxfang.json.
 */
function buildDefaultMainAgent(): Agent {
  const allToolNames = toolRegistry.getAllSpecs().map(t => t.name);
  return {
    id: DEFAULT_AGENT_ID,
    name: 'Main',
    role: 'assistant',
    description: 'Default FoxFang assistant with all available tools',
    systemPrompt: '',
    tools: allToolNames,
  };
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

  // Tools: undefined = all tools; [] = no tools; ["tool1"] = specific tools
  let tools: string[];
  if (raw.tools === undefined || raw.tools === null) {
    // No tools specified = give all registered tools
    tools = toolRegistry.getAllSpecs().map(t => t.name);
  } else {
    tools = sanitizeStringArray(raw.tools);
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

  /**
   * Get or create an agent by ID.
   * If the agent doesn't exist, creates a fallback with all tools.
   */
  ensure(agentId: string): Agent {
    const existing = this.get(agentId);
    if (existing) return existing;

    // Create a fallback agent on-the-fly with all tools
    const allToolNames = toolRegistry.getAllSpecs().map(t => t.name);
    const fallback: Agent = {
      id: agentId,
      name: titleCaseFromId(agentId),
      role: 'assistant',
      description: `Agent: ${titleCaseFromId(agentId)}`,
      systemPrompt: '',
      tools: allToolNames,
    };
    this.register(fallback);
    console.log(`[AgentRegistry] Created fallback agent "${agentId}" with ${allToolNames.length} tools`);
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
