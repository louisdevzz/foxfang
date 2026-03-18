/**
 * Wizard Command - Interactive setup wizard
 * 
 * Flow:
 * - User selects provider from list first
 * - Then enters API key for selected provider
 * - Can add multiple providers
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { intro, outro, text, select, confirm, spinner, multiselect, isCancel } from '@clack/prompts';
import { loadConfig, saveConfig } from '../../config/index';
import { initializeProviders } from '../../providers/index';
import { bootstrapFoxFang } from '../../wizard/bootstrap';
import { initDatabase } from '../../database/sqlite';
import { runMigrations } from '../../compat';
import { saveCredential, deleteCredential, isKeychainAvailable, migrateFromConfig } from '../../credentials/index';
import { isGitHubConnected, saveGitHubToken, startGitHubOAuthFlow } from '../../integrations/github';

// Available providers with metadata
const AVAILABLE_PROVIDERS = [
  { 
    id: 'openai', 
    name: 'OpenAI', 
    hint: 'GPT-4, GPT-4o, GPT-3.5',
    apiKeyPlaceholder: 'sk-...',
    apiKeyPrefix: 'sk-',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo']
  },
  { 
    id: 'anthropic', 
    name: 'Anthropic', 
    hint: 'Claude 3.5 Sonnet, Opus, Haiku',
    apiKeyPlaceholder: 'sk-ant-...',
    apiKeyPrefix: 'sk-ant-',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet-latest', 'claude-3-opus-latest', 'claude-3-haiku-latest']
  },
  { 
    id: 'kimi', 
    name: 'Kimi (Moonshot)', 
    hint: 'General purpose LLM - China market',
    apiKeyPlaceholder: 'sk-...',
    apiKeyPrefix: 'sk-',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  },
  { 
    id: 'kimi-coding', 
    name: 'Kimi Coding', 
    hint: 'Coding-specialized API (requires User-Agent header)',
    apiKeyPlaceholder: 'sk-...',
    apiKeyPrefix: 'sk-',
    baseUrl: 'https://api.kimi.com/coding/',
    models: ['kimi-code', 'k2p5'],
    apiType: 'anthropic-messages',
    headers: { 'User-Agent': 'claude-code/0.1.0' }
  },
  { 
    id: 'openrouter', 
    name: 'OpenRouter', 
    hint: 'Access 100+ models via unified API',
    apiKeyPlaceholder: 'sk-or-...',
    apiKeyPrefix: 'sk-or-',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'meta/llama-3.1-405b']
  },
  { 
    id: 'ollama', 
    name: 'Ollama (Local)', 
    hint: 'Run models locally - no API key needed',
    apiKeyPlaceholder: 'not-needed',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.1', 'qwen2.5', 'deepseek-coder']
  },
  { 
    id: 'custom', 
    name: 'Custom/OpenAI-compatible', 
    hint: 'Any OpenAI-compatible API',
    apiKeyPlaceholder: 'your-api-key',
    baseUrl: 'http://localhost:8080/v1',
    models: ['custom-model']
  },
];

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
      
      // ===== PROVIDER SETUP =====
      console.log(chalk.dim('\n📡 AI Provider Setup\n'));
      console.log(chalk.dim('Select the AI providers you want to use.\n'));
      
      const selectedProviderIds = await multiselect({
        message: 'Select providers to configure:',
        options: AVAILABLE_PROVIDERS.map(p => ({
          value: p.id,
          label: p.name,
          hint: p.hint,
        })),
        required: true,
      }) as string[];
      
      if (isCancel(selectedProviderIds) || selectedProviderIds.length === 0) {
        outro(chalk.yellow('Setup cancelled. Please select at least one provider.'));
        return;
      }
      
      // Configure each selected provider
      const configuredProviders: any[] = [];
      
      for (const providerId of selectedProviderIds) {
        const providerMeta = AVAILABLE_PROVIDERS.find(p => p.id === providerId)!;
        
        console.log(chalk.dim(`\n--- ${providerMeta.name} ---`));
        
        // For Ollama, no API key needed
        let apiKey = '';
        if (providerId !== 'ollama') {
          const keyResult = await text({
            message: `${providerMeta.name} API Key:`,
            placeholder: providerMeta.apiKeyPlaceholder,
            validate: (value) => {
              if (!value || value.trim() === '') {
                return 'API key is required (or press Ctrl+C to skip this provider)';
              }
              if (providerMeta.apiKeyPrefix && providerMeta.apiKeyPrefix !== 'not-needed' && 
                  !value.startsWith(providerMeta.apiKeyPrefix)) {
                return `API key should start with "${providerMeta.apiKeyPrefix}"`;
              }
              return undefined;
            },
          });
          
          if (isCancel(keyResult)) {
            console.log(chalk.yellow(`⏭ Skipped ${providerMeta.name}`));
            continue;
          }
          apiKey = keyResult as string;
        } else {
          console.log(chalk.dim('✓ No API key needed for Ollama (local)'));
        }
        
        // Ask for custom base URL (optional) - skip for providers with fixed endpoints
        let baseUrl = providerMeta.baseUrl;
        const skipBaseUrlPrompt = providerId === 'kimi-coding'; // Kimi Coding has fixed endpoint
        
        if (!skipBaseUrlPrompt) {
          const customBaseUrl = await text({
            message: `${providerMeta.name} Base URL (optional):`,
            placeholder: providerMeta.baseUrl,
            defaultValue: providerMeta.baseUrl,
          });
          
          if (!isCancel(customBaseUrl) && customBaseUrl) {
            baseUrl = customBaseUrl as string;
          }
        } else {
          console.log(chalk.dim(`  Using fixed endpoint: ${providerMeta.baseUrl}`));
        }
        
        // Select default model for this provider
        const selectedModel = await select({
          message: `Default model for ${providerMeta.name}:`,
          options: providerMeta.models.map(m => ({ value: m, label: m })),
          initialValue: providerMeta.models[0],
        }) as string;
        
        // Save API key to credentials store (keychain or encrypted file)
        await saveCredential(providerId, {
          provider: providerId,
          apiKey: apiKey as string,
          baseUrl: baseUrl,
          headers: providerId === 'kimi-coding' ? { 'User-Agent': 'claude-code/0.1.0' } : undefined,
          apiType: providerId === 'kimi-coding' ? 'anthropic-messages' : undefined,
          createdAt: new Date().toISOString(),
        });
        
        // Config to save in foxfang.json (no API key)
        const providerConfig: any = {
          id: providerId,
          name: providerMeta.name,
          baseUrl: baseUrl,
          defaultModel: selectedModel,
          enabled: true,
        };
        
        // Add special config for Kimi Coding (headers + apiType)
        if (providerId === 'kimi-coding') {
          providerConfig.headers = { 'User-Agent': 'claude-code/0.1.0' };
          providerConfig.apiType = 'anthropic-messages';
        }
        
        // Show keychain status
        const keychainStatus = isKeychainAvailable() 
          ? 'OS keychain' 
          : 'encrypted file';
        console.log(chalk.dim(`  API key saved to ${keychainStatus}`));
        
        configuredProviders.push(providerConfig);
        
        console.log(chalk.green(`✓ ${providerMeta.name} configured`));
      }
      
      if (configuredProviders.length === 0) {
        outro(chalk.red('No providers configured. Please run setup again.'));
        return;
      }
      
      // Select default provider (only if multiple providers configured)
      let defaultProvider: string;
      let defaultProviderConfig: any;
      
      if (configuredProviders.length === 1) {
        // Auto-select the only provider as default
        defaultProvider = configuredProviders[0].id;
        defaultProviderConfig = configuredProviders[0];
        console.log(chalk.dim(`\nUsing ${defaultProviderConfig.name} as default provider`));
      } else {
        // Ask user to select default when multiple providers
        defaultProvider = await select({
          message: 'Select your default provider:',
          options: configuredProviders.map(p => ({
            value: p.id,
            label: p.name,
            hint: p.defaultModel,
          })),
          initialValue: configuredProviders[0].id,
        }) as string;
        defaultProviderConfig = configuredProviders.find(p => p.id === defaultProvider)!;
      }
      
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
      
      // Check for old API keys in config and offer migration
      const hasOldApiKeys = config.providers?.some((p: any) => p.apiKey) || 
                            config.channels?.telegram?.botToken ||
                            config.channels?.discord?.botToken ||
                            config.channels?.slack?.botToken;
      
      if (hasOldApiKeys) {
        console.log(chalk.yellow('\n⚠️  Security Update: API keys detected in config file'));
        console.log(chalk.dim('   FoxFang now stores API keys securely in OS keychain or encrypted file.\n'));
        
        const shouldMigrate = await confirm({
          message: 'Migrate existing API keys to secure storage?',
          initialValue: true,
        });
        
        if (shouldMigrate) {
          const sMigrate = spinner();
          sMigrate.start('Migrating API keys to secure storage...');
          const migrated = await migrateFromConfig(config);
          await saveConfig(config);
          sMigrate.stop(`Migrated ${migrated.length} API key(s) to secure storage`);
        }
      }
      
      // Optional API Keys for research tools
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
        message: 'Setup messaging channels (Telegram, Discord, Signal, Slack)?',
        initialValue: false,
      });
      
      const s2 = spinner();
      s2.start('Saving configuration...');
      
      // Update config
      config.defaultProvider = defaultProvider;
      config.defaultModel = defaultProviderConfig.defaultModel;
      config.workspace = { homeDir: workspaceDir as string };
      config.daemon = { enabled: enableDaemon as boolean, port: 8787, host: '127.0.0.1' };
      
      // Merge new providers with existing
      if (!config.providers) config.providers = [];
      
      for (const provider of configuredProviders) {
        const existingIndex = config.providers.findIndex((p: any) => p.id === provider.id);
        if (existingIndex >= 0) {
          config.providers[existingIndex] = provider;
        } else {
          config.providers.push(provider);
        }
      }
      
      // Save optional API keys to credentials store
      if (braveApiKey && braveApiKey !== 'BS-...') {
        await saveCredential('brave-search', {
          provider: 'brave-search',
          apiKey: braveApiKey as string,
          createdAt: new Date().toISOString(),
        });
        config.braveSearch = { apiKeyRef: 'credential:brave-search' };
      }
      if (firecrawlApiKey && firecrawlApiKey !== 'fc-...') {
        await saveCredential('firecrawl', {
          provider: 'firecrawl',
          apiKey: firecrawlApiKey as string,
          createdAt: new Date().toISOString(),
        });
        config.firecrawl = { apiKeyRef: 'credential:firecrawl' };
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
      
      // Setup channels immediately if requested
      if (setupChannels) {
        console.log(chalk.dim('\n--- Channel Setup ---\n'));
        await runChannelSetupWizard(config);
      }
      
      // Setup GitHub integration
      console.log(chalk.dim('\n--- GitHub Integration ---\n'));
      const connectGitHub = await confirm({
        message: 'Connect GitHub now? (can be done later via chat)',
        initialValue: false,
      });
      
      if (connectGitHub) {
        const s4 = spinner();
        s4.start('Starting GitHub OAuth flow...');
        
        try {
          const { authUrl, waitForCallback } = await startGitHubOAuthFlow();
          s4.stop('OAuth server ready!');
          
          // Open browser
          const openCommand = process.platform === 'darwin' ? 'open' : 
                             process.platform === 'win32' ? 'start' : 'xdg-open';
          require('child_process').spawn(openCommand, [authUrl], { detached: true, stdio: 'ignore' }).unref();
          
          console.log(chalk.blue('\nBrowser opened for GitHub authorization.'));
          console.log(chalk.dim('If browser does not open, visit: ' + authUrl));
          
          const s5 = spinner();
          s5.start('Waiting for authorization...');
          
          const token = await waitForCallback();
          s5.stop(chalk.green(`✓ GitHub connected as ${token.username || 'unknown'}!`));
          
          // Force event loop to continue
          await new Promise(resolve => setImmediate(resolve));
        } catch (error) {
          s4.stop('GitHub connection failed');
          console.log(chalk.yellow(`⚠ Could not complete GitHub connection: ${error instanceof Error ? error.message : String(error)}`));
          console.log(chalk.dim('You can connect later by saying "Connect GitHub" in chat'));
        }
      } else {
        console.log(chalk.dim('Skipped — say "Connect GitHub" in chat anytime to connect'));
      }
      
      // Print helpful tips after setup
      printSetupTips(configuredProviders.map((p: any) => p.id));
    });

  wizard
    .command('providers')
    .description('Add or update AI providers')
    .action(async () => {
      intro(chalk.cyan('Provider Configuration 🦊'));
      
      const config = await loadConfig();
      
      const action = await select({
        message: 'What would you like to do?',
        options: [
          { value: 'add', label: 'Add new provider' },
          { value: 'edit', label: 'Edit existing provider' },
          { value: 'remove', label: 'Remove provider' },
          { value: 'test', label: 'Test provider connection' },
        ],
      }) as string;
      
      switch (action) {
        case 'add':
          await addProvider(config);
          break;
        case 'edit':
          await editProvider(config);
          break;
        case 'remove':
          await removeProvider(config);
          break;
        case 'test':
          await testProviders(config);
          break;
      }
      
      outro(chalk.green('Done!'));
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

async function addProvider(config: any) {
  // Get existing provider IDs
  const existingIds = config.providers?.map((p: any) => p.id) || [];
  const availableProviders = AVAILABLE_PROVIDERS.filter(p => !existingIds.includes(p.id));
  
  if (availableProviders.length === 0) {
    console.log(chalk.yellow('All available providers are already configured!'));
    return;
  }
  
  const providerId = await select({
    message: 'Select provider to add:',
    options: availableProviders.map(p => ({
      value: p.id,
      label: p.name,
      hint: p.hint,
    })),
  }) as string;
  
  const providerMeta = AVAILABLE_PROVIDERS.find(p => p.id === providerId)!;
  
  let apiKey = '';
  if (providerId !== 'ollama') {
    apiKey = await text({
      message: `${providerMeta.name} API Key:`,
      placeholder: providerMeta.apiKeyPlaceholder,
    }) as string;
  }
  
  // Skip base URL prompt for providers with fixed endpoints
  let baseUrl = providerMeta.baseUrl;
  if (providerId !== 'kimi-coding') {
    const customBaseUrl = await text({
      message: `${providerMeta.name} Base URL (optional):`,
      placeholder: providerMeta.baseUrl,
      defaultValue: providerMeta.baseUrl,
    }) as string;
    if (customBaseUrl) {
      baseUrl = customBaseUrl;
    }
  } else {
    console.log(chalk.dim(`Using fixed endpoint: ${providerMeta.baseUrl}`));
  }
  
  const defaultModel = await select({
    message: `Default model for ${providerMeta.name}:`,
    options: providerMeta.models.map(m => ({ value: m, label: m })),
  }) as string;
  
  // Save API key to credentials store
  await saveCredential(providerId, {
    provider: providerId,
    apiKey: apiKey as string,
    baseUrl: baseUrl,
    headers: providerId === 'kimi-coding' ? { 'User-Agent': 'claude-code/0.1.0' } : undefined,
    apiType: providerId === 'kimi-coding' ? 'anthropic-messages' : undefined,
    createdAt: new Date().toISOString(),
  });
  
  const newProvider: any = {
    id: providerId,
    name: providerMeta.name,
    baseUrl,
    defaultModel,
    enabled: true,
  };
  
  // Add special config for Kimi Coding
  if (providerId === 'kimi-coding') {
    newProvider.headers = { 'User-Agent': 'claude-code/0.1.0' };
    newProvider.apiType = 'anthropic-messages';
  }
  
  if (!config.providers) config.providers = [];
  config.providers.push(newProvider);
  await saveConfig(config);
  
  const keychainStatus = isKeychainAvailable() 
    ? 'OS keychain' 
    : 'encrypted file';
  console.log(chalk.green(`✓ ${providerMeta.name} added!`));
  console.log(chalk.dim(`  API key saved to ${keychainStatus}`));
  if (providerId === 'kimi-coding') {
    console.log(chalk.dim('  Note: User-Agent header auto-configured for Kimi Coding'));
  }
}

async function editProvider(config: any) {
  if (!config.providers?.length) {
    console.log(chalk.yellow('No providers configured. Run "pnpm foxfang wizard providers add"'));
    return;
  }
  
  const providerId = await select({
    message: 'Select provider to edit:',
    options: config.providers.map((p: any) => ({
      value: p.id,
      label: p.name,
    })),
  }) as string;
  
  const provider = config.providers.find((p: any) => p.id === providerId);
  const providerMeta = AVAILABLE_PROVIDERS.find(p => p.id === providerId);
  
  const apiKey = await text({
    message: `${provider.name} API Key:`,
    placeholder: 'sk-...',
    defaultValue: '',
  }) as string;
  
  const baseUrl = await text({
    message: `${provider.name} Base URL:`,
    placeholder: providerMeta?.baseUrl || 'https://api...',
    defaultValue: provider.baseUrl || providerMeta?.baseUrl,
  }) as string;
  
  // Save API key to credentials store
  if (apiKey) {
    await saveCredential(providerId, {
      provider: providerId,
      apiKey: apiKey as string,
      baseUrl: baseUrl,
      headers: providerId === 'kimi-coding' ? { 'User-Agent': 'claude-code/0.1.0' } : undefined,
      apiType: providerId === 'kimi-coding' ? 'anthropic-messages' : undefined,
      createdAt: new Date().toISOString(),
    });
  }
  
  provider.baseUrl = baseUrl;
  
  await saveConfig(config);
  
  const keychainStatus = isKeychainAvailable() 
    ? 'OS keychain' 
    : 'encrypted file';
  console.log(chalk.green(`✓ ${provider.name} updated!`));
  if (apiKey) {
    console.log(chalk.dim(`  API key saved to ${keychainStatus}`));
  }
}

async function removeProvider(config: any) {
  if (!config.providers?.length) {
    console.log(chalk.yellow('No providers to remove'));
    return;
  }
  
  const providerId = await select({
    message: 'Select provider to remove:',
    options: config.providers.map((p: any) => ({
      value: p.id,
      label: p.name,
    })),
  }) as string;
  
  // Remove from config
  config.providers = config.providers.filter((p: any) => p.id !== providerId);
  await saveConfig(config);
  
  // Remove from credentials store
  await deleteCredential(providerId);
  
  console.log(chalk.green('✓ Provider removed'));
}

async function testProviders(config: any) {
  console.log(chalk.dim('\nTesting provider connections...\n'));
  
  // Initialize providers to test connections
  try {
    await initializeProviders(config.providers || []);
    console.log(chalk.green('✓ Providers initialized successfully'));
  } catch (error) {
    console.log(chalk.red('✗ Provider initialization failed:'), error);
  }
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
  
  console.log(chalk.dim('  Token saved to config'));
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
  
  console.log(chalk.dim('  Token saved to config'));
}

async function setupSlack() {
  console.log(chalk.dim('\nSlack App Setup:'));
  console.log('1. Go to https://api.slack.com/apps');
  console.log('2. Create a new app');
  console.log('3. Add Bot Token Scopes: chat:write, im:history');
  console.log('4. Install app and copy Bot User OAuth Token\n');
  
  const botToken = await text({
    message: 'Bot User OAuth Token (xoxb-):',
    placeholder: 'xoxb-...',
    validate: (value) => {
      if (!value?.startsWith('xoxb-')) return 'Token should start with xoxb-';
    },
  });
  
  // Socket Mode requires app-level token
  const appToken = await text({
    message: 'App-Level Token (xapp-):',
    placeholder: 'xapp-...',
    validate: (value) => {
      if (!value?.startsWith('xapp-')) return 'Token should start with xapp-';
    },
  });
  
  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  config.channels.slack = {
    enabled: true,
    botToken: botToken as string,
    appToken: appToken as string,
  };
  await saveConfig(config);
  
  console.log(chalk.dim('  Tokens saved to config'));
}

async function setupSignal() {
  console.log(chalk.dim('\nSignal Setup:'));
  console.log('Signal requires signal-cli to be installed and running.');
  console.log('Docs: https://github.com/AsamK/signal-cli\n');
  
  const phoneNumber = await text({
    message: 'Phone number (with country code):',
    placeholder: '+1234567890',
  });
  
  const httpUrl = await text({
    message: 'Signal CLI HTTP URL:',
    placeholder: 'http://127.0.0.1:8686',
    defaultValue: 'http://127.0.0.1:8686',
  });
  
  const httpUrlStr = (httpUrl as string) || 'http://127.0.0.1:8686';
  
  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  config.channels.signal = {
    enabled: true,
    phoneNumber: phoneNumber as string,
    httpUrl: httpUrlStr,
  };
  await saveConfig(config);
  
  console.log(chalk.dim(`\n✓ Signal configured: ${httpUrlStr}`));
}

/**
 * Run channel setup wizard inline (called during initial setup)
 */
