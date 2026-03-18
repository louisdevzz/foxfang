/**
 * Cron Store
 * 
 * Persistence layer for cron jobs and run logs.
 */

import { randomUUID } from 'crypto';
import { query, run } from '../database/sqlite';
import type { CronJob, CronRunLog, CronJobCreate, CronJobPatch } from './types';

// Initialize cron tables
export function initCronTables(): void {
  run(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      delete_after_run INTEGER DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      agent_id TEXT,
      session_key TEXT,
      schedule_kind TEXT NOT NULL,
      schedule_at TEXT,
      schedule_every_ms INTEGER,
      schedule_anchor_ms INTEGER,
      schedule_cron_expr TEXT,
      schedule_cron_tz TEXT,
      session_target TEXT NOT NULL DEFAULT 'isolated',
      wake_mode TEXT NOT NULL DEFAULT 'next-heartbeat',
      payload_kind TEXT NOT NULL,
      payload_text TEXT,
      payload_message TEXT,
      payload_model TEXT,
      payload_thinking TEXT,
      payload_timeout_seconds INTEGER,
      delivery_mode TEXT,
      delivery_channel TEXT,
      delivery_to TEXT,
      delivery_account_id TEXT,
      delivery_best_effort INTEGER,
      failure_alert_after INTEGER,
      failure_alert_channel TEXT,
      failure_alert_to TEXT,
      state_next_run_at_ms INTEGER,
      state_last_run_at_ms INTEGER,
      state_last_run_status TEXT,
      state_last_error TEXT,
      state_consecutive_errors INTEGER DEFAULT 0,
      state_last_failure_alert_at_ms INTEGER
    )
  `);

  // Migration: add all columns if they don't exist (for existing databases)
  // Core columns with defaults
  const coreIntegerColumns: { col: string; defaultVal?: string }[] = [
    { col: 'enabled', defaultVal: '1' },
    { col: 'delete_after_run', defaultVal: '0' },
    { col: 'created_at_ms', defaultVal: String(Date.now()) },
    { col: 'updated_at_ms', defaultVal: String(Date.now()) },
  ];
  const coreTextColumns: { col: string; defaultVal?: string }[] = [
    { col: 'session_target', defaultVal: "'isolated'" },
    { col: 'wake_mode', defaultVal: "'next-heartbeat'" },
    { col: 'payload_kind', defaultVal: "'text'" },
  ];
  
  // State columns
  const stateIntegerColumns = [
    'state_next_run_at_ms',
    'state_last_run_at_ms',
    'state_consecutive_errors',
    'state_last_failure_alert_at_ms',
  ];
  const stateTextColumns = [
    'state_last_run_status',
    'state_last_error',
  ];
  
  // Other optional columns (no defaults)
  const optionalIntegerColumns = [
    'schedule_every_ms',
    'schedule_anchor_ms',
    'payload_timeout_seconds',
    'failure_alert_after',
    'delivery_best_effort',
  ];
  const optionalTextColumns = [
    'description',
    'agent_id',
    'session_key',
    'schedule_at',
    'schedule_cron_expr',
    'schedule_cron_tz',
    'payload_text',
    'payload_message',
    'payload_model',
    'payload_thinking',
    'delivery_mode',
    'delivery_channel',
    'delivery_to',
    'delivery_account_id',
    'failure_alert_channel',
    'failure_alert_to',
  ];
  
  // Helper to add column with optional default
  const addCol = (col: string, type: string, defaultVal?: string) => {
    try {
      const defaultClause = defaultVal ? ` DEFAULT ${defaultVal}` : '';
      run(`ALTER TABLE cron_jobs ADD COLUMN ${col} ${type}${defaultClause}`);
    } catch {
      // Column already exists, ignore error
    }
  };
  
  for (const { col, defaultVal } of coreIntegerColumns) addCol(col, 'INTEGER', defaultVal);
  for (const { col, defaultVal } of coreTextColumns) addCol(col, 'TEXT', defaultVal);
  for (const col of stateIntegerColumns) addCol(col, 'INTEGER');
  for (const col of stateTextColumns) addCol(col, 'TEXT');
  for (const col of optionalIntegerColumns) addCol(col, 'INTEGER');
  for (const col of optionalTextColumns) addCol(col, 'TEXT');

  run(`
    CREATE TABLE IF NOT EXISTS cron_run_logs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
      status TEXT NOT NULL,
      error TEXT,
      summary TEXT,
      output TEXT,
      session_id TEXT,
      delivery_status TEXT,
      delivery_error TEXT,
      FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
    )
  `);

  run(`CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(enabled, state_next_run_at_ms)`);
  run(`CREATE INDEX IF NOT EXISTS idx_cron_run_logs_job ON cron_run_logs(job_id, started_at_ms)`);
}

function rowToCronJob(row: any): CronJob {
  const schedule = (() => {
    switch (row.schedule_kind) {
      case 'at':
        return { kind: 'at' as const, at: row.schedule_at };
      case 'every':
        return {
          kind: 'every' as const,
          everyMs: row.schedule_every_ms,
          anchorMs: row.schedule_anchor_ms,
        };
      case 'cron':
        return {
          kind: 'cron' as const,
          expr: row.schedule_cron_expr,
          tz: row.schedule_cron_tz || undefined,
        };
      default:
        return { kind: 'at' as const, at: new Date().toISOString() };
    }
  })();

  const payload = (() => {
    if (row.payload_kind === 'systemEvent') {
      return { kind: 'systemEvent' as const, text: row.payload_text || '' };
    }
    return {
      kind: 'agentTurn' as const,
      message: row.payload_message || '',
      model: row.payload_model || undefined,
      thinking: row.payload_thinking || undefined,
      timeoutSeconds: row.payload_timeout_seconds || undefined,
    };
  })();

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    deleteAfterRun: Boolean(row.delete_after_run),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    agentId: row.agent_id,
    sessionKey: row.session_key,
    schedule,
    sessionTarget: row.session_target as CronJob['sessionTarget'],
    wakeMode: row.wake_mode as CronJob['wakeMode'],
    payload,
    delivery: row.delivery_mode ? {
      mode: row.delivery_mode,
      channel: row.delivery_channel,
      to: row.delivery_to,
      accountId: row.delivery_account_id,
      bestEffort: Boolean(row.delivery_best_effort),
    } : undefined,
    failureAlert: row.failure_alert_after !== null ? {
      after: row.failure_alert_after,
      channel: row.failure_alert_channel,
      to: row.failure_alert_to,
    } : undefined,
    state: {
      nextRunAtMs: row.state_next_run_at_ms,
      lastRunAtMs: row.state_last_run_at_ms,
      lastRunStatus: row.state_last_run_status,
      lastError: row.state_last_error,
      consecutiveErrors: row.state_consecutive_errors || 0,
      lastFailureAlertAtMs: row.state_last_failure_alert_at_ms,
    },
  };
}

export function createJob(input: CronJobCreate): CronJob {
  const id = randomUUID();
  const now = Date.now();
  
  const job: CronJob = {
    id,
    name: input.name,
    description: input.description,
    enabled: input.enabled ?? true,
    deleteAfterRun: input.deleteAfterRun,
    createdAtMs: now,
    updatedAtMs: now,
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    schedule: input.schedule,
    sessionTarget: input.sessionTarget ?? 'isolated',
    wakeMode: input.wakeMode ?? 'next-heartbeat',
    payload: input.payload,
    delivery: input.delivery,
    failureAlert: input.failureAlert,
    state: {
      nextRunAtMs: undefined,
      consecutiveErrors: 0,
    },
  };

  run(`
    INSERT INTO cron_jobs (
      id, name, description, enabled, delete_after_run,
      created_at_ms, updated_at_ms, agent_id, session_key,
      schedule_kind, schedule_at, schedule_every_ms, schedule_anchor_ms,
      schedule_cron_expr, schedule_cron_tz,
      session_target, wake_mode,
      payload_kind, payload_text, payload_message, payload_model,
      payload_thinking, payload_timeout_seconds,
      delivery_mode, delivery_channel, delivery_to, delivery_account_id,
      delivery_best_effort,
      failure_alert_after, failure_alert_channel, failure_alert_to
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    job.id, job.name, job.description, job.enabled ? 1 : 0, job.deleteAfterRun ? 1 : 0,
    job.createdAtMs, job.updatedAtMs, job.agentId, job.sessionKey,
    job.schedule.kind,
    job.schedule.kind === 'at' ? job.schedule.at : null,
    job.schedule.kind === 'every' ? job.schedule.everyMs : null,
    job.schedule.kind === 'every' ? job.schedule.anchorMs : null,
    job.schedule.kind === 'cron' ? job.schedule.expr : null,
    job.schedule.kind === 'cron' ? job.schedule.tz : null,
    job.sessionTarget, job.wakeMode,
    job.payload.kind,
    job.payload.kind === 'systemEvent' ? job.payload.text : null,
    job.payload.kind === 'agentTurn' ? job.payload.message : null,
    job.payload.kind === 'agentTurn' ? job.payload.model : null,
    job.payload.kind === 'agentTurn' ? job.payload.thinking : null,
    job.payload.kind === 'agentTurn' ? job.payload.timeoutSeconds : null,
    job.delivery?.mode, job.delivery?.channel, job.delivery?.to, job.delivery?.accountId,
    job.delivery?.bestEffort ? 1 : 0,
    job.failureAlert && typeof job.failureAlert === 'object' ? job.failureAlert.after ?? null : null,
    job.failureAlert && typeof job.failureAlert === 'object' ? job.failureAlert.channel : null,
    job.failureAlert && typeof job.failureAlert === 'object' ? job.failureAlert.to : null,
  ]);

  return job;
}

