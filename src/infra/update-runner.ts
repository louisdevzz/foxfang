/**
 * Update runner for FoxFang - pulls latest from main branch
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { UPDATE_BRANCH, UPDATE_REMOTE } from './update-channels';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const MAX_LOG_CHARS = 8000;

export type UpdateStepResult = {
  name: string;
  command: string;
  cwd: string;
  durationMs: number;
  exitCode: number | null;
  stdoutTail?: string | null;
  stderrTail?: string | null;
};

export type UpdateRunResult = {
  status: 'ok' | 'error' | 'skipped';
  mode: 'git' | 'unknown';
  root?: string;
  reason?: string;
  before?: { sha?: string | null; version?: string | null };
  after?: { sha?: string | null; version?: string | null };
  steps: UpdateStepResult[];
  durationMs: number;
};

export type UpdateRunnerOptions = {
  cwd?: string;
  timeoutMs?: number;
  channel?: string;
  noRestart?: boolean;
};

function trimLogTail(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  return `...[truncated]...\n${output.slice(-maxChars)}`;
}

async function runCommand(
  command: string,
  options: { cwd: string; timeoutMs: number }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const { cwd, timeoutMs } = options;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ stdout: '', stderr: `Command timed out after ${timeoutMs}ms`, code: 1 });
    }, timeoutMs);

    exec(command, { cwd }, (error, stdout, stderr) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: error ? (error.code || 1) : 0,
      });
    });
  });
}

async function readPackageVersion(root: string): Promise<string | null> {
  try {
    const content = await readFile(join(root, 'package.json'), 'utf-8');
    return JSON.parse(content).version || null;
  } catch {
    return null;
  }
}

async function getCurrentSha(root: string, timeoutMs: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: root, timeout: timeoutMs });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getCurrentBranch(root: string, timeoutMs: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: root, timeout: timeoutMs });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function isGitRoot(cwd: string, timeoutMs: number): Promise<boolean> {
  try {
    await execAsync('git rev-parse --show-toplevel', { cwd, timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function hasUncommittedChanges(root: string, timeoutMs: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git status --porcelain', { cwd: root, timeout: timeoutMs });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function runUpdate(opts: UpdateRunnerOptions = {}): Promise<UpdateRunResult> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const steps: UpdateStepResult[] = [];
  const cwd = opts.cwd || process.cwd();

  if (!(await isGitRoot(cwd, timeoutMs))) {
    return { status: 'error', mode: 'unknown', root: cwd, reason: 'not-git-repository', steps, durationMs: Date.now() - startedAt };
  }

  const beforeSha = await getCurrentSha(cwd, timeoutMs);
  const beforeVersion = await readPackageVersion(cwd);
  const currentBranch = await getCurrentBranch(cwd, timeoutMs);

  if (await hasUncommittedChanges(cwd, timeoutMs)) {
    return { status: 'skipped', mode: 'git', root: cwd, reason: 'uncommitted-changes', before: { sha: beforeSha, version: beforeVersion }, steps, durationMs: Date.now() - startedAt };
  }

  const runStep = async (name: string, command: string): Promise<UpdateStepResult> => {
    const started = Date.now();
    const result = await runCommand(command, { cwd, timeoutMs });
    const stepResult: UpdateStepResult = {
      name, command, cwd,
      durationMs: Date.now() - started,
      exitCode: result.code,
      stdoutTail: trimLogTail(result.stdout, MAX_LOG_CHARS),
      stderrTail: trimLogTail(result.stderr, MAX_LOG_CHARS),
    };
    steps.push(stepResult);
    return stepResult;
  };

  const fail = (reason: string): UpdateRunResult => ({
    status: 'error', mode: 'git', root: cwd, reason,
    before: { sha: beforeSha, version: beforeVersion },
    steps, durationMs: Date.now() - startedAt,
  });

  // Fetch latest
  const fetchStep = await runStep('git fetch', `git fetch ${UPDATE_REMOTE}`);
  if (fetchStep.exitCode !== 0) return fail('fetch-failed');

  // Switch to main if needed
  if (currentBranch !== UPDATE_BRANCH) {
    const checkoutStep = await runStep(`git checkout ${UPDATE_BRANCH}`, `git checkout ${UPDATE_BRANCH}`);
    if (checkoutStep.exitCode !== 0) return fail('checkout-failed');
  }

  // Pull latest
  const pullStep = await runStep('git pull', `git pull ${UPDATE_REMOTE} ${UPDATE_BRANCH}`);
  if (pullStep.exitCode !== 0) return fail('pull-failed');

  // Install dependencies
  const installStep = await runStep('pnpm install', 'pnpm install');
  if (installStep.exitCode !== 0) return fail('install-failed');

  // Build
  const buildStep = await runStep('pnpm build', 'pnpm build');
  if (buildStep.exitCode !== 0) return fail('build-failed');

  const afterSha = await getCurrentSha(cwd, timeoutMs);
  const afterVersion = await readPackageVersion(cwd);

  return {
    status: 'ok', mode: 'git', root: cwd,
    before: { sha: beforeSha, version: beforeVersion },
    after: { sha: afterSha, version: afterVersion },
    steps, durationMs: Date.now() - startedAt,
  };
}
