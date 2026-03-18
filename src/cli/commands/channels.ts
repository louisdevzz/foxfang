/**
 * Channels Command - Manage messaging channels
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, loadConfigWithCredentials, saveConfig } from '../../config/index';
import { TelegramChannel } from '../../channels/telegram/channel';
import { DiscordChannel } from '../../channels/discord/channel';
import { SlackChannel } from '../../channels/slack/channel';
import { SignalChannel } from '../../channels/signal/channel';
import ora from 'ora';

export async function registerChannelsCommand(program: Command): Promise<void> {
  const channels = program
    .command('channels')
    .description('Manage messaging channels');

  // List channels
  channels
    .command('list')
    .alias('ls')
    .description('List configured channels')
    .action(async () => {
      const config = await loadConfigWithCredentials();
      
      console.log(chalk.cyan('Configured Channels:'));
      console.log();
      
      const availableChannels = ['telegram', 'discord', 'slack', 'signal'];
      
      for (const channelId of availableChannels) {
        const channelConfig = config.channels?.[channelId as keyof typeof config.channels];
        const status = channelConfig && (channelConfig as any).enabled 
          ? chalk.green('● enabled') 
          : chalk.gray('○ disabled');
        console.log(`  ${channelId.padEnd(10)} ${status}`);
      }
      
      console.log();
      console.log(chalk.dim('Use "foxfang channels <name> send" to send messages'));
    });

  // Telegram subcommand
  const telegram = channels
    .command('telegram')
    .description('Telegram channel commands');

  telegram
    .command('send')
    .description('Send a message via Telegram')
    .requiredOption('-c, --chat <id>', 'Chat ID or username')
    .requiredOption('-m, --message <text>', 'Message text')
    .action(async (options) => {
      const config = await loadConfigWithCredentials();
      
      if (!config.channels?.telegram?.enabled) {
        console.log(chalk.red('Telegram is not configured. Run: foxfang wizard channels'));
        process.exit(1);
      }
      
      const channel = new TelegramChannel(config.channels.telegram);
      await channel.initialize();
      
      const spinner = ora('Sending...').start();
      try {
        await channel.sendMessage(options.chat, options.message);
        spinner.succeed('Message sent');
      } catch (error) {
        spinner.fail('Failed to send');
        throw error;
      }
    });

  telegram
    .command('test')
    .description('Test Telegram connection')
    .action(async () => {
      const config = await loadConfigWithCredentials();
      
      if (!config.channels?.telegram?.enabled) {
        console.log(chalk.red('Telegram is not configured'));
        process.exit(1);
      }
      
      const channel = new TelegramChannel(config.channels.telegram);
      await channel.initialize();
      
      const info = await channel.getBotInfo();
      console.log(chalk.green('✓ Connected'));
      console.log(chalk.dim(`  Bot: @${info.username}`));
      console.log(chalk.dim(`  Name: ${info.first_name}`));
    });

  // Discord subcommand
  const discord = channels
    .command('discord')
    .description('Discord channel commands');

  discord
    .command('send')
    .description('Send a message via Discord')
    .requiredOption('-c, --channel <id>', 'Channel ID')
    .requiredOption('-m, --message <text>', 'Message text')
    .action(async (options) => {
      const config = await loadConfigWithCredentials();
      
      if (!config.channels?.discord?.enabled) {
        console.log(chalk.red('Discord is not configured. Run: foxfang wizard channels'));
        process.exit(1);
      }
      
      const channel = new DiscordChannel(config.channels.discord);
      await channel.initialize();
      await channel.sendMessage(options.channel, options.message);
      console.log(chalk.green('✓ Message sent'));
    });

  // Slack subcommand
  const slack = channels
    .command('slack')
    .description('Slack channel commands');

  slack
    .command('send')
    .description('Send a message via Slack')
    .requiredOption('-c, --channel <id>', 'Channel ID')
    .requiredOption('-m, --message <text>', 'Message text')
    .action(async (options) => {
      const config = await loadConfigWithCredentials();
      
      if (!config.channels?.slack?.enabled) {
        console.log(chalk.red('Slack is not configured. Run: foxfang wizard channels'));
        process.exit(1);
      }
      
      const channel = new SlackChannel(config.channels.slack);
      await channel.initialize();
      await channel.sendMessage(options.channel, options.message);
      console.log(chalk.green('✓ Message sent'));
    });

  // Signal subcommand
  const signal = channels
    .command('signal')
    .description('Signal channel commands');

  signal
    .command('send')
    .description('Send a message via Signal')
    .requiredOption('-n, --number <phone>', 'Recipient phone number')
    .requiredOption('-m, --message <text>', 'Message text')
    .action(async (options) => {
      const config = await loadConfigWithCredentials();
      
      if (!config.channels?.signal?.enabled) {
        console.log(chalk.red('Signal is not configured. Run: foxfang wizard channels'));
        process.exit(1);
      }
      
      const channel = new SignalChannel(config.channels.signal);
      await channel.initialize();
      await channel.sendMessage(options.number, options.message);
      console.log(chalk.green('✓ Message sent'));
    });

  // Enable/disable commands
  channels
    .command('enable <channel>')
    .description('Enable a channel')
    .action(async (channelId: string) => {
      const config = await loadConfigWithCredentials();
      if (!config.channels) config.channels = {} as any;
      if (!(config.channels as any)[channelId]) {
        (config.channels as any)[channelId] = {};
      }
      (config.channels as any)[channelId].enabled = true;
      await saveConfig(config);
      console.log(chalk.green(`✓ ${channelId} enabled`));
    });

  channels
    .command('disable <channel>')
    .description('Disable a channel')
    .action(async (channelId: string) => {
      const config = await loadConfigWithCredentials();
      if ((config.channels as any)?.[channelId]) {
        (config.channels as any)[channelId].enabled = false;
        await saveConfig(config);
      }
      console.log(chalk.yellow(`✓ ${channelId} disabled`));
    });
}
