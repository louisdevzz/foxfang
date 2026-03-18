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
  const { WebSearchTool } = require('./builtin/search');
  const { MemoryStoreTool, MemoryRecallTool } = require('./builtin/memory');
  const { CreateBrandTool, ListBrandsTool, GetBrandTool } = require('./builtin/brand');
  const { CreateProjectTool, ListProjectsTool, GetProjectTool } = require('./builtin/project');
  const { CreateTaskTool, ListTasksTool, GetTaskTool, UpdateTaskStatusTool } = require('./builtin/task');
  
  // Research tools
  toolRegistry.register(new WebSearchTool());
  
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
  
  console.log(`Initialized ${toolRegistry.list().length} tools`);
}

export function wireDelegateOrchestrator(orchestrator: any): void {
  // Wire orchestrator for delegation
}

export * from './traits';
