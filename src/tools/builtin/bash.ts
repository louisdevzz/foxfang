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
let sessionCounter = 0;

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

function cleanupOldSessions(): void {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour
  
  for (const [id, session] of sessions) {
    if (session.status !== 'running' && now - session.startTime > maxAge) {
      sessions.delete(id);
    }
  }
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
      sessions.delete(sessionId);
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
  name = 'bash';
  description = 'Execute a shell command. Supports timeout, working directory, and background execution. Use timeout_ms to limit execution time (default 60s, max 600s). Use background=true to run long commands asynchronously.';
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
      env: {
        type: 'object',
        description: 'Environment variables to set',
      },
    },
    required: ['command'],
  };

  async execute(args: {
    command: string;
    workdir?: string;
    timeout_ms?: number;
    background?: boolean;
    env?: Record<string, string>;
  }): Promise<ToolResult> {
    try {
      if (!args.command?.trim()) {
        return { success: false, error: 'No command provided' };
      }

      // Security check
      if (isDangerousCommand(args.command)) {
        return {
          success: false,
          error: 'Command blocked for security reasons. This command appears dangerous.',
        };
      }

      // Warning for risky commands
      let warning = '';
      if (isRiskyCommand(args.command)) {
        warning = '⚠️ Warning: This command may be destructive or require elevated privileges.\n\n';
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
