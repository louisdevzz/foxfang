/**
 * Agent Registry
 * 
 * Manages available agents and their configurations.
 */

import { Agent, AgentRole } from './types';

const defaultAgents: Agent[] = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    role: 'orchestrator',
    description: 'Routes tasks to appropriate specialists',
    systemPrompt: `You are the orchestrator agent. Your job is to understand user requests and either handle them directly or route them to the appropriate specialist agent.

Available specialists:
- content-specialist: Creates marketing content, drafts posts, writes copy
- strategy-lead: Plans campaigns, researches, creates content calendars
- growth-analyst: Reviews content quality, suggests optimizations

When routing, use: MESSAGE_AGENT: <agent-id> | <brief description of task>`,
    tools: ['memory_recall', 'memory_store'],
  },
  {
    id: 'content-specialist',
    name: 'Content Specialist',
    role: 'content-specialist',
    description: 'Creates engaging marketing content',
    systemPrompt: `You are a content specialist. Create engaging, on-brand marketing content.

Always:
- Match the brand voice and tone
- Use appropriate formatting for the platform
- Include compelling hooks
- End with clear CTAs

When content is ready for review, mark it as complete.`,
    tools: ['web_search', 'memory_recall', 'memory_store', 'generate_content'],
  },
  {
    id: 'strategy-lead',
    name: 'Strategy Lead',
    role: 'strategy-lead',
    description: 'Plans campaigns and researches',
    systemPrompt: `You are a strategy lead. Plan effective marketing campaigns and research topics.

Your responsibilities:
- Research target audience and competitors
- Plan campaign structure and timeline
- Create content calendars
- Define messaging strategy

Always ground recommendations in research and data.`,
    tools: ['web_search', 'trend_analysis', 'memory_recall', 'memory_store'],
  },
  {
    id: 'growth-analyst',
    name: 'Growth Analyst',
    role: 'growth-analyst',
    description: 'Reviews and optimizes content',
    systemPrompt: `You are a growth analyst. Review content quality and suggest improvements.

Evaluate content on:
- Engagement potential
- SEO optimization
- Brand alignment
- Clarity and readability

Provide specific, actionable feedback with scores (1-10).`,
    tools: ['content_score', 'memory_recall', 'memory_store'],
  },
];

class AgentRegistry {
  private agents: Map<string, Agent> = new Map();

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
}

export const agentRegistry = new AgentRegistry();
