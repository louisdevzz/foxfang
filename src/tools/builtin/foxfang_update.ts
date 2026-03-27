/**
 * FoxFang Update Tool
 * 
 * Allows agents to trigger FoxFang updates from git and restart the daemon.
 * This tool can be called via messaging channels (Signal, Telegram, Discord, etc.).
 */

import { Tool, ToolCategory, ToolResult } from '../traits';
import { runUpdate } from '../../infra/update-runner';
import { normalizeUpdateChannel } from '../../infra/update-channels';
import { restartGateway } from '../../daemon/services';

export class FoxFangUpdateTool implements Tool {
  name = 'foxfang_update';
  description = 'Update FoxFang from git and optionally restart the daemon. Use this to pull latest changes, rebuild, and restart the service.';
  category = ToolCategory.UTILITY;
  
  parameters = {
    type: 'object' as const,
    properties: {
      channel: {
        type: 'string',
        description: 'Update channel: dev (main branch), beta (latest beta tag), or stable (latest stable tag)',
      },
      no_restart: {
        type: 'boolean',
        description: 'Skip restarting the daemon after update. Set to true if you want to restart manually.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout for each step in seconds (default: 1200)',
      },
    },
    required: [],
  };

  async execute(args: {
    channel?: string;
    no_restart?: boolean;
    timeout?: number;
  }): Promise<ToolResult> {
    try {
      const channel = normalizeUpdateChannel(args.channel || 'stable');
      const timeoutMs = (args.timeout || 1200) * 1000;
      const noRestart = args.no_restart || false;
      
      // Run the update
      const result = await runUpdate({
        channel,
        timeoutMs,
        noRestart,
      });
      
      // Format the result for the user
      let output = '';
      
      if (result.status === 'ok') {
        output = `Update successful!\n\n`;
        output += `Mode: ${result.mode}\n`;
        output += `Duration: ${(result.durationMs / 1000).toFixed(1)}s\n`;
        
        if (result.before && result.after) {
          if (result.before.version !== result.after.version) {
            output += `Version: ${result.before.version} -> ${result.after.version}\n`;
          }
          if (result.before.sha && result.after.sha && result.before.sha !== result.after.sha) {
            output += `Commit: ${result.before.sha.slice(0, 8)} -> ${result.after.sha.slice(0, 8)}\n`;
          }
        }
        
        // Restart daemon if requested
        if (!noRestart) {
          try {
            await restartGateway();
            output += `\nDaemon restarted successfully`;
          } catch (error) {
            output += `\nFailed to restart daemon: ${error instanceof Error ? error.message : String(error)}`;
            output += `\nRun manually: foxfang daemon restart`;
          }
        }
      } else if (result.status === 'skipped') {
        output = `Update skipped\n\n`;
        output += `Reason: ${result.reason}\n`;
        
        if (result.reason === 'uncommitted-changes') {
          output += `\nPlease commit or stash your changes first:\n`;
          output += `- git commit -am "Save changes"\n`;
          output += `- or git stash\n`;
        }
      } else {
        output = `Update failed\n\n`;
        output += `Reason: ${result.reason}\n\n`;
        
        const failedSteps = result.steps.filter(s => s.exitCode !== 0);
        if (failedSteps.length > 0) {
          output += `Failed steps:\n`;
          for (const step of failedSteps) {
            output += `- ${step.name}\n`;
            if (step.stderrTail) {
              const lines = step.stderrTail.split('\n').slice(0, 3);
              output += `  ${lines.join('\n  ')}\n`;
            }
          }
        }
      }
      
      // Add step summary
      if (result.steps.length > 0) {
        output += `\nSteps executed:\n`;
        for (const step of result.steps) {
          const icon = step.exitCode === 0 ? '[OK]' : '[FAIL]';
          output += `${icon} ${step.name} (${(step.durationMs / 1000).toFixed(1)}s)\n`;
        }
      }
      
      return {
        success: result.status === 'ok',
        output,
        data: {
          status: result.status,
          mode: result.mode,
          reason: result.reason,
          before: result.before,
          after: result.after,
          durationMs: result.durationMs,
          steps: result.steps.map(s => ({
            name: s.name,
            exitCode: s.exitCode,
            durationMs: s.durationMs,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        output: `Update error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export class FoxFangUpdateStatusTool implements Tool {
  name = 'foxfang_update_status';
  description = 'Check the current update status of FoxFang, including git status and daemon status.';
  category = ToolCategory.UTILITY;
  
  parameters = {
    type: 'object' as const,
    properties: {},
    required: [],
  };

  async execute(): Promise<ToolResult> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      let output = 'FoxFang Update Status\n\n';
      
      // Check git status
      try {
        const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD');
        const { stdout: sha } = await execAsync('git rev-parse HEAD');
        const { stdout: remote } = await execAsync('git rev-parse --abbrev-ref --symbolic-full-name @{u}').catch(() => ({ stdout: 'none' }));
        const { stdout: behind } = await execAsync('git rev-list --count HEAD..@{u}').catch(() => ({ stdout: '0' }));
        const { stdout: ahead } = await execAsync('git rev-list --count @{u}..HEAD').catch(() => ({ stdout: '0' }));
        
        output += 'Git Status:\n';
        output += `- Branch: ${branch.trim()}\n`;
        output += `- Commit: ${sha.trim().slice(0, 8)}\n`;
        output += `- Remote: ${remote.trim()}\n`;
        
        const behindCount = parseInt(behind.trim(), 10);
        const aheadCount = parseInt(ahead.trim(), 10);
        
        if (behindCount > 0) {
          output += `- Behind: ${behindCount} commits\n`;
        }
        if (aheadCount > 0) {
          output += `- Ahead: ${aheadCount} commits\n`;
        }
        
        if (behindCount === 0 && aheadCount === 0) {
          output += `- Status: Up to date\n`;
        } else if (behindCount > 0) {
          output += `- Status: Updates available\n`;
        } else {
          output += `- Status: Unpushed changes\n`;
        }
      } catch {
        output += 'Git Status:\n';
        output += `- Not a git repository\n`;
      }
      
      // Check daemon status
      output += '\nDaemon Status:\n';
      try {
        const { getGatewayStatus } = await import('../../daemon/services');
        const { running, platform } = await getGatewayStatus();
        if (running) {
          output += `- Status: Running\n`;
        } else {
          output += `- Status: Stopped\n`;
        }
        output += `- Platform: ${platform}\n`;
      } catch {
        output += `- Status: Not installed\n`;
      }
      
      return {
        success: true,
        output,
        data: {
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        output: `Status check error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
