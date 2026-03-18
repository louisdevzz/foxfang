/**
 * Task Management Tools
 * 
 * Tools for creating and managing tasks within projects.
 */

import { Tool, ToolCategory } from '../traits';
import { run, queryOne, query } from '../../database/sqlite';
import { randomUUID } from 'crypto';

export class CreateTaskTool implements Tool {
  name = 'create_task';
  description = 'Create a task under a project. Use for breaking down work into actionable items.';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      project_id: { type: 'string', description: 'Project ID this task belongs to' },
      title: { type: 'string', description: 'Task title' },
      description: { type: 'string', description: 'Task description' },
      priority: { type: 'string', description: 'Priority: low, medium, high' },
      due_date: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
      assignee: { type: 'string', description: 'Who should do this: user, content-specialist, strategy-lead, growth-analyst' },
      tags: { type: 'string', description: 'Tags (comma separated)' },
    },
    required: ['project_id', 'title'],
  };

  async execute(args: {
    project_id: string;
    title: string;
    description?: string;
    priority?: string;
    due_date?: string;
    assignee?: string;
    tags?: string;
  }): Promise<{ task_id: string; message: string }> {
    // Verify project exists and get brand
    const project = queryOne<any>(
      `SELECT p.id, p.name, b.id as brand_id 
       FROM projects p
       JOIN brands b ON p.brand_id = b.id
       WHERE p.id = ?`,
      [args.project_id]
    );

    if (!project) {
      return { task_id: '', message: `Project not found: ${args.project_id}` };
    }

    const taskId = randomUUID();
    const tags = args.tags ? args.tags.split(',').map(t => t.trim()) : [];

    run(
      `INSERT INTO tasks (id, project_id, brand_id, title, description, priority, due_date, assignee, tags) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        args.project_id,
        project.brand_id,
        args.title,
        args.description || null,
        args.priority || 'medium',
        args.due_date || null,
        args.assignee || 'user',
        JSON.stringify(tags),
      ]
    );

    return {
      task_id: taskId,
      message: `Created task "${args.title}" in project "${project.name}".`,
    };
  }
}

export class ListTasksTool implements Tool {
  name = 'list_tasks';
  description = 'List tasks for a project or brand';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      project_id: { type: 'string', description: 'Filter by project ID' },
      brand_id: { type: 'string', description: 'Filter by brand ID' },
      status: { type: 'string', description: 'Filter by status: todo, in_progress, review, done' },
    },
    required: [],
  };

  async execute(args: { project_id?: string; brand_id?: string; status?: string }): Promise<any> {
    let sql = `
      SELECT t.id, t.title, t.status, t.priority, t.due_date, t.assignee,
             p.name as project_name, b.name as brand_name
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      JOIN brands b ON t.brand_id = b.id
      WHERE t.user_id = 'default_user'
    `;
    const params: any[] = [];

    if (args.project_id) {
      sql += ` AND t.project_id = ?`;
      params.push(args.project_id);
    }

    if (args.brand_id) {
      sql += ` AND t.brand_id = ?`;
      params.push(args.brand_id);
    }

    if (args.status) {
      sql += ` AND t.status = ?`;
      params.push(args.status);
    }

    sql += ` ORDER BY 
      CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      t.due_date ASC
    `;

    const tasks = query<any>(sql, params);

    return { tasks };
  }
}

export class UpdateTaskStatusTool implements Tool {
  name = 'update_task_status';
  description = 'Update task status';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string', description: 'Task ID' },
      status: { type: 'string', description: 'New status: todo, in_progress, review, done, cancelled' },
    },
    required: ['task_id', 'status'],
  };

  async execute(args: { task_id: string; status: string }): Promise<any> {
    const completedAt = args.status === 'done' ? 'datetime("now")' : null;
    
    run(
      `UPDATE tasks SET status = ?, completed_at = ${completedAt}, updated_at = datetime('now') WHERE id = ?`,
      [args.status, args.task_id]
    );

    return { message: `Task status updated to ${args.status}` };
  }
}

export class GetTaskTool implements Tool {
  name = 'get_task';
  description = 'Get task details';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string', description: 'Task ID' },
    },
    required: ['task_id'],
  };

  async execute(args: { task_id: string }): Promise<any> {
    const task = queryOne<any>(
      `SELECT t.*, p.name as project_name, b.name as brand_name
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       JOIN brands b ON t.brand_id = b.id
       WHERE t.id = ?`,
      [args.task_id]
    );

    if (!task) {
      return { error: 'Task not found' };
    }

    return {
      ...task,
      tags: task.tags ? JSON.parse(task.tags) : [],
    };
  }
}

export class AssignTaskTool implements Tool {
  name = 'assign_task';
  description = 'Assign task to an agent or user';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string', description: 'Task ID' },
      assignee: { type: 'string', description: 'Assign to: user, content-specialist, strategy-lead, growth-analyst' },
    },
    required: ['task_id', 'assignee'],
  };

  async execute(args: { task_id: string; assignee: string }): Promise<any> {
    run(
      `UPDATE tasks SET assignee = ?, updated_at = datetime('now') WHERE id = ?`,
      [args.assignee, args.task_id]
    );

    return { message: `Task assigned to ${args.assignee}` };
  }
}