export function updateJob(id: string, patch: CronJobPatch): CronJob | null {
  const existing = getJob(id);
  if (!existing) return null;

  const updates: string[] = ['updated_at_ms = ?'];
  const values: any[] = [Date.now()];

  if (patch.name !== undefined) {
    updates.push('name = ?');
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    updates.push('description = ?');
    values.push(patch.description);
  }
  if (patch.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.deleteAfterRun !== undefined) {
    updates.push('delete_after_run = ?');
    values.push(patch.deleteAfterRun ? 1 : 0);
  }
  if (patch.agentId !== undefined) {
    updates.push('agent_id = ?');
    values.push(patch.agentId);
  }
  if (patch.sessionKey !== undefined) {
    updates.push('session_key = ?');
    values.push(patch.sessionKey);
  }
  if (patch.schedule !== undefined) {
    updates.push('schedule_kind = ?');
    values.push(patch.schedule.kind);
    updates.push('schedule_at = ?');
    values.push(patch.schedule.kind === 'at' ? patch.schedule.at : null);
    updates.push('schedule_every_ms = ?');
    values.push(patch.schedule.kind === 'every' ? patch.schedule.everyMs : null);
    updates.push('schedule_anchor_ms = ?');
    values.push(patch.schedule.kind === 'every' ? patch.schedule.anchorMs : null);
    updates.push('schedule_cron_expr = ?');
    values.push(patch.schedule.kind === 'cron' ? patch.schedule.expr : null);
    updates.push('schedule_cron_tz = ?');
    values.push(patch.schedule.kind === 'cron' ? patch.schedule.tz : null);
  }
  if (patch.sessionTarget !== undefined) {
    updates.push('session_target = ?');
    values.push(patch.sessionTarget);
  }
  if (patch.wakeMode !== undefined) {
    updates.push('wake_mode = ?');
    values.push(patch.wakeMode);
  }
  if (patch.payload !== undefined) {
    updates.push('payload_kind = ?');
    values.push(patch.payload.kind);
    if (patch.payload.kind === 'systemEvent') {
      updates.push('payload_text = ?');
      values.push(patch.payload.text);
    } else {
      updates.push('payload_message = ?');
      values.push(patch.payload.message);
      updates.push('payload_model = ?');
      values.push(patch.payload.model);
      updates.push('payload_thinking = ?');
      values.push(patch.payload.thinking);
      updates.push('payload_timeout_seconds = ?');
      values.push(patch.payload.timeoutSeconds);
    }
  }

  values.push(id);
  run(`UPDATE cron_jobs SET ${updates.join(', ')} WHERE id = ?`, values);

  return getJob(id);
}

