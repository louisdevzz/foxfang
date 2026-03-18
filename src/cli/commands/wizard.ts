/**
 * Wizard Command - Interactive setup wizard
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { intro, outro, text, select, confirm, spinner } from '@clack/prompts';
import { loadConfig, saveConfig } from '../../config/index';
import { initializeProviders } from '../../providers/index';
import { bootstrapFoxFang } from '../../wizard/bootstrap';
import { initDatabase } from '../../database/sqlite';
import { runMigrations } from '../../compat';
// import { testProviderConnection } from '../../providers/test';

export async function registerWizardCommand(program: Command): Promise<void> {
  const wizard = program
    .command('wizard')
    .description('Interactive setup wizard');

  wizard
    .command('setup')
    .description('Run initial setup wizard')
    .action(async () => {
      intro(chalk.cyan('FoxFang Setup Wizard 🦊'));
      
      console.log(chalk.dim('Let\'s configure your FoxFang installation.\n'));
      
      // Bootstrap ~/.foxfang/ directory
      const s = spinner();
      s.start('Creating FoxFang home directory...');
      await bootstrapFoxFang();
      s.stop('FoxFang home directory ready!');
      
      const config = await loadConfig();
      
      // API Keys
      const openaiKey = await text({
        message: 'OpenAI API Key (optional):',
        placeholder: 'sk-...',
        defaultValue: config.providers?.find((p: any) => p.id === 'openai')?.apiKey || '',
      });
      
      const anthropicKey = await text({
        message: 'Anthropic API Key (optional):',
        placeholder: 'sk-ant-...',
        defaultValue: config.providers?.find((p: any) => p.id === 'anthropic')?.apiKey || '',
      });
      
      // Default Provider
      const defaultProvider = await select({
        message: 'Select default provider:',
        options: [
          { value: 'openai', label: 'OpenAI', hint: 'GPT-4, GPT-4o-mini' },
          { value: 'anthropic', label: 'Anthropic', hint: 'Claude 3 Sonnet, Opus, Haiku' },
          { value: 'kimi', label: 'Kimi', hint: 'Kimi Coding API' },
        ],
        initialValue: config.defaultProvider || 'openai',
      });
      
      // Default Model
      const defaultModel = await text({
        message: 'Default model:',
        placeholder: 'gpt-4o',
        defaultValue: config.defaultModel || 'gpt-4o',
      });
      
      // Workspace
      const workspaceDir = await text({
        message: 'Workspace directory:',
        placeholder: '~/.foxfang',
        defaultValue: config.workspace?.homeDir || '~/.foxfang',
      });
      
      // Daemon
      const enableDaemon = await confirm({
        message: 'Enable background daemon?',
        initialValue: true,
      });
      
      // Optional API Keys for enhanced tools
      console.log(chalk.dim('\n💡 Optional: Add API keys for enhanced research tools\n'));
      console.log(chalk.dim('   Press Enter to skip - these are completely optional.\n'));
      
      const braveApiKey = await text({
        message: 'Brave Search API Key (optional - for high-quality search):',
        placeholder: 'BS-...',
        defaultValue: config.braveSearch?.apiKey || '',
      });
      
      const firecrawlApiKey = await text({
        message: 'Firecrawl API Key (optional - for advanced web scraping):',
        placeholder: 'fc-...',
        defaultValue: config.firecrawl?.apiKey || '',
      });
      
      // Channels
      const setupChannels = await confirm({
        message: 'Setup messaging channels (Telegram, Discord)?',
        initialValue: false,
      });
      
      const s2 = spinner();
      s2.start('Saving configuration...');
      
      // Update config
      config.defaultProvider = defaultProvider as string;
      config.defaultModel = defaultModel as string;
      config.workspace = { homeDir: workspaceDir as string };
      config.daemon = { enabled: enableDaemon as boolean, port: 8787, host: '127.0.0.1' };
      
      // Save optional API keys
      if (braveApiKey) {
        config.braveSearch = { apiKey: braveApiKey as string };
      }
      if (firecrawlApiKey) {
        config.firecrawl = { apiKey: firecrawlApiKey as string };
      }
      
      // Update provider API keys
      if (!config.providers) config.providers = [];
      
      const openaiProvider = config.providers.find((p: any) => p.id === 'openai');
      if (openaiProvider) {
        openaiProvider.apiKey = openaiKey as string;
      } else if (openaiKey) {
        config.providers.push({
          id: 'openai',
          name: 'OpenAI',
          apiKey: openaiKey as string,
          enabled: true,
        });
      }
      
      const anthropicProvider = config.providers.find((p: any) => p.id === 'anthropic');
      if (anthropicProvider) {
        anthropicProvider.apiKey = anthropicKey as string;
      } else if (anthropicKey) {
        config.providers.push({
          id: 'anthropic',
          name: 'Anthropic',
          apiKey: anthropicKey as string,
          enabled: true,
        });
      }
      
      await saveConfig(config);
      s2.stop('Configuration saved!');
      
      // Initialize database
      const s3 = spinner();
      s3.start('Initializing database...');
      initDatabase();
      await runMigrations();
      s3.stop('Database ready!');
      
      console.log(chalk.dim('\n💡 Tip: Start chatting and tell FoxFang about your brand/project.'));
      console.log(chalk.dim('   Example: "I need to create a marketing campaign for my coffee shop"'));
      
      if (setupChannels) {
        console.log(chalk.dim('\nTo setup channels, run:'));
        console.log(chalk.yellow('  pnpm foxfang channels setup'));
      }
      
      outro(chalk.green('Setup complete! 🦊\n\nYour FoxFang is ready at ~/.foxfang/\nRun "pnpm foxfang chat" to start.'));
    });

  wizard
    .command('channels')
    .description('Channel setup wizard')
    .action(async () => {
      intro(chalk.cyan('Channel Setup Wizard'));
      
      const channel = await select({
        message: 'Select channel to configure:',
        options: [
          { value: 'telegram', label: 'Telegram', hint: 'Bot API' },
          { value: 'discord', label: 'Discord', hint: 'Bot token' },
          { value: 'slack', label: 'Slack', hint: 'Slack app' },
          { value: 'signal', label: 'Signal', hint: 'Signal CLI' },
        ],
      }) as string;
      
      switch (channel) {
        case 'telegram':
          await setupTelegram();
          break;
        case 'discord':
          await setupDiscord();
          break;
        case 'slack':
          await setupSlack();
          break;
        case 'signal':
          await setupSignal();
          break;
      }
      
      outro(chalk.green(`${channel} configured!`));
    });
}

async function setupTelegram() {
  console.log(chalk.dim('\nTelegram Bot Setup:'));
  console.log('1. Message @BotFather on Telegram');
  console.log('2. Create a new bot with /newbot');
  console.log('3. Copy the API token\n');
  
  const token = await text({
    message: 'Bot API Token:',
    placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    validate: (value) => {
      if (!value || !value.includes(':')) return 'Invalid token format';
    },
  });
  
  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  config.channels.telegram = {
    enabled: true,
    botToken: token as string,
  };
  await saveConfig(config);
}

async function setupDiscord() {
  console.log(chalk.dim('\nDiscord Bot Setup:'));
  console.log('1. Go to https://discord.com/developers/applications');
  console.log('2. Create a new application');
  console.log('3. Go to Bot section and copy the token\n');
  
  const token = await text({
    message: 'Bot Token:',
    validate: (value) => {
      if (!value) return 'Token is required';
    },
  });
  
  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  config.channels.discord = {
    enabled: true,
    botToken: token as string,
  };
  await saveConfig(config);
}

async function setupSlack() {
  console.log(chalk.dim('\nSlack App Setup:'));
  console.log('1. Go to https://api.slack.com/apps');
  console.log('2. Create a new app');
  console.log('3. Add Bot Token Scopes: chat:write, im:history');
  console.log('4. Install app and copy Bot User OAuth Token\n');
  
  const token = await text({
    message: 'Bot User OAuth Token:',
    placeholder: 'xoxb-...',
    validate: (value) => {
      if (!value?.startsWith('xoxb-')) return 'Token should start with xoxb-';
    },
  });
  
  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  config.channels.slack = {
    enabled: true,
    botToken: token as string,
  };
  await saveConfig(config);
}

async function setupSignal() {
  console.log(chalk.dim('\nSignal Setup:'));
  console.log('Signal requires signal-cli to be installed.\n');
  
  const phoneNumber = await text({
    message: 'Phone number (with country code):',
    placeholder: '+1234567890',
  });
  
  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  config.channels.signal = {
    enabled: true,
    phoneNumber: phoneNumber as string,
  };
  await saveConfig(config);
}
