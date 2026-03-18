/**
 * Tools Index
 */

import { Tool, ToolSpec } from './traits';

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

// Tool initialization
export function initializeTools(config: Record<string, any>): void {
  // Register built-in tools
  const { WebSearchTool } = require('./builtin/web_search');
  const { FetchTweetTool, FetchUserTweetsTool } = require('./builtin/tweet_fetcher');
  const { FetchUrlTool } = require('./builtin/fetch_url');
  const { FirecrawlSearchTool, FirecrawlScrapeTool } = require('./builtin/firecrawl');
  const { BraveSearchTool } = require('./builtin/brave_search');
  const { MemoryStoreTool, MemoryRecallTool } = require('./builtin/memory');
  const { CreateBrandTool, ListBrandsTool, GetBrandTool } = require('./builtin/brand');
  const { CreateProjectTool, ListProjectsTool, GetProjectTool } = require('./builtin/project');
  const { CreateTaskTool, ListTasksTool, GetTaskTool, UpdateTaskStatusTool } = require('./builtin/task');
  const { BashExecTool, BashListTool, BashLogTool, BashPollTool, BashKillTool, BashRemoveTool } = require('./builtin/bash');
  const { CronTool } = require('./builtin/cron');
  const { GitHubConnectTool, GitHubCreateIssueTool, GitHubCreatePRTool, GitHubListIssuesTool, GitHubListPRsTool } = require('./builtin/github');
  
  // Research tools
  toolRegistry.register(new WebSearchTool());
  toolRegistry.register(new FetchTweetTool());
  toolRegistry.register(new FetchUserTweetsTool());
  toolRegistry.register(new FetchUrlTool());
  toolRegistry.register(new FirecrawlSearchTool());
  toolRegistry.register(new FirecrawlScrapeTool());
  toolRegistry.register(new BraveSearchTool());
  
  // Memory tools
  toolRegistry.register(new MemoryStoreTool());
  toolRegistry.register(new MemoryRecallTool());
  
  // Brand management tools
  toolRegistry.register(new CreateBrandTool());
  toolRegistry.register(new ListBrandsTool());
  toolRegistry.register(new GetBrandTool());
  
  // Project management tools
  toolRegistry.register(new CreateProjectTool());
  toolRegistry.register(new ListProjectsTool());
  toolRegistry.register(new GetProjectTool());
  
  // Task management tools
  toolRegistry.register(new CreateTaskTool());
  toolRegistry.register(new ListTasksTool());
  toolRegistry.register(new GetTaskTool());
  toolRegistry.register(new UpdateTaskStatusTool());
  
  // Bash/Shell execution tools
  toolRegistry.register(new BashExecTool());
  toolRegistry.register(new BashListTool());
  toolRegistry.register(new BashLogTool());
  toolRegistry.register(new BashPollTool());
  toolRegistry.register(new BashKillTool());
  toolRegistry.register(new BashRemoveTool());
  
  // Cron scheduler tool
  toolRegistry.register(new CronTool());
  
  // GitHub tools
  toolRegistry.register(new GitHubConnectTool());
  toolRegistry.register(new GitHubCreateIssueTool());
  toolRegistry.register(new GitHubCreatePRTool());
  toolRegistry.register(new GitHubListIssuesTool());
  toolRegistry.register(new GitHubListPRsTool());
  
  console.log(`Initialized ${toolRegistry.list().length} tools`);
}

export function wireDelegateOrchestrator(orchestrator: any): void {
  // Wire orchestrator for delegation
}

export * from './traits';
