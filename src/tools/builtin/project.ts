/**
 * Project Management Tools
 * 
 * Tools for creating and managing projects under brands.
 */

import { Tool, ToolCategory } from '../traits';
import { run, queryOne, query } from '../../database/sqlite';
import { randomUUID } from 'crypto';

export class CreateProjectTool implements Tool {
  name = 'create_project';
  description = 'Create a new project under a brand. Use when user wants to start a campaign or initiative.';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      brand_id: { type: 'string', description: 'Brand ID to create project under' },
      name: { type: 'string', description: 'Project name' },
      description: { type: 'string', description: 'Project description' },
      goals: { type: 'string', description: 'Project goals (comma separated)' },
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD), optional' },
    },
    required: ['brand_id', 'name', 'description'],
  };

  async execute(args: {
    brand_id: string;
    name: string;
    description: string;
    goals?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<{ project_id: string; message: string }> {
    // Verify brand exists
    const brand = queryOne<any>(
      `SELECT id, name FROM brands WHERE id = ?`,
      [args.brand_id]
    );

    if (!brand) {
      return { project_id: '', message: `Brand not found: ${args.brand_id}` };
    }

    const projectId = randomUUID();
    
    const goals = args.goals ? args.goals.split(',').map(g => g.trim()) : [];

    run(
      `INSERT INTO projects (id, brand_id, name, description, goals, start_date, end_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        args.brand_id,
        args.name,
        args.description,
        JSON.stringify(goals),
        args.start_date || null,
        args.end_date || null,
      ]
    );

    return {
      project_id: projectId,
      message: `Created project "${args.name}" under brand "${brand.name}". You can now create tasks for this project.`,
    };
  }
}

export class ListProjectsTool implements Tool {
  name = 'list_projects';
  description = 'List projects for a brand';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      brand_id: { type: 'string', description: 'Filter by brand ID (optional)' },
    },
    required: [],
  };

  async execute(args: { brand_id?: string }): Promise<any> {
    let sql = `
      SELECT p.id, p.name, p.description, p.status, b.name as brand_name, b.id as brand_id
      FROM projects p
      JOIN brands b ON p.brand_id = b.id
      WHERE p.user_id = 'default_user'
    `;
    const params: any[] = [];

    if (args.brand_id) {
      sql += ` AND p.brand_id = ?`;
      params.push(args.brand_id);
    }

    sql += ` ORDER BY p.created_at DESC`;

    const projects = query<any>(sql, params);

    return { projects };
  }
}

export class GetProjectTool implements Tool {
  name = 'get_project';
  description = 'Get project details including tasks';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      project_id: { type: 'string', description: 'Project ID' },
    },
    required: ['project_id'],
  };

  async execute(args: { project_id: string }): Promise<any> {
    const project = queryOne<any>(
      `SELECT p.*, b.name as brand_name, b.brand_md_content
       FROM projects p
       JOIN brands b ON p.brand_id = b.id
       WHERE p.id = ?`,
      [args.project_id]
    );

    if (!project) {
      return { error: 'Project not found' };
    }

    // Get tasks
    const tasks = query<any>(
      `SELECT id, title, status, priority, due_date, assignee
       FROM tasks WHERE project_id = ? ORDER BY created_at DESC`,
      [args.project_id]
    );

    return {
      ...project,
      goals: project.goals ? JSON.parse(project.goals) : [],
      tasks,
    };
  }
}

export class UpdateProjectStatusTool implements Tool {
  name = 'update_project_status';
  description = 'Update project status (active, archived, completed)';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      project_id: { type: 'string', description: 'Project ID' },
      status: { type: 'string', description: 'New status: active, archived, completed' },
    },
    required: ['project_id', 'status'],
  };

  async execute(args: { project_id: string; status: string }): Promise<any> {
    run(
      `UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [args.status, args.project_id]
    );

    return { message: `Project status updated to ${args.status}` };
  }
}
