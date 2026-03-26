/**
 * Bash/Shell Execution Tools
 * 
 * Execute shell commands with safety controls, timeouts, and background process support.
 */

import { spawn, SpawnOptionsWithoutStdio } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolCategory, ToolResult } from '../traits';

const DEFAULT_TIMEOUT_MS = 60_000; // 1 minute
const MAX_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_OUTPUT_CHARS = 100_000;
const MAX_CONCURRENT_PROCESSES = 5;

// Dangerous commands that should be blocked
const DANGEROUS_PATTERNS = [
  /^rm\s+-rf\s+\/(?!\w)/, // rm -rf / but not rm -rf /some/path
  />\s*\/dev\/(zero|null|random)\s+of=\/dev\/[sh]da/, // disk overwrite
  /:\(\)\{\s*:\|:\s*&\s*\};:/, // fork bomb
  /mkfs\.[a-z]+\s+\/dev\/[sh]da/, // format disk
  /dd\s+if=.*of=\/dev\/[sh]da/, // dd to disk
  /chmod\s+-R\s+777\s+\//, // chmod root
];

// Commands that require confirmation
const RISKY_COMMANDS = [
  'rm -rf',
  'sudo',
  'chmod 777',
  'mkfs',
  'fdisk',
  'dd if=',
];

const SAFE_COMMAND_PREFIXES = new Set([
  'ls',
  'pwd',
  'cat',
  'head',
  'tail',
  'sed',
  'awk',
  'grep',
  'rg',
  'find',
  'echo',
  'printf',
  'date',
  'wc',
  'stat',
  'file',
  'du',
  'df',
  'ps',
  'env',
  'which',
  'whereis',
  'curl',
  'wget',
  'jq',
  'cut',
  'sort',
  'uniq',
  'tr',
  'dig',
  'nslookup',
  'host',
  'git',
  'mkdir',
]);

const SAFE_GIT_SUBCOMMANDS = new Set([
  'status',
  'log',
  'show',
  'diff',
  'rev-parse',
  'branch',
  'remote',
  'tag',
  'ls-files',
  'grep',
]);

interface BashSession {
  id: string;
  command: string;
  pid: number;
  startTime: number;
  workdir: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  status: 'running' | 'completed' | 'failed' | 'killed';
  kill: () => void;
}

// In-memory session registry
const sessions = new Map<string, BashSession>();
const completionWaiters = new Map<string, Set<() => void>>();
let sessionCounter = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateSessionId(): string {
  return `bash-${Date.now()}-${++sessionCounter}`;
}

function isDangerousCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(normalized));
}

function isRiskyCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return RISKY_COMMANDS.some(risky => normalized.includes(risky.toLowerCase()));
}

