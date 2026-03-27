/**
 * Tools Index
 */

import { Tool, ToolSpec } from './traits';

// Built-in tool imports (module scope for clarity and startup-time resolution)
const { WebSearchTool } = require('./builtin/web_search');
const { FetchTweetTool, FetchUserTweetsTool } = require('./builtin/tweet_fetcher');
const { FetchUrlTool } = require('./builtin/fetch_url');
const { FirecrawlSearchTool, FirecrawlScrapeTool } = require('./builtin/firecrawl');
const { AgentBrowserTool } = require('./builtin/agent_browser');
const { BraveSearchTool } = require('./builtin/brave_search');
const { MemoryStoreTool, MemoryRecallTool, MemorySearchTool, MemoryGetTool } = require('./builtin/memory');
const { CreateBrandTool, ListBrandsTool, GetBrandTool } = require('./builtin/brand');
const { BashExecTool, BashLegacyTool, BashListTool, BashLogTool, BashPollTool, BashKillTool, BashRemoveTool } = require('./builtin/bash');
const { CronTool } = require('./builtin/cron');
const { GitHubConnectTool, GitHubCreateIssueTool, GitHubCreatePRTool, GitHubListIssuesTool, GitHubListPRsTool } = require('./builtin/github');
const { GitHubGetRepoTool, GitHubListRepoFilesTool, GitHubGetFileTool, GitHubSearchCodeTool } = require('./builtin/github_repo');
const { SkillsListTool, SkillsAddTool } = require('./builtin/skills');
const { ExpandCachedResultTool, GetCachedSnippetTool } = require('./builtin/cached_results');
const { SessionsSpawnTool, SessionsSendTool, SubagentsTool } = require('./builtin/subagents');
const { NotionSearchTool, NotionGetPageTool, NotionQueryDatabaseTool, NotionCreatePageTool, NotionUpdatePageTool, NotionListDatabasesTool } = require('./builtin/notion');
const { PersonasSyncTool } = require('./builtin/personas');
const { FoxFangUpdateTool, FoxFangUpdateStatusTool } = require('./builtin/foxfang_update');

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
}

class ToolRegistryImpl {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): ToolInfo[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
    }));
  }

  getToolSpecs(): ToolSpec[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  getAllSpecs(): ToolSpec[] {
    return this.getToolSpecs();
  }

  getSpecsForTools(toolNames: string[]): ToolSpec[] {
    return this.getToolSpecs().filter(spec => toolNames.includes(spec.name));
  }

  async execute(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(args);
  }

  executeToolCalls(toolCalls: Array<{ name: string; arguments: any }>): Promise<any[]> {
    return Promise.all(toolCalls.map(tc => this.execute(tc.name, tc.arguments)));
  }

  getCount(): number {
    return this.tools.size;
  }

  getEnabledCount(): number {
    return this.tools.size;
  }
}

export const toolRegistry = new ToolRegistryImpl();

// Tool initialization — explicit registration for security auditability
export function initializeTools(config: Record<string, any>): void {
  // Research tools
  toolRegistry.register(new WebSearchTool());
  toolRegistry.register(new FetchTweetTool());
  toolRegistry.register(new FetchUserTweetsTool());
  toolRegistry.register(new FetchUrlTool());
  toolRegistry.register(new FirecrawlSearchTool());
  toolRegistry.register(new FirecrawlScrapeTool());
  toolRegistry.register(new AgentBrowserTool());
  toolRegistry.register(new BraveSearchTool());

  // Memory tools
  toolRegistry.register(new MemoryStoreTool());
  toolRegistry.register(new MemoryRecallTool());
  toolRegistry.register(new MemorySearchTool());
  toolRegistry.register(new MemoryGetTool());

  // Brand management tools
  toolRegistry.register(new CreateBrandTool());
  toolRegistry.register(new ListBrandsTool());
  toolRegistry.register(new GetBrandTool());

  // Bash/Shell execution tools
  toolRegistry.register(new BashExecTool());
  toolRegistry.register(new BashLegacyTool());
  toolRegistry.register(new BashListTool());
  toolRegistry.register(new BashLogTool());
  toolRegistry.register(new BashPollTool());
  toolRegistry.register(new BashKillTool());
  toolRegistry.register(new BashRemoveTool());

  // Cron scheduler tool
  toolRegistry.register(new CronTool());

  // Skills tools
  toolRegistry.register(new SkillsListTool());
  toolRegistry.register(new SkillsAddTool());
  toolRegistry.register(new ExpandCachedResultTool());
  toolRegistry.register(new GetCachedSnippetTool());

  // Session/Sub-agent tools
  toolRegistry.register(new SessionsSpawnTool());
  toolRegistry.register(new SessionsSendTool());
  toolRegistry.register(new SubagentsTool());

  // GitHub tools
  toolRegistry.register(new GitHubConnectTool());
  toolRegistry.register(new GitHubGetRepoTool());
  toolRegistry.register(new GitHubListRepoFilesTool());
  toolRegistry.register(new GitHubGetFileTool());
  toolRegistry.register(new GitHubSearchCodeTool());
  toolRegistry.register(new GitHubCreateIssueTool());
  toolRegistry.register(new GitHubCreatePRTool());
  toolRegistry.register(new GitHubListIssuesTool());
  toolRegistry.register(new GitHubListPRsTool());

  // Notion tools
  toolRegistry.register(new NotionSearchTool());
  toolRegistry.register(new NotionGetPageTool());
  toolRegistry.register(new NotionQueryDatabaseTool());
  toolRegistry.register(new NotionCreatePageTool());
  toolRegistry.register(new NotionUpdatePageTool());
  toolRegistry.register(new NotionListDatabasesTool());

  // Personas tool
  toolRegistry.register(new PersonasSyncTool());

  // FoxFang update tools
  toolRegistry.register(new FoxFangUpdateTool());
  toolRegistry.register(new FoxFangUpdateStatusTool());

  console.log(`Initialized ${toolRegistry.list().length} tools`);
}

export function wireDelegateOrchestrator(orchestrator: any): void {
  // Wire orchestrator + session manager for session/sub-agent runtime tools
  try {
    const { setSubagentToolsRuntime } = require('./builtin/subagents');
    const sessionManager = orchestrator?.sessionManager ?? orchestrator?.['sessionManager'];
    if (typeof setSubagentToolsRuntime === 'function' && orchestrator && sessionManager) {
      setSubagentToolsRuntime(orchestrator, sessionManager);
    }
  } catch {
    // Keep runtime resilient if optional tool wiring fails.
  }
}

export * from './traits';
