/**
 * Update Command - Update FoxFang and restart daemon
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { runUpdate, type UpdateRunResult } from '../../infra/update-runner';
import { normalizeUpdateChannel, type UpdateChannel } from '../../infra/update-channels';
import { restartGateway } from '../../daemon/services';

export async function registerUpdateCommand(program: Command): Promise<void> {
  const updateCmd = program
    .command('update')
    .description('Update FoxFang from git and restart daemon');

  // update (main command)
  updateCmd
    .option('-c, --channel <channel>', 'Update channel (stable, beta, dev)', 'dev')
    .option('--no-restart', 'Skip restarting the daemon after update')
    .option('--timeout <seconds>', 'Timeout for each step in seconds', '1200')
    .action(async (options) => {
      try {
        const channel = normalizeUpdateChannel(options.channel);
        const timeoutMs = parseInt(options.timeout, 10) * 1000;
        
        console.log(chalk.blue('Updating FoxFang...'));
        console.log(chalk.dim(`  Channel: ${channel}`));
        console.log(chalk.dim(`  Timeout: ${options.timeout}s`));
        console.log('');
        
        const result = await runUpdate({
          channel,
          timeoutMs,
          noRestart: options.noRestart,
        });
        
        // Display results
        console.log('');
        console.log(chalk.cyan('Update Summary'));
        console.log('');
        
        if (result.status === 'ok') {
          console.log(chalk.green('✓ Update successful'));
          console.log(chalk.dim(`  Mode: ${result.mode}`));
          console.log(chalk.dim(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`));
          
          if (result.before && result.after) {
            console.log('');
            console.log(chalk.dim('Version change:'));
            if (result.before.version !== result.after.version) {
              console.log(chalk.dim(`  ${result.before.version} → ${result.after.version}`));
            }
            if (result.before.sha && result.after.sha && result.before.sha !== result.after.sha) {
              console.log(chalk.dim(`  ${result.before.sha.slice(0, 8)} → ${result.after.sha.slice(0, 8)}`));
            }
          }
          
          // Restart daemon if requested
          if (!options.noRestart) {
            console.log('');
            console.log(chalk.blue('Restarting daemon...'));
            try {
              await restartGateway();
              console.log(chalk.green('✓ Daemon restarted'));
            } catch (error) {
              console.log(chalk.yellow('⚠ Failed to restart daemon:'), error instanceof Error ? error.message : String(error));
              console.log(chalk.dim('  Run: pnpm foxfang daemon restart'));
            }
          }
        } else if (result.status === 'skipped') {
          console.log(chalk.yellow('⚠ Update skipped'));
          console.log(chalk.dim(`  Reason: ${result.reason}`));
          
          if (result.reason === 'uncommitted-changes') {
            console.log('');
            console.log(chalk.dim('Please commit or stash your changes first:'));
            console.log(chalk.dim('  git commit -am "Save changes"'));
            console.log(chalk.dim('  or'));
            console.log(chalk.dim('  git stash'));
          }
        } else {
          console.log(chalk.red('✗ Update failed'));
          console.log(chalk.dim(`  Reason: ${result.reason}`));
          console.log('');
          console.log(chalk.dim('Failed steps:'));
          const failedSteps = result.steps.filter(s => s.exitCode !== 0);
          for (const step of failedSteps) {
            console.log(chalk.red(`  ✗ ${step.name}`));
            if (step.stderrTail) {
              console.log(chalk.dim(`    ${step.stderrTail.split('\n').slice(0, 3).join('\n    ')}`));
            }
          }
        }
        
        console.log('');
        if (result.steps.length > 0) {
          console.log(chalk.dim('Steps executed:'));
          for (const step of result.steps) {
            const icon = step.exitCode === 0 ? chalk.green('✓') : chalk.red('✗');
            console.log(chalk.dim(`  ${icon} ${step.name} (${(step.durationMs / 1000).toFixed(1)}s)`));
          }
        }
        
        process.exit(result.status === 'ok' ? 0 : 1);
      } catch (error) {
        console.error(chalk.red('Update error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // update status
  updateCmd
    .command('status')
    .description('Check update status')
    .action(async () => {
      try {
        console.log(chalk.cyan('FoxFang Update Status'));
        console.log('');
        
        // Check git status
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        try {
          const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD');
          const { stdout: sha } = await execAsync('git rev-parse HEAD');
          const { stdout: remote } = await execAsync('git rev-parse --abbrev-ref --symbolic-full-name @{u}').catch(() => ({ stdout: 'none' }));
          const { stdout: behind } = await execAsync('git rev-list --count HEAD..@{u}').catch(() => ({ stdout: '0' }));
          const { stdout: ahead } = await execAsync('git rev-list --count @{u}..HEAD').catch(() => ({ stdout: '0' }));
          
          console.log(chalk.dim('Git Status:'));
          console.log(chalk.dim(`  Branch: ${branch.trim()}`));
          console.log(chalk.dim(`  Commit: ${sha.trim().slice(0, 8)}`));
          console.log(chalk.dim(`  Remote: ${remote.trim()}`));
          
          const behindCount = parseInt(behind.trim(), 10);
          const aheadCount = parseInt(ahead.trim(), 10);
          
          if (behindCount > 0) {
            console.log(chalk.yellow(`  Behind: ${behindCount} commits`));
          }
          if (aheadCount > 0) {
            console.log(chalk.yellow(`  Ahead: ${aheadCount} commits`));
          }
          
          if (behindCount === 0 && aheadCount === 0) {
            console.log(chalk.green('  Up to date'));
          }
        } catch {
          console.log(chalk.red('  Not a git repository'));
        }
        
        // Check daemon status
        console.log('');
        console.log(chalk.dim('Daemon Status:'));
        try {
          const { getGatewayStatus } = await import('../../daemon/services');
          const { running, platform } = await getGatewayStatus();
          if (running) {
            console.log(chalk.green('  Running'));
          } else {
            console.log(chalk.red('  Stopped'));
          }
          console.log(chalk.dim(`  Platform: ${platform}`));
        } catch {
          console.log(chalk.yellow('  Not installed'));
        }
      } catch (error) {
        console.error(chalk.red('Status error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
