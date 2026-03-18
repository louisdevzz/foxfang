/**
 * Pipeline System
 * 
 * Multi-step campaign workflows with approval gates.
 */

import { query, run } from '../database/sqlite';
import { randomUUID } from 'crypto';

export interface PipelineStep {
  id: string;
  name: string;
  agent: string;
  prompt: string;
  requiresApproval: boolean;
  autoApproveThreshold?: number;
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
  trigger: 'manual' | 'schedule' | 'idea';
  schedule?: string; // cron expression
  isActive: boolean;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: 'running' | 'waiting_approval' | 'completed' | 'failed';
  currentStepIndex: number;
  results: StepResult[];
  startedAt: Date;
  completedAt?: Date;
}

export interface StepResult {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  selfReviewScore?: number;
  approved?: boolean;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Create a new pipeline
 */
export function createPipeline(pipeline: Omit<Pipeline, 'id'>): string {
  const id = randomUUID();
  run(
    `INSERT INTO pipelines (id, name, description, steps, trigger, schedule, is_active) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      pipeline.name,
      pipeline.description ?? null,
      JSON.stringify(pipeline.steps),
      pipeline.trigger,
      pipeline.schedule ?? null,
      pipeline.isActive ? 1 : 0
    ]
  );
  return id;
}

/**
 * Get pipeline by ID
 */
export function getPipeline(id: string): Pipeline | null {
  const row = query<{ 
    id: string; 
    name: string; 
    description: string; 
    steps: string;
    trigger: 'manual' | 'schedule' | 'idea';
    schedule: string;
    is_active: number;
  }>(
    `SELECT * FROM pipelines WHERE id = ?`,
    [id]
  )[0];

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: JSON.parse(row.steps),
    trigger: row.trigger,
    schedule: row.schedule,
    isActive: row.is_active === 1
  };
}

/**
 * List all pipelines
 */
export function listPipelines(): Pipeline[] {
  const rows = query<{
    id: string;
    name: string;
    description: string;
    steps: string;
    trigger: 'manual' | 'schedule' | 'idea';
    schedule: string;
    is_active: number;
  }>(`SELECT * FROM pipelines WHERE user_id = 'default_user'`);

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    steps: JSON.parse(row.steps),
    trigger: row.trigger,
    schedule: row.schedule,
    isActive: row.is_active === 1
  }));
}

/**
 * Start a pipeline run
 */
export function startPipelineRun(pipelineId: string): string {
  const id = randomUUID();
  const pipeline = getPipeline(pipelineId);
  
  if (!pipeline) {
    throw new Error(`Pipeline not found: ${pipelineId}`);
  }

  run(
    `INSERT INTO pipeline_runs (id, pipeline_id, status, current_step, results) 
     VALUES (?, ?, 'running', 0, ?)`,
    [id, pipelineId, JSON.stringify([])]
  );

  return id;
}

/**
 * Update step result
 */
export function updateStepResult(
  runId: string,
  stepIndex: number,
  result: StepResult
): void {
  const pipelineRun = getPipelineRun(runId);
  if (!pipelineRun) return;

  pipelineRun.results[stepIndex] = result;
  
  run(
    `UPDATE pipeline_runs 
     SET results = ?, current_step = ?
     WHERE id = ?`,
    [JSON.stringify(pipelineRun.results), stepIndex + 1, runId]
  );
}

/**
 * Get pipeline run
 */
export function getPipelineRun(id: string): PipelineRun | null {
  const row = query<{
    id: string;
    pipeline_id: string;
    status: 'running' | 'waiting_approval' | 'completed' | 'failed';
    current_step: number;
    results: string;
    started_at: string;
    completed_at: string;
  }>(`SELECT * FROM pipeline_runs WHERE id = ?`, [id])[0];

  if (!row) return null;

  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    status: row.status,
    currentStepIndex: row.current_step,
    results: JSON.parse(row.results),
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined
  };
}

// Create tables if not exist
export function initPipelineTables(): void {
  run(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      name TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL,
      trigger TEXT NOT NULL,
      schedule TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_step INTEGER DEFAULT 0,
      results TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
    )
  `);
}
