/**
 * Update runner for FoxFang - handles git-based updates
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { channelToNpmTag, DEFAULT_UPDATE_CHANNEL, DEV_BRANCH, isBetaTag, isStableTag, type UpdateChannel } from './update-channels';

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

type UpdateRunnerOptions = {
  cwd?: string;
  channel?: UpdateChannel;
  timeoutMs?: number;
  noRestart?: boolean;
};

function trimLogTail(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  return `...[truncated]...\n${output.slice(-maxChars)}`;
}

async function runCommand(
  argv: string[],
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const { cwd, timeoutMs, env } = options;
  const command = argv.join(' ');
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    exec(command, { cwd, env }, (error, stdout, stderr) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: error ? error.code || 1 : 0,
      });
    });
  });
}

async function readPackageVersion(root: string): Promise<string | null> {
  try {
    const pkgPath = join(root, 'package.json');
    const content = await readFile(pkgPath, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed.version || null;
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

async function listGitTags(root: string, timeoutMs: number, pattern = 'v*'): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`git tag --list ${pattern} --sort=-v:refname`, { cwd: root, timeout: timeoutMs });
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveChannelTag(root: string, timeoutMs: number, channel: Exclude<UpdateChannel, 'dev'>): Promise<string | null> {
  const tags = await listGitTags(root, timeoutMs);
  
  if (channel === 'beta') {
    const betaTag = tags.find(tag => isBetaTag(tag)) ?? null;
    const stableTag = tags.find(tag => isStableTag(tag)) ?? null;
    
    if (!betaTag) return stableTag;
    if (!stableTag) return betaTag;
    
    // Return the newer version
    return betaTag.localeCompare(stableTag, undefined, { numeric: true }) > 0 ? betaTag : stableTag;
  }
  
  return tags.find(tag => isStableTag(tag)) ?? null;
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
  
  const channel: UpdateChannel = opts.channel ?? DEFAULT_UPDATE_CHANNEL;
  
  // Check if we're in a git repository
  const isGit = await isGitRoot(cwd, timeoutMs);
  
  if (!isGit) {
    return {
      status: 'error',
      mode: 'unknown',
      root: cwd,
      reason: 'not-git-repository',
      steps: [],
      durationMs: Date.now() - startedAt,
    };
  }
  
  // Get current state
  const beforeSha = await getCurrentSha(cwd, timeoutMs);
  const beforeVersion = await readPackageVersion(cwd);
  const currentBranch = await getCurrentBranch(cwd, timeoutMs);
  
  // Check for uncommitted changes
  const hasChanges = await hasUncommittedChanges(cwd, timeoutMs);
  if (hasChanges) {
    return {
      status: 'skipped',
      mode: 'git',
      root: cwd,
      reason: 'uncommitted-changes',
      before: { sha: beforeSha, version: beforeVersion },
      steps: [],
      durationMs: Date.now() - startedAt,
    };
  }
  
  // Determine steps based on channel
  let totalSteps = channel === 'dev' ? 6 : 5;
  let stepIndex = 0;
  
  const runStep = async (name: string, command: string): Promise<UpdateStepResult> => {
    const currentIndex = stepIndex;
    stepIndex += 1;
    
    const started = Date.now();
    try {
      const result = await runCommand(command.split(' '), { cwd, timeoutMs });
      const durationMs = Date.now() - started;
      
      const stepResult: UpdateStepResult = {
        name,
        command,
        cwd,
        durationMs,
        exitCode: result.code,
        stdoutTail: trimLogTail(result.stdout, MAX_LOG_CHARS),
        stderrTail: trimLogTail(result.stderr, MAX_LOG_CHARS),
      };
      
      steps.push(stepResult);
      return stepResult;
    } catch (error) {
      const durationMs = Date.now() - started;
      const stepResult: UpdateStepResult = {
        name,
        command,
        cwd,
        durationMs,
        exitCode: 1,
        stderrTail: error instanceof Error ? error.message : String(error),
      };
      steps.push(stepResult);
      return stepResult;
    }
  };
  
  // Fetch updates
  const fetchStep = await runStep('git fetch', 'git fetch --all --prune --tags');
  if (fetchStep.exitCode !== 0) {
    return {
      status: 'error',
      mode: 'git',
      root: cwd,
      reason: 'fetch-failed',
      before: { sha: beforeSha, version: beforeVersion },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }
  
  // Checkout appropriate branch/tag
  if (channel === 'dev') {
    // For dev channel, checkout and rebase main
    if (currentBranch !== DEV_BRANCH) {
      const checkoutStep = await runStep(`git checkout ${DEV_BRANCH}`, `git checkout ${DEV_BRANCH}`);
      if (checkoutStep.exitCode !== 0) {
        return {
          status: 'error',
          mode: 'git',
          root: cwd,
          reason: 'checkout-failed',
          before: { sha: beforeSha, version: beforeVersion },
          steps,
          durationMs: Date.now() - startedAt,
        };
      }
    }
    
    const rebaseStep = await runStep('git rebase', 'git rebase origin/main');
    if (rebaseStep.exitCode !== 0) {
      // Try to abort rebase on failure
      await runCommand(['git', 'rebase', '--abort'], { cwd, timeoutMs }).catch(() => {});
      return {
        status: 'error',
        mode: 'git',
        root: cwd,
        reason: 'rebase-failed',
        before: { sha: beforeSha, version: beforeVersion },
        steps,
        durationMs: Date.now() - startedAt,
      };
    }
  } else {
    // For stable/beta, checkout the appropriate tag
    const tag = await resolveChannelTag(cwd, timeoutMs, channel);
    if (!tag) {
      return {
        status: 'error',
        mode: 'git',
        root: cwd,
        reason: 'no-tag-found',
        before: { sha: beforeSha, version: beforeVersion },
        steps,
        durationMs: Date.now() - startedAt,
      };
    }
    
    const checkoutStep = await runStep(`git checkout ${tag}`, `git checkout --detach ${tag}`);
    if (checkoutStep.exitCode !== 0) {
      return {
        status: 'error',
        mode: 'git',
        root: cwd,
        reason: 'checkout-failed',
        before: { sha: beforeSha, version: beforeVersion },
        steps,
        durationMs: Date.now() - startedAt,
      };
    }
  }
  
  // Install dependencies
  const installStep = await runStep('pnpm install', 'pnpm install');
  if (installStep.exitCode !== 0) {
    return {
      status: 'error',
      mode: 'git',
      root: cwd,
      reason: 'install-failed',
      before: { sha: beforeSha, version: beforeVersion },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }
  
  // Build
  const buildStep = await runStep('pnpm build', 'pnpm build');
  if (buildStep.exitCode !== 0) {
    return {
      status: 'error',
      mode: 'git',
      root: cwd,
      reason: 'build-failed',
      before: { sha: beforeSha, version: beforeVersion },
      steps,
      durationMs: Date.now() - startedAt,
    };
  }
  
  // Get final state
  const afterSha = await getCurrentSha(cwd, timeoutMs);
  const afterVersion = await readPackageVersion(cwd);
  
  const failedStep = steps.find(s => s.exitCode !== 0);
  
  return {
    status: failedStep ? 'error' : 'ok',
    mode: 'git',
    root: cwd,
    reason: failedStep ? failedStep.name : undefined,
    before: { sha: beforeSha, version: beforeVersion },
    after: { sha: afterSha, version: afterVersion },
    steps,
    durationMs: Date.now() - startedAt,
  };
}