async function runChannelSetupWizard(config: any) {
  const { isCancel } = await import('@clack/prompts');
  
  let continueSetup = true;
  
  while (continueSetup) {
    const channel = await select({
      message: 'Select channel to configure:',
      options: [
        { value: 'telegram', label: 'Telegram', hint: 'Bot API' },
        { value: 'discord', label: 'Discord', hint: 'Bot token' },
        { value: 'slack', label: 'Slack', hint: 'Slack app' },
        { value: 'signal', label: 'Signal', hint: 'Signal CLI' },
        { value: 'done', label: 'Done - Finish channel setup' },
      ],
    }) as string;
    
    if (isCancel(channel) || channel === 'done') {
      break;
    }
    
    try {
      switch (channel) {
        case 'telegram':
          await setupTelegram();
          console.log(chalk.green('\n✓ Telegram configured!'));
          break;
        case 'discord':
          await setupDiscord();
          console.log(chalk.green('\n✓ Discord configured!'));
          break;
        case 'slack':
          await setupSlack();
          console.log(chalk.green('\n✓ Slack configured!'));
          break;
        case 'signal':
          await setupSignal();
          console.log(chalk.green('\n✓ Signal configured!'));
          break;
      }
    } catch (error) {
      console.log(chalk.red(`\n✗ Failed to configure ${channel}:`, error));
    }
    
    // Ask if user wants to setup another channel
    const setupAnother = await confirm({
      message: 'Setup another channel?',
      initialValue: false,
    });
    
    if (!setupAnother) {
      continueSetup = false;
    }
  }
  
  console.log(chalk.dim('\n--- Channel setup complete ---\n'));
}

