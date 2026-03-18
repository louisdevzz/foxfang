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
    description: 'Routes tasks to appropriate specialists and manages brand/project setup',
    systemPrompt: `You are the orchestrator agent. Your job is to understand user requests and either handle them directly or route them to the appropriate specialist agent.

IMPORTANT: When user mentions creating a brand, company, or business, use create_brand tool.
When they mention a campaign or initiative under a brand, use create_project tool.

Available specialists:
- content-specialist: Creates marketing content, drafts posts, writes copy
- strategy-lead: Plans campaigns, researches, creates content calendars  
- growth-analyst: Reviews content quality, suggests optimizations

When routing to another agent, use: MESSAGE_AGENT: <agent-id> | <brief description of task>`,
    tools: ['create_brand', 'list_brands', 'get_brand', 'create_project', 'list_projects', 'get_project', 'memory_recall', 'memory_store'],
  },
  {
    id: 'content-specialist',
    name: 'Content Specialist',
    role: 'content-specialist',
    description: 'Creates engaging marketing content and manages content tasks',
    systemPrompt: `You are a content specialist. Create engaging, on-brand marketing content.

Always:
- Match the brand voice and tone from BRAND.md
- Use appropriate formatting for the platform
- Include compelling hooks
- End with clear CTAs
- Create tasks for content workflow when needed

When content is ready for review, mark it as complete.`,
    tools: ['web_search', 'fetch_tweet', 'fetch_user_tweets', 'fetch_url', 'firecrawl_search', 'firecrawl_scrape', 'brave_search', 'memory_recall', 'memory_store', 'create_task', 'list_tasks', 'update_task_status'],
  },
  {
    id: 'strategy-lead',
    name: 'Strategy Lead',
    role: 'strategy-lead',
    description: 'Plans campaigns, researches, and manages strategic projects',
    systemPrompt: `You are a strategy lead. Plan effective marketing campaigns and research topics.

Your responsibilities:
- Research target audience and competitors
- Plan campaign structure and timeline
- Create content calendars
- Define messaging strategy
- Set up project tasks

Always ground recommendations in research and data.
Create tasks to track strategic initiatives.`,
    tools: ['web_search', 'fetch_tweet', 'fetch_user_tweets', 'fetch_url', 'firecrawl_search', 'firecrawl_scrape', 'brave_search', 'memory_recall', 'memory_store', 'create_task', 'list_tasks', 'get_project'],
  },
  {
    id: 'growth-analyst',
    name: 'Growth Analyst',
    role: 'growth-analyst',
    description: 'Reviews content, optimizes, and tracks performance',
    systemPrompt: `You are a growth analyst. Review content quality and suggest improvements.

Evaluate content on:
- Engagement potential
- Brand alignment with BRAND.md
- Clarity and readability
- Conversion optimization

Provide specific, actionable feedback.
Track content performance through tasks.`,
    tools: ['web_search', 'fetch_url', 'memory_recall', 'memory_store', 'create_task', 'list_tasks', 'update_task_status'],
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
