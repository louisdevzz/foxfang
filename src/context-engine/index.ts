/**
 * Context Engine
 * 
 * Manages conversation context and project-specific knowledge.
 */

import { searchMemories, getProjectMemories } from '../memory/database';
import { queryOne } from '../database/sqlite';

export interface Context {
  userPreferences: Record<string, any>;
  projectContext?: ProjectContext;
  recentMemories: string[];
  sessionHistory: string[];
}

export interface ProjectContext {
  id: string;
  name: string;
  brandProfile: Record<string, any>;
  brandMd: string;
  recentTasks: string[];
  relevantMemories: string[];
}

/**
 * Build context for a conversation
 */
export async function buildContext(options?: { 
  projectId?: string; 
  sessionId?: string;
  query?: string;
}): Promise<Context> {
  const context: Context = {
    userPreferences: await loadUserPreferences(),
    recentMemories: [],
    sessionHistory: []
  };

  // Load project context if specified
  if (options?.projectId) {
    context.projectContext = await loadProjectContext(options.projectId);
  }

  // Search relevant memories
  if (options?.query) {
    const memories = searchMemories(options.query, 5);
    context.recentMemories = memories.map(m => m.content);
  }

  return context;
}

/**
 * Load user preferences
 */
async function loadUserPreferences(): Promise<Record<string, any>> {
  const user = queryOne<{ preferences: string }>(
    `SELECT preferences FROM users WHERE id = 'default_user'`
  );
  
  if (user?.preferences) {
    return JSON.parse(user.preferences);
  }
  
  return {};
}

/**
 * Load project context
 */
async function loadProjectContext(projectId: string): Promise<ProjectContext | undefined> {
  const project = queryOne<{
    id: string;
    name: string;
    brand_profile: string;
    brand_md_content: string;
  }>(
    `SELECT id, name, brand_profile, brand_md_content 
     FROM projects WHERE id = ?`,
    [projectId]
  );

  if (!project) return undefined;

  // Get project memories
  const memories = getProjectMemories(projectId, 10);

  return {
    id: project.id,
    name: project.name,
    brandProfile: project.brand_profile ? JSON.parse(project.brand_profile) : {},
    brandMd: project.brand_md_content || '',
    recentTasks: [], // TODO: Load recent tasks
    relevantMemories: memories.map(m => m.content)
  };
}

/**
 * Format context for LLM prompt
 */
export function formatContextForPrompt(context: Context): string {
  let prompt = '';

  // Add project brand context
  if (context.projectContext) {
    prompt += `\n=== PROJECT: ${context.projectContext.name} ===\n`;
    if (context.projectContext.brandMd) {
      prompt += `Brand Guide:\n${context.projectContext.brandMd}\n\n`;
    }
  }

  // Add relevant memories
  if (context.recentMemories.length > 0) {
    prompt += '=== RELEVANT CONTEXT ===\n';
    context.recentMemories.forEach(m => {
      prompt += `- ${m}\n`;
    });
    prompt += '\n';
  }

  return prompt;
}
