/**
 * Cron Scheduler
 * 
 * Schedule recurring tasks and campaigns.
 */

import { query, run } from '../database/sqlite';
import { randomUUID } from 'crypto';

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
  runCount: number;
  failCount: number;
}

/**
 * Create a new cron job
 */
export function createCronJob(name: string, schedule: string, command: string): string {
  const id = randomUUID();
  run(
    `INSERT INTO cron_jobs (id, name, schedule, command, next_run_at) 
     VALUES (?, ?, ?, ?, datetime('now', '+1 minute'))`,
    [id, name, schedule, command]
  );
  return id;
}

/**
 * List all cron jobs
 */
export function listCronJobs(): CronJob[] {
  return query<CronJob>(`SELECT * FROM cron_jobs WHERE user_id = 'default_user'`);
}

/**
 * Toggle job enabled/disabled
 */
export function toggleCronJob(id: string, enabled: boolean): void {
  run(`UPDATE cron_jobs SET enabled = ? WHERE id = ?`, [enabled ? 1 : 0, id]);
}

/**
 * Delete a cron job
 */
export function deleteCronJob(id: string): void {
  run(`DELETE FROM cron_jobs WHERE id = ?`, [id]);
}

/**
 * Get jobs that should run now
 */
export function getPendingJobs(): CronJob[] {
  return query<CronJob>(
    `SELECT * FROM cron_jobs 
     WHERE enabled = 1 AND next_run_at <= datetime('now')`
  );
}

/**
 * Mark job as executed
 */
export function markJobExecuted(id: string, success: boolean): void {
  run(
    `UPDATE cron_jobs 
     SET last_run_at = datetime('now'),
         next_run_at = datetime('now', '+1 hour'),
         run_count = run_count + 1,
         fail_count = fail_count + ?
     WHERE id = ?`,
    [success ? 0 : 1, id]
  );
}
