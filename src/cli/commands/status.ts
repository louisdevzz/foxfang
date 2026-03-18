/**
 * Status Command - Show system status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfigWithCredentials } from '../../config/index';
import { getProviderStatuses } from '../../providers/index';
import { getDaemonStatus } from '../../daemon/status';

export async function registerStatusCommand(program: Command): Promise<void> {
  program
    .command('status')
    .description('Show system status')
    .action(async () => {
      console.log(chalk.cyan('╔════════════════════════════════════════╗'));
      console.log(chalk.cyan('║         FoxFang Status             ║'));
      console.log(chalk.cyan('╚════════════════════════════════════════╝'));
      console.log();
      
      // Version info
      const { getVersion } = await import('../version');
      const version = await getVersion();
      console.log(chalk.dim(`Version: ${version}`));
      console.log();
      
      // Daemon status
      const daemonStatus = await getDaemonStatus();
      console.log(chalk.cyan('Daemon:'));
      if (daemonStatus.running) {
        console.log(`  ${chalk.green('● Running')}`);
        console.log(chalk.dim(`    PID: ${daemonStatus.pid}`));
        console.log(chalk.dim(`    Uptime: ${daemonStatus.uptime}`));
        console.log(chalk.dim(`    API: ${daemonStatus.apiUrl}`));
      } else {
        console.log(`  ${chalk.red('● Stopped')}`);
      }
      console.log();
      
      // Providers status
      console.log(chalk.cyan('Providers:'));
      const providers = await getProviderStatuses();
      for (const provider of providers) {
        const status = provider.healthy 
          ? chalk.green('● healthy') 
          : chalk.red('● error');
        console.log(`  ${provider.name.padEnd(12)} ${status}`);
        if (!provider.healthy && provider.error) {
          console.log(chalk.dim(`    Error: ${provider.error}`));
        }
      }
      console.log();
      
      // Channels status
      const config = await loadConfigWithCredentials();
      console.log(chalk.cyan('Channels:'));
      const channels = ['telegram', 'discord', 'slack', 'signal'];
      for (const channelId of channels) {
        const channel = (config.channels as any)?.[channelId];
        const status = channel?.enabled 
          ? chalk.green('● enabled') 
          : chalk.gray('○ disabled');
        console.log(`  ${channelId.padEnd(12)} ${status}`);
      }
      console.log();
      
      // Config summary
      console.log(chalk.cyan('Configuration:'));
      console.log(chalk.dim(`  Default provider: ${config.defaultProvider || 'not set'}`));
      console.log(chalk.dim(`  Default model: ${config.defaultModel || 'not set'}`));
      console.log(chalk.dim(`  Workspace: ${config.workspace?.homeDir || '~/.foxfang'}`));
      console.log();
    });
}
