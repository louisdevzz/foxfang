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
  
  signal
    .command('edit')
    .description('Edit a previously sent Signal message (delete + resend)')
    .requiredOption('-n, --number <phone>', 'Recipient phone number')
    .requiredOption('-t, --timestamp <timestamp>', 'Original message timestamp (from send output)')
    .requiredOption('-m, --message <text>', 'New message text')
    .action(async (options) => {
      const config = await loadConfigWithCredentials();
      
      if (!config.channels?.signal?.enabled) {
        console.log(chalk.red('Signal is not configured. Run: foxfang wizard channels'));
        process.exit(1);
      }
      
      const { SignalAdapter } = await import('../../channels/adapters/signal');
      const adapter = new SignalAdapter();
      await adapter.connect();
      
      const spinner = ora('Editing message...').start();
      
      try {
        // Signal edit = delete old + send new with ✏️ prefix
        const success = await adapter.edit(options.timestamp, options.message, options.number);
        
        if (success) {
          spinner.succeed('Message edited (original deleted, new sent with ✏️ prefix)');
        } else {
          spinner.fail('Failed to edit message');
        }
      } catch (error) {
        spinner.fail('Edit failed');
        throw error;
      } finally {
        await adapter.disconnect();
      }
    });
  
  signal
    .command('delete')
    .description('Delete a previously sent Signal message')
    .requiredOption('-n, --number <phone>', 'Recipient phone number')
    .requiredOption('-t, --timestamp <timestamp>', 'Message timestamp to delete')
    .action(async (options) => {
      const config = await loadConfigWithCredentials();
      
      if (!config.channels?.signal?.enabled) {
        console.log(chalk.red('Signal is not configured. Run: foxfang wizard channels'));
        process.exit(1);
      }
      
      const { SignalAdapter } = await import('../../channels/adapters/signal');
      const adapter = new SignalAdapter();
      await adapter.connect();
      
      const spinner = ora('Deleting message...').start();
      
      try {
        const success = await adapter.delete(options.timestamp, options.number);
        
        if (success) {
          spinner.succeed('Message deleted');
        } else {
          spinner.fail('Failed to delete message (may be too old or already read)');
        }
      } catch (error) {
        spinner.fail('Delete failed');
        throw error;
      } finally {
        await adapter.disconnect();
      }
    });
  
  signal
    .command('stream')
    .description('Stream content to Signal with live editing')
    .requiredOption('-n, --number <phone>', 'Recipient phone number')
    .requiredOption('-m, --message <text>', 'Initial message text')
    .option('-u, --update <text>', 'Update the message with new text')
    .option('--finalize', 'Finalize the stream')
    .option('--cancel', 'Cancel and delete the streamed message')
    .action(async (options) => {
      const config = await loadConfigWithCredentials();
      
      if (!config.channels?.signal?.enabled) {
        console.log(chalk.red('Signal is not configured. Run: foxfang wizard channels'));
        process.exit(1);
      }
      
      const { ContentService } = await import('../../content/service');
      const contentService = new ContentService();
      
      const { SignalAdapter } = await import('../../channels/adapters/signal');
      const adapter = new SignalAdapter();
      await adapter.connect();
      contentService.registerChannel(adapter);
      
      try {
        if (options.update) {
          // Update existing stream or send as new edit
          console.log(chalk.cyan('Updating message...'));
          const streamResult = contentService.createStream('signal', options.number);
          if (streamResult) {
            streamResult.stream.update(options.update);
            const messageId = await streamResult.stream.finalize();
            console.log(chalk.green(`✓ Message updated: ${messageId}`));
          }
        } else if (options.finalize) {
          console.log(chalk.yellow('Use --update to send content, or use send command for simple messages'));
        } else if (options.cancel) {
          console.log(chalk.yellow('Stream cancelled'));
        } else {
          // Create new stream
          console.log(chalk.cyan('Creating Signal draft stream...'));
          const streamResult = contentService.createStream('signal', options.number, {
            throttleMs: 2000,
            editPrefix: '✏️ ',
          });
          
          if (streamResult) {
            streamResult.stream.update(options.message);
            const messageId = await streamResult.stream.finalize();
            console.log(chalk.green(`✓ Streamed message sent: ${messageId}`));
          }
        }
      } catch (error) {
        console.error(chalk.red('Stream failed:'), error);
        throw error;
      } finally {
        await adapter.disconnect();
      }
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