function splitShellSegments(command: string): string[] {
  return command
    .split(/(?:\|\||&&|[|;])/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function firstCommandToken(segment: string): string | undefined {
  const rawTokens = segment.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return undefined;

  let idx = 0;
  while (idx < rawTokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(rawTokens[idx])) {
    idx += 1;
  }

  const token = rawTokens[idx] || '';
  if (!token) return undefined;
  return token.toLowerCase();
}

function isSafeReadonlyCommand(command: string): { safe: boolean; reason?: string } {
  const normalized = command.trim();
  if (!normalized) return { safe: false, reason: 'Empty command' };

  // Block redirection/substitution in safe mode to avoid write side-effects.
  if (/[><`]/.test(normalized) || /\$\(.+\)/.test(normalized)) {
    return { safe: false, reason: 'Shell redirection/substitution is not allowed in safe mode' };
  }

  const segments = splitShellSegments(normalized);
  if (segments.length === 0) return { safe: false, reason: 'No executable command segment found' };

  for (const segment of segments) {
    const cmd = firstCommandToken(segment);
    if (!cmd) {
      return { safe: false, reason: `Cannot parse command segment: ${segment}` };
    }

    if (!SAFE_COMMAND_PREFIXES.has(cmd)) {
      return { safe: false, reason: `Command "${cmd}" is not allowed in safe mode` };
    }

    if (cmd === 'git') {
      const tokens = segment.split(/\s+/).filter(Boolean);
      const sub = (tokens[1] || '').toLowerCase();
      if (!SAFE_GIT_SUBCOMMANDS.has(sub)) {
        return { safe: false, reason: `git ${sub || '<missing>'} is not allowed in safe mode` };
      }
    }

    if (cmd === 'mkdir') {
      const mkdirSafety = validateSafeMkdirSegment(segment);
      if (!mkdirSafety.safe) {
        return mkdirSafety;
      }
    }
  }

  return { safe: true };
}

function validateSafeMkdirSegment(segment: string): { safe: boolean; reason?: string } {
  const tokens = segment.split(/\s+/).filter(Boolean);
  // tokens[0] is "mkdir"
  const args = tokens.slice(1);
  if (args.length === 0) {
    return { safe: false, reason: 'mkdir requires at least one path' };
  }

  let hasPath = false;
  for (const arg of args) {
    if (arg.startsWith('-')) {
      if (arg !== '-p' && arg !== '--parents') {
        return { safe: false, reason: `mkdir option "${arg}" is not allowed in safe mode` };
      }
      continue;
    }
    hasPath = true;
  }

  if (!hasPath) {
    return { safe: false, reason: 'mkdir requires at least one destination path' };
  }
  return { safe: true };
}

function cleanupOldSessions(): void {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour
  
  for (const [id, session] of sessions) {
    if (session.status !== 'running' && now - session.startTime > maxAge) {
      sessions.delete(id);
    }
  }
}

function notifyCompletionWaiters(sessionId: string): void {
  const waiters = completionWaiters.get(sessionId);
  if (!waiters) return;
  completionWaiters.delete(sessionId);
  for (const resolve of waiters) {
    resolve();
  }
}

async function waitForCompletion(sessionId: string, timeoutMs: number): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'running') {
    return true;
  }

  const boundedTimeoutMs = Math.max(1, Math.min(timeoutMs, MAX_TIMEOUT_MS));

  return new Promise<boolean>((resolve) => {
    const onComplete = () => {
      clearTimeout(timeoutHandle);
      resolve(true);
    };

    const timeoutHandle = setTimeout(() => {
      const waiters = completionWaiters.get(sessionId);
      waiters?.delete(onComplete);
      if (waiters && waiters.size === 0) {
        completionWaiters.delete(sessionId);
      }
      resolve(false);
    }, boundedTimeoutMs);

    const waiters = completionWaiters.get(sessionId) || new Set<() => void>();
    waiters.add(onComplete);
    completionWaiters.set(sessionId, waiters);
  });
}

async function executeCommand(
  command: string,
  options: {
    workdir?: string;
    timeout?: number;
    env?: Record<string, string>;
    background?: boolean;
  }
): Promise<{ session: BashSession; output?: string }> {
  // Cleanup old sessions periodically
  cleanupOldSessions();
  
  // Check concurrent process limit
  const runningCount = Array.from(sessions.values()).filter(s => s.status === 'running').length;
  if (runningCount >= MAX_CONCURRENT_PROCESSES) {
    throw new Error(`Too many concurrent processes (${MAX_CONCURRENT_PROCESSES}). Wait for some to complete.`);
  }

  const sessionId = generateSessionId();
  const workdir = options.workdir || process.cwd();
  const timeout = Math.min(options.timeout || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  // Spawn the process
  const spawnOptions: SpawnOptionsWithoutStdio = {
    cwd: workdir,
    env: { ...process.env, ...options.env },
    shell: true,
    detached: false,
  };

  const child = spawn(command, [], spawnOptions);
  
  const session: BashSession = {
    id: sessionId,
    command,
    pid: child.pid!,
    startTime: Date.now(),
    workdir,
    stdout: '',
    stderr: '',
    status: 'running',
    kill: () => {
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      } catch {
        // Ignore kill errors
      }
    },
  };

  sessions.set(sessionId, session);

  // Collect output
  let outputBuffer = '';
  let killedByTimeout = false;

  const timeoutHandle = setTimeout(() => {
    killedByTimeout = true;
    session.kill();
  }, timeout);

  child.stdout.on('data', (data: Buffer) => {
    const chunk = data.toString();
    session.stdout += chunk;
    outputBuffer += chunk;
    if (outputBuffer.length > MAX_OUTPUT_CHARS) {
      outputBuffer = outputBuffer.slice(-MAX_OUTPUT_CHARS) + '\n[...output truncated...]';
    }
  });

  child.stderr.on('data', (data: Buffer) => {
    const chunk = data.toString();
    session.stderr += chunk;
    outputBuffer += chunk;
    if (outputBuffer.length > MAX_OUTPUT_CHARS) {
      outputBuffer = outputBuffer.slice(-MAX_OUTPUT_CHARS) + '\n[...output truncated...]';
    }
  });

  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      clearTimeout(timeoutHandle);
      session.status = 'failed';
      notifyCompletionWaiters(sessionId);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);
      session.exitCode = code ?? undefined;
      
      if (killedByTimeout) {
        session.status = 'killed';
        resolve({
          session,
          output: outputBuffer + `\n[Command timed out after ${timeout}ms]`,
        });
      } else if (signal) {
        session.status = 'killed';
        resolve({
          session,
          output: outputBuffer + `\n[Command killed with signal ${signal}]`,
        });
      } else {
        session.status = code === 0 ? 'completed' : 'failed';
        resolve({ session, output: outputBuffer });
      }

      notifyCompletionWaiters(sessionId);
    });

    // If background mode, return immediately with session info
    if (options.background) {
      setTimeout(() => {
        resolve({
          session,
          output: `[Running in background] Session: ${sessionId}\nUse 'bash_poll' or 'bash_log' to check status/output.`,
        });
      }, 100);
    }
  });
}

/**
 * Execute a bash command
 */
export class BashExecTool implements Tool {
  name = 'bash_exec';
  description = 'Execute a shell command. Default mode is safe allowlist (diagnostics + limited ops like mkdir -p). Use mode="full" + confirm=true for broader shell workflows.';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      workdir: {
        type: 'string',
        description: 'Working directory (defaults to current directory)',
      },
      timeout_ms: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 60000, max: 600000)',
      },
      background: {
        type: 'boolean',
        description: 'Run in background and return session ID immediately',
      },
      yield_ms: {
        type: 'number',
        description: 'When set, start command in background, wait this many milliseconds, then return current status/output snapshot',
      },
      confirm: {
        type: 'boolean',
        description: 'Explicit confirmation required for risky commands (rm -rf, sudo, chmod 777, etc.)',
      },
      env: {
        type: 'object',
        description: 'Environment variables to set',
      },
      mode: {
        type: 'string',
        description: 'Execution mode: "safe" (default, allowlist) or "full" (broader command access).',
      },
    },
    required: ['command'],
  };

  async execute(args: {
    command: string;
    workdir?: string;
    timeout_ms?: number;
    background?: boolean;
    yield_ms?: number;
    confirm?: boolean;
    env?: Record<string, string>;
    mode?: 'safe' | 'full' | string;
  }): Promise<ToolResult> {
    try {
      if (!args.command?.trim()) {
        return { success: false, error: 'No command provided' };
      }
      const mode = String(args.mode || 'safe').toLowerCase() === 'full' ? 'full' : 'safe';

      // Security check
      if (isDangerousCommand(args.command)) {
        return {
          success: false,
          error: 'Command blocked for security reasons. This command appears dangerous.',
        };
      }

      if (mode === 'safe') {
        const safeCheck = isSafeReadonlyCommand(args.command);
        if (!safeCheck.safe) {
          return {
            success: false,
            error: `Safe-mode policy blocked command: ${safeCheck.reason}.`,
            data: {
              policy: 'safe',
              command: args.command,
              hint: 'Use safe allowlist commands (curl, rg, cat, ls, mkdir -p, etc.) or set mode="full".',
            },
          };
        }
      }

      // Warning for risky commands
      let warning = '';
      if (mode === 'full' && isRiskyCommand(args.command)) {
        if (args.confirm !== true) {
          return {
            success: false,
            error: 'Approval required: risky command detected. Re-run with `confirm: true` to execute intentionally.',
            data: {
              approvalRequired: true,
              command: args.command,
              hint: 'Use readonly commands first when possible.',
            },
          };
        }
        warning = '⚠️ Warning: This command may be destructive or require elevated privileges.\n\n';
      }

      const requestedYield = Math.floor(Number(args.yield_ms || 0));
      const shouldYield = requestedYield > 0 && !args.background;
      if (shouldYield) {
        const { session } = await executeCommand(args.command, {
          workdir: args.workdir,
          timeout: args.timeout_ms,
          env: args.env,
          background: true,
        });
        const yieldMs = Math.max(100, Math.min(requestedYield, MAX_TIMEOUT_MS));
        await sleep(yieldMs);
        const latest = sessions.get(session.id) || session;
        const combinedOutput = `${latest.stdout || ''}${latest.stderr || ''}`;
        const outputPreview = combinedOutput.length > MAX_OUTPUT_CHARS
          ? `${combinedOutput.slice(-MAX_OUTPUT_CHARS)}\n[...output truncated...]`
          : combinedOutput;
        return {
          success: latest.status === 'completed' || latest.status === 'running',
          output: `${warning}${outputPreview}`.trim(),
          data: {
            session_id: latest.id,
            pid: latest.pid,
            status: latest.status,
            exit_code: latest.exitCode,
            workdir: latest.workdir,
            command: latest.command,
            mode,
            yielded: true,
            yield_ms: yieldMs,
            note: latest.status === 'running'
              ? 'Process still running. Use bash_poll/bash_log for updates.'
              : 'Process completed during yield window.',
          },
        };
      }

      const { session, output } = await executeCommand(args.command, {
        workdir: args.workdir,
        timeout: args.timeout_ms,
        env: args.env,
        background: args.background,
      });

      return {
        success: session.status === 'completed',
        output: warning + (output || ''),
        data: {
          session_id: session.id,
          pid: session.pid,
          status: session.status,
          exit_code: session.exitCode,
          workdir: session.workdir,
          command: session.command,
          mode,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Command execution failed',
      };
    }
  }
}

/**
 * Backward-compatible alias used by older prompts/workspaces.
 */
export class BashLegacyTool extends BashExecTool {
  name = 'bash';
  description = 'Alias of bash_exec (backward compatibility).';
}

/**
 * List running bash sessions
 */
export class BashListTool implements Tool {
  name = 'bash_list';
  description = 'List all bash sessions (running and completed)';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status: running, completed, failed, killed, or all (default: all)',
      },
    },
    required: [],
  };

  async execute(args: { status?: string }): Promise<ToolResult> {
    try {
      const filterStatus = args.status?.toLowerCase();
      const allSessions = Array.from(sessions.values());
      
      const filtered = filterStatus && filterStatus !== 'all'
        ? allSessions.filter(s => s.status === filterStatus)
        : allSessions;

      const summary = filtered.map(s => ({
        id: s.id,
        command: s.command.slice(0, 80),
        status: s.status,
        pid: s.pid,
        exit_code: s.exitCode,
        runtime_ms: Date.now() - s.startTime,
      }));

      return {
        success: true,
        output: summary.length > 0
          ? `Found ${summary.length} session(s):\n` + JSON.stringify(summary, null, 2)
          : 'No sessions found.',
        data: { sessions: summary },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list sessions',
      };
    }
  }
}

/**
 * Get output/logs from a bash session
 */
export class BashLogTool implements Tool {
  name = 'bash_log';
  description = 'Get output/logs from a bash session by ID';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID',
      },
      tail: {
        type: 'number',
        description: 'Only show last N lines (default: all)',
      },
    },
    required: ['session_id'],
  };

  async execute(args: { session_id: string; tail?: number }): Promise<ToolResult> {
    try {
      const session = sessions.get(args.session_id);
      if (!session) {
        return {
          success: false,
          error: `Session ${args.session_id} not found`,
        };
      }

      let output = session.stdout;
      if (session.stderr) {
        output += '\n[stderr]:\n' + session.stderr;
      }

      // Apply tail filter if specified
      if (args.tail && args.tail > 0) {
        const lines = output.split('\n');
        if (lines.length > args.tail) {
          output = '[...truncated...]\n' + lines.slice(-args.tail).join('\n');
        }
      }

      return {
        success: true,
        output: output || '(no output)',
        data: {
          session_id: session.id,
          status: session.status,
          exit_code: session.exitCode,
          command: session.command,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get logs',
      };
    }
  }
}

/**
 * Poll/check status of a bash session
 */
export class BashPollTool implements Tool {
  name = 'bash_poll';
  description = 'Check the status of a running or completed bash session';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID',
      },
      timeout_ms: {
        type: 'number',
        description: 'Optional blocking timeout in milliseconds (max: 600000). If provided and session is running, waits until completion or timeout.',
        maximum: 600000,
      },
    },
    required: ['session_id'],
  };

  async execute(args: { session_id: string; timeout_ms?: number }): Promise<ToolResult> {
    try {
      let session = sessions.get(args.session_id);
      if (!session) {
        return {
          success: false,
          error: `Session ${args.session_id} not found`,
        };
      }

      if (session.status === 'running' && args.timeout_ms !== undefined) {
        const requestedTimeout = Math.floor(Number(args.timeout_ms));
        if (Number.isFinite(requestedTimeout) && requestedTimeout > 0) {
          await waitForCompletion(session.id, requestedTimeout);
        }
        session = sessions.get(args.session_id) || session;
      }

      const runtime = Date.now() - session.startTime;
      const isComplete = session.status !== 'running';

      return {
        success: isComplete,
        output: isComplete
          ? `Session ${args.session_id} completed with status: ${session.status}, exit code: ${session.exitCode}`
          : `Session ${args.session_id} still running (PID: ${session.pid}, runtime: ${Math.round(runtime / 1000)}s)`,
        data: {
          session_id: session.id,
          status: session.status,
          exit_code: session.exitCode,
          pid: session.pid,
          runtime_ms: runtime,
          command: session.command,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to poll session',
      };
    }
  }
}

/**
 * Kill a running bash session
 */
export class BashKillTool implements Tool {
  name = 'bash_kill';
  description = 'Kill a running bash session';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID',
      },
    },
    required: ['session_id'],
  };

  async execute(args: { session_id: string }): Promise<ToolResult> {
    try {
      const session = sessions.get(args.session_id);
      if (!session) {
        return {
          success: false,
          error: `Session ${args.session_id} not found`,
        };
      }

      if (session.status !== 'running') {
        return {
          success: false,
          error: `Session ${args.session_id} is not running (status: ${session.status})`,
        };
      }

      session.kill();
      session.status = 'killed';

      return {
        success: true,
        output: `Session ${args.session_id} (PID: ${session.pid}) has been terminated.`,
        data: {
          session_id: session.id,
          pid: session.pid,
          status: session.status,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to kill session',
      };
    }
  }
}

/**
 * Remove/cleanup a bash session from registry
 */
export class BashRemoveTool implements Tool {
  name = 'bash_remove';
  description = 'Remove a bash session from the registry (frees memory)';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID',
      },
    },
    required: ['session_id'],
  };

  async execute(args: { session_id: string }): Promise<ToolResult> {
    try {
      const session = sessions.get(args.session_id);
      if (!session) {
        return {
          success: false,
          error: `Session ${args.session_id} not found`,
        };
      }

      // Kill if still running
      if (session.status === 'running') {
        session.kill();
      }

      sessions.delete(args.session_id);

      return {
        success: true,
        output: `Session ${args.session_id} has been removed from registry.`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove session',
      };
    }
  }
}
