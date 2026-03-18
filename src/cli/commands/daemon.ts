/**
 * Daemon Command - Manage FoxFang Gateway daemon
 * 
 * Similar to OpenClaw's daemon management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createServiceManager, installGatewayService, uninstallGatewayService, getGatewayStatus } from '../../daemon/services';
import { spawn } from 'child_process';
import { join } from 'path';

export async function registerDaemonCommand(program: Command): Promise<void> {
  const daemonCmd = program
    .command('daemon')
    .description('Manage FoxFang Gateway daemon');

  // daemon install
  daemonCmd
    .command('install')
    .description('Install gateway as a system service')
    .option('-p, --port <port>', 'Port to run gateway on', '8787')
    .option('-c, --channels <channels>', 'Comma-separated list of channels to enable')
    .action(async (options) => {
      try {
        console.log(chalk.blue('Installing FoxFang Gateway service...'));
        
        const channels = options.channels ? options.channels.split(',') : [];
        await installGatewayService(parseInt(options.port, 10), channels);
        
        console.log(chalk.green('✓ Gateway service installed successfully'));
        console.log(chalk.dim(`  Port: ${options.port}`));
        console.log(chalk.dim(`  Channels: ${channels.join(', ') || 'none'}`));
        
        if (channels.length > 0) {
          console.log(chalk.yellow('\nNote: Make sure to configure channel credentials:'));
          for (const channel of channels) {
            console.log(chalk.dim(`  foxfang channel setup ${channel}`));
          }
        }
      } catch (error) {
        console.error(chalk.red('Failed to install service:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // daemon uninstall
  daemonCmd
    .command('uninstall')
    .description('Uninstall gateway service')
    .action(async () => {
      try {
        console.log(chalk.blue('Uninstalling FoxFang Gateway service...'));
        await uninstallGatewayService();
        console.log(chalk.green('✓ Gateway service uninstalled'));
      } catch (error) {
        console.error(chalk.red('Failed to uninstall service:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // daemon start
  daemonCmd
    .command('start')
    .description('Start the gateway service')
    .action(async () => {
      try {
        const manager = createServiceManager('foxfang-gateway');
        const running = await manager.isRunning();
        
        if (running) {
          console.log(chalk.yellow('Gateway service is already running'));
          return;
        }
        
        console.log(chalk.blue('Starting gateway service...'));
        await manager.start();
        console.log(chalk.green('✓ Gateway service started'));
      } catch (error) {
        console.error(chalk.red('Failed to start service:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // daemon stop
  daemonCmd
    .command('stop')
    .description('Stop the gateway service')
    .action(async () => {
      try {
        const manager = createServiceManager('foxfang-gateway');
        console.log(chalk.blue('Stopping gateway service...'));
        await manager.stop();
        console.log(chalk.green('✓ Gateway service stopped'));
      } catch (error) {
        console.error(chalk.red('Failed to stop service:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // daemon restart
  daemonCmd
    .command('restart')
    .description('Restart the gateway service')
    .action(async () => {
      try {
        const manager = createServiceManager('foxfang-gateway');
        console.log(chalk.blue('Restarting gateway service...'));
        await manager.restart();
        console.log(chalk.green('✓ Gateway service restarted'));
      } catch (error) {
        console.error(chalk.red('Failed to restart service:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // daemon status
  daemonCmd
    .command('status')
    .description('Check gateway service status')
    .action(async () => {
      try {
        const { running, platform } = await getGatewayStatus();
        
        console.log(chalk.cyan('FoxFang Gateway Status'));
        console.log('');
        
        if (running) {
          console.log(chalk.green('● Running'));
        } else {
          console.log(chalk.red('● Stopped'));
        }
        
        console.log(chalk.dim(`  Platform: ${platform}`));
        console.log(chalk.dim(`  Service: foxfang-gateway`));
      } catch (error) {
        console.log(chalk.red('● Not installed'));
        console.log(chalk.dim(`  Service: foxfang-gateway`));
      }
    });

  // daemon logs
  daemonCmd
    .command('logs')
    .description('View gateway service logs')
    .option('-n, --lines <lines>', 'Number of lines to show', '50')
    .action(async (options) => {
      try {
        const manager = createServiceManager('foxfang-gateway');
        const logs = await manager.logs(parseInt(options.lines, 10));
        console.log(logs);
      } catch (error) {
        console.error(chalk.red('Failed to get logs:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // daemon run - run in foreground (for development or direct execution)
  daemonCmd
    .command('run')
    .description('Run gateway server in foreground (not as service)')
    .option('-p, --port <port>', 'Port to run on', '8787')
    .option('-c, --channels <channels>', 'Comma-separated list of channels (default: all enabled)')
    .option('--all-channels', 'Enable all configured channels')
    .action(async (options) => {
      try {
        const port = parseInt(options.port, 10);
        
        // Load config to get enabled channels
        const { loadConfig } = await import('../../config/index');
        const config = await loadConfig();
        
        let channels: string[] = [];
        
        if (options.channels) {
          // Use explicitly specified channels
          channels = options.channels.split(',').map((c: string) => c.trim());
        } else if (options.allChannels || !options.channels) {
          // Auto-load all enabled channels from config
          if (config.channels) {
            channels = Object.entries(config.channels)
              .filter(([_, cfg]: [string, any]) => cfg.enabled)
              .map(([name, _]) => name);
          }
        }
        
        console.log(chalk.blue('Starting FoxFang Gateway (foreground mode)...'));
        console.log(chalk.dim(`  Port: ${port}`));
        console.log(chalk.dim(`  Channels: ${channels.length > 0 ? channels.join(', ') : 'none'}`));
        
        if (channels.length === 0) {
          console.log(chalk.yellow('\n  Tip: Enable channels with: pnpm foxfang channel setup <signal|telegram|discord|slack>'));
        }
        console.log('');
        
        // Set environment
        process.env.FOXFANG_GATEWAY_PORT = String(port);
        process.env.FOXFANG_CHANNELS = channels.join(',');
        
        // Run the gateway server
        const gatewayPath = join(__dirname, '../../daemon/gateway-server');
        const proc = spawn('node', [gatewayPath], {
          stdio: 'inherit',
          env: process.env,
        });
        
        proc.on('exit', (code) => {
          process.exit(code || 0);
        });
      } catch (error) {
        console.error(chalk.red('Failed to run gateway:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