export function updateJobState(id: string, state: Partial<CronJob['state']>): void {
  const updates: string[] = [];
  const values: any[] = [];

  if (state.nextRunAtMs !== undefined) {
    updates.push('state_next_run_at_ms = ?');
    values.push(state.nextRunAtMs);
  }
  if (state.lastRunAtMs !== undefined) {
    updates.push('state_last_run_at_ms = ?');
    values.push(state.lastRunAtMs);
  }
  if (state.lastRunStatus !== undefined) {
    updates.push('state_last_run_status = ?');
    values.push(state.lastRunStatus);
  }
  if (state.lastError !== undefined) {
    updates.push('state_last_error = ?');
    values.push(state.lastError);
  }
  if (state.consecutiveErrors !== undefined) {
    updates.push('state_consecutive_errors = ?');
    values.push(state.consecutiveErrors);
  }
  if (state.lastFailureAlertAtMs !== undefined) {
    updates.push('state_last_failure_alert_at_ms = ?');
    values.push(state.lastFailureAlertAtMs);
  }

  if (updates.length > 0) {
    values.push(id);
    run(`UPDATE cron_jobs SET ${updates.join(', ')} WHERE id = ?`, values);
  }
}

export function getJob(id: string): CronJob | null {
  const rows = query<any>('SELECT * FROM cron_jobs WHERE id = ?', [id]);
  return rows.length > 0 ? rowToCronJob(rows[0]) : null;
}