/**
 * Print helpful tips after setup completion
 */
function printSetupTips(providerIds: string[]) {
  console.log(chalk.cyan('\n╔════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║              🦊 FoxFang Setup Complete!                ║'));
  console.log(chalk.cyan('╚════════════════════════════════════════════════════════╝\n'));
  
  // Quick start commands
  console.log(chalk.bold('📚 Quick Start Commands:\n'));
  console.log(chalk.dim('  Start chatting:'));
  console.log(chalk.green('    pnpm foxfang chat\n'));
  
  console.log(chalk.dim('  Run a single task:'));
  console.log(chalk.green('    pnpm foxfang run "Create a marketing campaign for Q4"\n'));
  
  console.log(chalk.dim('  Check status:'));
  console.log(chalk.green('    pnpm foxfang status\n'));
  
  console.log(chalk.dim('  Start daemon (for channels):'));
  console.log(chalk.green('    pnpm foxfang daemon run\n'));
  
  console.log(chalk.dim('  Install daemon as service:'));
  console.log(chalk.green('    pnpm foxfang daemon install\n'));
  
  // Provider-specific tips
  if (providerIds.length > 0) {
    console.log(chalk.bold('🤖 Your AI Providers:\n'));
    providerIds.forEach(id => {
      const name = AVAILABLE_PROVIDERS.find(p => p.id === id)?.name || id;
      console.log(chalk.dim(`  • ${name} is ready to use`));
    });
    console.log();
  }
  
  // What you can do
  console.log(chalk.bold('✨ What You Can Do:\n'));
  console.log(chalk.dim('  • Create brands and marketing campaigns'));
  console.log(chalk.dim('  • Generate content for social media'));
  console.log(chalk.dim('  • Research competitors and trends'));
  console.log(chalk.dim('  • Schedule and manage tasks'));
  console.log();
  
  // Example prompts
  console.log(chalk.bold('💡 Example Prompts:\n'));
  console.log(chalk.yellow('  "Create a brand for my coffee shop"'));
  console.log(chalk.yellow('  "Write a LinkedIn post about AI trends"'));
  console.log(chalk.yellow('  "Research competitors in the fitness industry"'));
  console.log(chalk.yellow('  "Plan a content calendar for next month"'));
  console.log();
  
  // Help & docs
  console.log(chalk.bold('📖 Need Help?\n'));
  console.log(chalk.dim('  Documentation:'));
  console.log(chalk.blue('    cat ~/.foxfang/AGENT.md\n'));
  console.log(chalk.dim('  Tool capabilities:'));
  console.log(chalk.blue('    cat ~/.foxfang/TOOL.md\n'));
  console.log(chalk.dim('  All commands:'));
  console.log(chalk.green('    pnpm foxfang --help\n'));
  
  console.log(chalk.dim('─'.repeat(60)));
  console.log(chalk.green.bold('  Your FoxFang is ready! 🦊\n'));
}
