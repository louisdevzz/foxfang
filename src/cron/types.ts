/**
 * Cron Types
 * 
 * Type definitions for the cron scheduling system.
 */

export type CronSchedule =
  | { kind: 'at'; at: string }  // ISO-8601 timestamp for one-shot
  | { kind: 'every'; everyMs: number; anchorMs?: number }  // Interval in ms
  | { kind: 'cron'; expr: string; tz?: string };  // Cron expression

export type CronSessionTarget = 'main' | 'isolated' | 'current' | `session:${string}`;
export type CronWakeMode = 'next-heartbeat' | 'now';
export type CronDeliveryMode = 'none' | 'announce' | 'webhook';

export interface CronDelivery {
  mode: CronDeliveryMode;
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
  failureDestination?: {
    channel?: string;
    to?: string;
    accountId?: string;
    mode?: 'announce' | 'webhook';
  };
}

export type CronRunStatus = 'ok' | 'error' | 'skipped' | 'running';
export type CronDeliveryStatus = 'delivered' | 'not-delivered' | 'unknown' | 'not-requested';

export interface CronFailureAlert {
  after?: number;  // Number of consecutive failures before alerting
  channel?: string;
  to?: string;
  cooldownMs?: number;
  mode?: 'announce' | 'webhook';
  accountId?: string;
}

export type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | { kind: 'agentTurn'; message: string; model?: string; thinking?: string; timeoutSeconds?: number };

export interface CronJobState {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus;
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  lastFailureAlertAtMs?: number;
  scheduleErrorCount?: number;
  lastDeliveryStatus?: CronDeliveryStatus;
  lastDeliveryError?: string;
}

export interface CronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  agentId?: string;
  sessionKey?: string;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  delivery?: CronDelivery;
  failureAlert?: CronFailureAlert | false;
  state: CronJobState;
}

export interface CronJobCreate {
  name: string;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  agentId?: string;
  sessionKey?: string;
  schedule: CronSchedule;
  sessionTarget?: CronSessionTarget;
  wakeMode?: CronWakeMode;
  payload: CronPayload;
  delivery?: CronDelivery;
  failureAlert?: CronFailureAlert | false;
}

export interface CronJobPatch {
  name?: string;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  agentId?: string;
  sessionKey?: string;
  schedule?: CronSchedule;
  sessionTarget?: CronSessionTarget;
  wakeMode?: CronWakeMode;
  payload?: { kind: 'systemEvent'; text: string } | { kind: 'agentTurn'; message: string; model?: string; thinking?: string; timeoutSeconds?: number };
  delivery?: Partial<CronDelivery>;
  failureAlert?: CronFailureAlert | false;
}

export interface CronRunLog {
  id: string;
  jobId: string;
  startedAtMs: number;
  endedAtMs?: number;
  status: CronRunStatus;
  error?: string;
  summary?: string;
  output?: string;
  sessionId?: string;
  deliveryStatus?: CronDeliveryStatus;
  deliveryError?: string;
}

export interface CronStore {
  version: 1;
  jobs: CronJob[];
  runLogs: CronRunLog[];
}