export function listJobs(includeDisabled = false): CronJob[] {
  const sql = includeDisabled
    ? 'SELECT * FROM cron_jobs ORDER BY created_at_ms DESC'
    : 'SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY created_at_ms DESC';
  return query<any>(sql).map(rowToCronJob);
}

export function getPendingJobs(nowMs: number): CronJob[] {
  return query<any>(
    'SELECT * FROM cron_jobs WHERE enabled = 1 AND state_next_run_at_ms <= ?',
    [nowMs]
  ).map(rowToCronJob);
}

export function deleteJob(id: string): boolean {
  const result = run('DELETE FROM cron_jobs WHERE id = ?', [id]);
  return result.changes > 0;
}

// Run logs
export function createRunLog(log: Omit<CronRunLog, 'id'>): CronRunLog {
  const id = randomUUID();
  run(`
    INSERT INTO cron_run_logs (id, job_id, started_at_ms, ended_at_ms, status, error, summary, output, session_id, delivery_status, delivery_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, log.jobId, log.startedAtMs, log.endedAtMs, log.status,
    log.error, log.summary, log.output, log.sessionId,
    log.deliveryStatus, log.deliveryError,
  ]);
  return { ...log, id };
}

export function updateRunLog(id: string, updates: Partial<CronRunLog>): void {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.endedAtMs !== undefined) { fields.push('ended_at_ms = ?'); values.push(updates.endedAtMs); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error); }
  if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
  if (updates.output !== undefined) { fields.push('output = ?'); values.push(updates.output); }
  if (updates.sessionId !== undefined) { fields.push('session_id = ?'); values.push(updates.sessionId); }
  if (updates.deliveryStatus !== undefined) { fields.push('delivery_status = ?'); values.push(updates.deliveryStatus); }
  if (updates.deliveryError !== undefined) { fields.push('delivery_error = ?'); values.push(updates.deliveryError); }

  if (fields.length > 0) {
    values.push(id);
    run(`UPDATE cron_run_logs SET ${fields.join(', ')} WHERE id = ?`, values);
  }
}

export function getRunLogs(jobId: string, limit = 10): CronRunLog[] {
  return query<any>(
    'SELECT * FROM cron_run_logs WHERE job_id = ? ORDER BY started_at_ms DESC LIMIT ?',
    [jobId, limit]
  ).map(row => ({
    id: row.id,
    jobId: row.job_id,
    startedAtMs: row.started_at_ms,
    endedAtMs: row.ended_at_ms,
    status: row.status,
    error: row.error,
    summary: row.summary,
    output: row.output,
    sessionId: row.session_id,
    deliveryStatus: row.delivery_status,
    deliveryError: row.delivery_error,
  }));
}
