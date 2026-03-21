/**
 * Context Engine
 * 
 * Manages conversation context and project-specific knowledge.
 */

import { queryOne, query } from '../database/sqlite';
import { searchMemories } from '../memory/database';

export interface Context {
  userPreferences: Record<string, any>;
  brandContext?: BrandContext;
  projectContext?: ProjectContext;
  recentMemories: string[];
  sessionHistory: string[];
}

export interface BrandContext {
  id: string;
  name: string;
  description: string;
  industry?: string;
  brandProfile: Record<string, any>;
  brandMd: string;
  relevantMemories: string[];
}

export interface ProjectContext {
  id: string;
  name: string;
  description: string;
  goals: string[];
  brandId: string;
  brandName: string;
  brandMd: string;
  tasks: Array<{ id: string; title: string; status: string }>;
}

/**
 * Build context for a conversation
 */
export async function buildContext(options?: { 
  brandId?: string;
  projectId?: string;
  sessionId?: string;
  query?: string;
}): Promise<Context> {
  const context: Context = {
    userPreferences: await loadUserPreferences(),
    recentMemories: [],
    sessionHistory: []
  };

  // Load brand context
  if (options?.brandId) {
    context.brandContext = await loadBrandContext(options.brandId);
  }

  // Load project context (includes brand)
  if (options?.projectId) {
    context.projectContext = await loadProjectContext(options.projectId);
    // If no brand specified but project has brand, load it
    if (!context.brandContext && context.projectContext) {
      context.brandContext = await loadBrandContext(context.projectContext.brandId);
    }
  }

  // Retrieve top-k relevant memories for this query
  if (options?.query && options.query.trim().length > 2) {
    try {
      const memoryHits = searchMemories(options.query, 4);
      context.recentMemories = memoryHits
        .map((entry) => entry.content)
        .filter(Boolean)
        .slice(0, 4);
    } catch {
      // Keep context build resilient even if FTS query fails.
      context.recentMemories = [];
    }
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
    try {
      return JSON.parse(user.preferences);
    } catch {
      return {};
    }
  }
  
  return {};
}

/**
 * Load brand context from database
 */
async function loadBrandContext(brandId: string): Promise<BrandContext | undefined> {
  const brand = queryOne<{
    id: string;
    name: string;
    description: string;
    industry: string;
    brand_profile: string;
    brand_md_content: string;
  }>(
    `SELECT id, name, description, industry, brand_profile, brand_md_content
     FROM brands WHERE id = ?`,
    [brandId]
  );

  if (!brand) return undefined;

  // Get brand-specific memories
  const memories = query<{ content: string }>(
    `SELECT content FROM memories 
     WHERE brand_id = ? AND user_id = 'default_user'
     ORDER BY importance DESC, created_at DESC
     LIMIT 10`,
    [brandId]
  );

  return {
    id: brand.id,
    name: brand.name,
    description: brand.description,
    industry: brand.industry,
    brandProfile: brand.brand_profile ? JSON.parse(brand.brand_profile) : {},
    brandMd: brand.brand_md_content || '',
    relevantMemories: memories.map(m => m.content),
  };
}

/**
 * Load project context from database
 */
async function loadProjectContext(projectId: string): Promise<ProjectContext | undefined> {
  const project = queryOne<{
    id: string;
    brand_id: string;
    name: string;
    description: string;
    goals: string;
  }>(
    `SELECT id, brand_id, name, description, goals
     FROM projects WHERE id = ?`,
    [projectId]
  );

  if (!project) return undefined;

  // Get brand info
  const brand = queryOne<{ name: string; brand_md_content: string }>(
    `SELECT name, brand_md_content FROM brands WHERE id = ?`,
    [project.brand_id]
  );

  // Get project tasks
  const tasks = query<{ id: string; title: string; status: string }>(
    `SELECT id, title, status FROM tasks 
     WHERE project_id = ? ORDER BY created_at DESC LIMIT 20`,
    [projectId]
  );

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    goals: project.goals ? JSON.parse(project.goals) : [],
    brandId: project.brand_id,
    brandName: brand?.name || 'Unknown',
    brandMd: brand?.brand_md_content || '',
    tasks: tasks || [],
  };
}

/**
 * Get all brands for user
 */
export function getUserBrands(): Array<{ id: string; name: string; description: string }> {
  return query(
    `SELECT id, name, description FROM brands 
     WHERE user_id = 'default_user' AND status = 'active'
     ORDER BY created_at DESC`
  );
}

/**
 * Get projects for a brand
 */
export function getBrandProjects(brandId: string): Array<{ id: string; name: string; status: string }> {
  return query(
    `SELECT id, name, status FROM projects 
     WHERE brand_id = ? ORDER BY created_at DESC`,
    [brandId]
  );
}

/**
 * Format context for LLM prompt
 */
export function formatContextForPrompt(context: Context): string {
  let prompt = '';

  // Add brand context
  if (context.brandContext) {
    prompt += `\n=== BRAND: ${context.brandContext.name} ===\n`;
    prompt += `${context.brandContext.description}\n`;
    if (context.brandContext.industry) {
      prompt += `Industry: ${context.brandContext.industry}\n`;
    }
    if (context.brandContext.brandMd) {
      prompt += `\nBrand Guide:\n${context.brandContext.brandMd}\n`;
    }
  }

  // Add project context
  if (context.projectContext) {
    prompt += `\n=== PROJECT: ${context.projectContext.name} ===\n`;
    prompt += `${context.projectContext.description}\n`;
    if (context.projectContext.goals.length > 0) {
      prompt += `Goals: ${context.projectContext.goals.join(', ')}\n`;
    }
    if (context.projectContext.tasks.length > 0) {
      const activeTasks = context.projectContext.tasks
        .filter(t => t.status !== 'done')
        .slice(0, 5);
      if (activeTasks.length > 0) {
        prompt += `\nActive Tasks:\n`;
        for (const task of activeTasks) {
          prompt += `- [${task.status}] ${task.title}\n`;
        }
      }
    }
  }

  // Add relevant memories
  if (context.brandContext?.relevantMemories && context.brandContext.relevantMemories.length > 0) {
    prompt += '\n=== RELEVANT MEMORIES ===\n';
    for (const memory of context.brandContext.relevantMemories.slice(0, 5)) {
      prompt += `- ${memory}\n`;
    }
  }

  return prompt;
}
