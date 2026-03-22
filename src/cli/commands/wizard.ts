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
import { agentRegistry, hydrateAgentRegistryFromConfig } from '../../agents/registry';
import { loginWithDeviceCode } from '../../providers/github-copilot';

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
    id: 'github-copilot',
    name: 'GitHub Copilot',
    hint: 'Use your GitHub Copilot subscription (device code login)',
    apiKeyPlaceholder: '',
    baseUrl: '',
    models: ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4.6', 'o1', 'o3-mini'],
    authFlow: 'device-code' as const,
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

type SetupTarget = 'all' | 'providers' | 'channels';
type BindingSessionScope = 'from' | 'chat' | 'thread' | 'chat-thread';
type BindingChatType = 'private' | 'group' | 'channel';
type AgentSelectOption = { value: string; label: string; hint?: string };

function normalizeSetupTarget(target?: string): SetupTarget | null {
  const normalized = (target || 'all').trim().toLowerCase();

  if (normalized === 'all') return 'all';
  if (normalized === 'providers' || normalized === 'provider') return 'providers';
  if (normalized === 'channels' || normalized === 'channel') return 'channels';
  return null;
}

function resolveChannelGroupActivation(
  config: any,
  channelId: 'telegram' | 'discord' | 'slack' | 'signal'
): 'mention' | 'always' {
  const channelConfig = config?.channels?.[channelId];
  const channelActivation = String(channelConfig?.groupActivation || '').trim().toLowerCase();
  if (channelActivation === 'mention') return 'mention';
  if (channelActivation === 'always') return 'always';
  if (typeof channelConfig?.requireMentionInGroups === 'boolean') {
    return channelConfig.requireMentionInGroups ? 'mention' : 'always';
  }

  // Backward-compatible fallback from legacy global config
  const globalActivation = String(config?.autoReply?.groupActivation || '').trim().toLowerCase();
  if (globalActivation === 'mention') return 'mention';
  if (globalActivation === 'always') return 'always';
  if (typeof config?.autoReply?.requireMentionInGroups === 'boolean') {
    return config.autoReply.requireMentionInGroups ? 'mention' : 'always';
  }
  return 'always';
}

function ensureAutoReplyConfig(config: any): void {
  if (!config.autoReply || typeof config.autoReply !== 'object') {
    config.autoReply = {};
  }
  if (!Array.isArray(config.autoReply.bindings)) {
    config.autoReply.bindings = [];
  }
}

async function buildAgentSelectOptions(config: any): Promise<AgentSelectOption[]> {
  try {
    await hydrateAgentRegistryFromConfig();
  } catch {
    // Keep setup resilient even if agent hydration fails.
  }

  const ids = new Set<string>();
  ids.add('orchestrator');
  for (const agent of agentRegistry.list()) {
    if (agent.id) ids.add(agent.id);
  }

  const configuredAgents = Array.isArray(config?.agents) ? config.agents : [];
  for (const candidate of configuredAgents) {
    const id = String(candidate?.id || '').trim();
    if (id) ids.add(id);
  }

  const bindings = Array.isArray(config?.autoReply?.bindings) ? config.autoReply.bindings : [];
  for (const binding of bindings) {
    const id = String(binding?.agentId || '').trim();
    if (id) ids.add(id);
  }

  const options: AgentSelectOption[] = Array.from(ids).map((id) => {
    const meta = agentRegistry.get(id);
    const hint = meta?.description ? meta.description.slice(0, 72) : undefined;
    return {
      value: id,
      label: id,
      ...(hint ? { hint } : {}),
    };
  });

  options.sort((a, b) => {
    if (a.value === 'orchestrator') return -1;
    if (b.value === 'orchestrator') return 1;
    return a.value.localeCompare(b.value);
  });
  return options;
}

function asCsv(value?: string | string[]): string {
  if (!value) return '';
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

function parseCsv(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toSingleOrArray(items: string[]): string | string[] | undefined {
  if (items.length === 0) return undefined;
  if (items.length === 1) return items[0];
  return items;
}

function serializeMetadata(metadata?: Record<string, string | string[]>): string {
  if (!metadata || Object.keys(metadata).length === 0) return '';
  return Object.entries(metadata)
    .map(([key, value]) => `${key}=${asCsv(value)}`)
    .join('; ');
}

function parseMetadata(input: string): Record<string, string | string[]> | undefined {
  const result: Record<string, string | string[]> = {};
  const chunks = String(input || '')
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    const index = chunk.indexOf('=');
    if (index <= 0) continue;
    const key = chunk.slice(0, index).trim();
    const rawValue = chunk.slice(index + 1).trim();
    if (!key || !rawValue) continue;
    const list = parseCsv(rawValue);
    if (list.length === 0) continue;
    result[key] = list.length === 1 ? list[0] : list;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function formatBindingLabel(binding: any, index: number): string {
  const id = String(binding?.id || `binding-${index + 1}`);
  const channel = binding?.channel || '*';
  const agent = binding?.agentId || 'orchestrator';
  const scope = binding?.sessionScope || 'chat-thread';
  const status = binding?.enabled === false ? 'off' : 'on';
  return `${id} [${status}] ${channel} -> ${agent} (${scope})`;
}

function printBindings(bindings: any[]): void {
  if (bindings.length === 0) {
    console.log(chalk.dim('No auto-reply bindings configured.'));
    return;
  }
  console.log(chalk.cyan('\nCurrent auto-reply bindings:\n'));
  bindings.forEach((binding, index) => {
    console.log(`${index + 1}. ${formatBindingLabel(binding, index)}`);
    if (binding.chatType) console.log(chalk.dim(`   chatType=${binding.chatType}`));
    if (binding.chatId) console.log(chalk.dim(`   chatId=${asCsv(binding.chatId)}`));
    if (binding.threadId) console.log(chalk.dim(`   threadId=${asCsv(binding.threadId)}`));
    if (binding.fromId) console.log(chalk.dim(`   fromId=${asCsv(binding.fromId)}`));
    if (binding.accountId) console.log(chalk.dim(`   accountId=${asCsv(binding.accountId)}`));
    if (binding.priority !== undefined) console.log(chalk.dim(`   priority=${binding.priority}`));
    if (binding.metadata && Object.keys(binding.metadata).length > 0) {
      console.log(chalk.dim(`   metadata=${serializeMetadata(binding.metadata)}`));
    }
  });
  console.log('');
}

async function promptBindingInput(existing: any | undefined, agentOptions: AgentSelectOption[]): Promise<any | null> {
  const idInput = await text({
    message: 'Binding ID (optional, for easier management):',
    placeholder: 'discord-growth-thread',
    defaultValue: String(existing?.id || ''),
  });
  if (isCancel(idInput)) return null;

  const enabled = await confirm({
    message: 'Enable this binding?',
    initialValue: existing?.enabled !== false,
  });
  if (isCancel(enabled)) return null;

  const currentAgent = String(existing?.agentId || 'orchestrator').trim() || 'orchestrator';
  const resolvedAgentOptions = agentOptions.some((option) => option.value === currentAgent)
    ? agentOptions
    : [
      ...agentOptions,
      { value: currentAgent, label: currentAgent },
    ];

  const agentId = await select({
    message: 'Target agent:',
    options: resolvedAgentOptions,
    initialValue: currentAgent,
  }) as string;
  if (isCancel(agentId)) return null;

  const channel = await select({
    message: 'Channel filter:',
    options: [
      { value: '', label: 'Any channel (*)' },
      { value: 'telegram', label: 'telegram' },
      { value: 'discord', label: 'discord' },
      { value: 'slack', label: 'slack' },
      { value: 'signal', label: 'signal' },
    ],
    initialValue: String(existing?.channel || ''),
  }) as string;
  if (isCancel(channel)) return null;

  const chatType = await select({
    message: 'Chat type filter:',
    options: [
      { value: '', label: 'Any chat type (*)' },
      { value: 'private', label: 'private' },
      { value: 'group', label: 'group' },
      { value: 'channel', label: 'channel' },
    ],
    initialValue: String(existing?.chatType || ''),
  }) as string;
  if (isCancel(chatType)) return null;

  const sessionScope = await select({
    message: 'Session scope for this binding:',
    options: [
      { value: 'chat-thread', label: 'chat-thread' },
      { value: 'chat', label: 'chat' },
      { value: 'thread', label: 'thread' },
      { value: 'from', label: 'from' },
    ],
    initialValue: String(existing?.sessionScope || 'chat-thread'),
  }) as BindingSessionScope;
  if (isCancel(sessionScope)) return null;

  const priorityInput = await text({
    message: 'Priority (higher wins):',
    placeholder: '0',
    defaultValue: String(existing?.priority ?? 0),
    validate: (value) => {
      const parsed = Number(String(value || '').trim());
      if (!Number.isFinite(parsed)) return 'Please enter a number';
      return undefined;
    },
  });
  if (isCancel(priorityInput)) return null;

  const chatIdInput = await text({
    message: 'chatId filter (comma separated, empty for any):',
    placeholder: '1234567890, 9876543210',
    defaultValue: asCsv(existing?.chatId),
  });
  if (isCancel(chatIdInput)) return null;

  const threadIdInput = await text({
    message: 'threadId filter (comma separated, empty for any):',
    placeholder: 'thread-1,thread-2',
    defaultValue: asCsv(existing?.threadId),
  });
  if (isCancel(threadIdInput)) return null;

  const fromIdInput = await text({
    message: 'fromId filter (comma separated, empty for any):',
    placeholder: 'user-id-1,user-id-2',
    defaultValue: asCsv(existing?.fromId),
  });
  if (isCancel(fromIdInput)) return null;

  const accountIdInput = await text({
    message: 'accountId filter (comma separated, empty for any):',
    placeholder: 'bot-id-or-phone',
    defaultValue: asCsv(existing?.accountId),
  });
  if (isCancel(accountIdInput)) return null;

  const metadataInput = await text({
    message: 'metadata filter (k=v1,v2; k2=v3) optional:',
    placeholder: 'guildId=123; channelId=456,789',
    defaultValue: serializeMetadata(existing?.metadata),
  });
  if (isCancel(metadataInput)) return null;

  const chatIds = parseCsv(chatIdInput as string);
  const threadIds = parseCsv(threadIdInput as string);
  const fromIds = parseCsv(fromIdInput as string);
  const accountIds = parseCsv(accountIdInput as string);

  const binding: any = {
    enabled: enabled === true,
    priority: Number(priorityInput),
    agentId,
    sessionScope,
  };

  const cleanId = String(idInput || '').trim();
  if (cleanId) binding.id = cleanId;
  if (channel) binding.channel = channel;
  if (chatType) binding.chatType = chatType as BindingChatType;
  const chatIdValue = toSingleOrArray(chatIds);
  if (chatIdValue !== undefined) binding.chatId = chatIdValue;
  const threadIdValue = toSingleOrArray(threadIds);
  if (threadIdValue !== undefined) binding.threadId = threadIdValue;
  const fromIdValue = toSingleOrArray(fromIds);
  if (fromIdValue !== undefined) binding.fromId = fromIdValue;
  const accountIdValue = toSingleOrArray(accountIds);
  if (accountIdValue !== undefined) binding.accountId = accountIdValue;
  const metadata = parseMetadata(metadataInput as string);
  if (metadata) binding.metadata = metadata;

  return binding;
}

async function runBindingsWizard() {
  intro(chalk.cyan('Auto-Reply Bindings Wizard'));
  const config = await loadConfig();
  ensureAutoReplyConfig(config);
  const autoReply = config.autoReply as NonNullable<typeof config.autoReply>;
  let agentOptions = await buildAgentSelectOptions(config);

  while (true) {
    const bindings = autoReply.bindings as any[];
    printBindings(bindings);

    const action = await select({
      message: 'Bindings action:',
      options: [
        { value: 'add', label: 'Add binding' },
        { value: 'edit', label: 'Edit binding' },
        { value: 'remove', label: 'Remove binding' },
        { value: 'clear', label: 'Clear all bindings' },
        { value: 'done', label: 'Done' },
      ],
    }) as string;

    if (isCancel(action) || action === 'done') break;

    if (action === 'add') {
      const next = await promptBindingInput(undefined, agentOptions);
      if (next) {
        bindings.push(next);
        await saveConfig(config);
        agentOptions = await buildAgentSelectOptions(config);
        console.log(chalk.green('✓ Binding added'));
      }
      continue;
    }

    if (action === 'edit') {
      if (bindings.length === 0) {
        console.log(chalk.yellow('No bindings to edit.'));
        continue;
      }
      const targetIndex = await select({
        message: 'Select binding to edit:',
        options: bindings.map((binding, index) => ({
          value: String(index),
          label: formatBindingLabel(binding, index),
        })),
      }) as string;
      if (isCancel(targetIndex)) continue;
      const index = Number(targetIndex);
      const next = await promptBindingInput(bindings[index], agentOptions);
      if (next) {
        bindings[index] = next;
        await saveConfig(config);
        agentOptions = await buildAgentSelectOptions(config);
        console.log(chalk.green('✓ Binding updated'));
      }
      continue;
    }

    if (action === 'remove') {
      if (bindings.length === 0) {
        console.log(chalk.yellow('No bindings to remove.'));
        continue;
      }
      const targetIndex = await select({
        message: 'Select binding to remove:',
        options: bindings.map((binding, index) => ({
          value: String(index),
          label: formatBindingLabel(binding, index),
        })),
      }) as string;
      if (isCancel(targetIndex)) continue;
      const index = Number(targetIndex);
      const target = bindings[index];
      const confirmed = await confirm({
        message: `Remove binding "${formatBindingLabel(target, index)}"?`,
        initialValue: false,
      });
      if (isCancel(confirmed) || confirmed !== true) continue;
      bindings.splice(index, 1);
      await saveConfig(config);
      agentOptions = await buildAgentSelectOptions(config);
      console.log(chalk.green('✓ Binding removed'));
      continue;
    }

    if (action === 'clear') {
      if (bindings.length === 0) {
        console.log(chalk.yellow('Bindings are already empty.'));
        continue;
      }
      const confirmed = await confirm({
        message: 'Remove all bindings?',
        initialValue: false,
      });
      if (isCancel(confirmed) || confirmed !== true) continue;
      autoReply.bindings = [];
      await saveConfig(config);
      agentOptions = await buildAgentSelectOptions(config);
      console.log(chalk.green('✓ All bindings removed'));
      continue;
    }
  }

  outro(chalk.green('Bindings wizard complete.'));
}

async function configureChannelGroupReplyMode(
  config: any,
  channelId: 'telegram' | 'discord' | 'slack' | 'signal',
  channelLabel: string
): Promise<'mention' | 'always'> {
  const current = resolveChannelGroupActivation(config, channelId);
  const selected = await select({
    message: `${channelLabel} group/channel reply mode:`,
    options: [
      {
        value: 'always',
        label: 'Always reply',
        hint: 'Reply to all group/channel messages',
      },
      {
        value: 'mention',
        label: 'Reply only when mentioned',
        hint: 'Require @mention in group/channel',
      },
    ],
    initialValue: current,
  }) as string;

  if (isCancel(selected)) return current;

  const groupActivation = selected === 'mention' ? 'mention' : 'always';
  const modeText = groupActivation === 'mention' ? 'mention required' : 'always-on';
  console.log(chalk.dim(`  ${channelLabel} group policy: ${modeText}`));
  return groupActivation;
}

export async function registerWizardCommand(program: Command): Promise<void> {
  const wizard = program
    .command('wizard')
    .alias('onboard')
    .description('Interactive setup and configuration')
    .action(async () => {
      await runSetupWizard();
    });
  wizard
    .command('setup [target]')
    .description('Run setup wizard (target: all|providers|channels)')
    .addHelpText(
      'after',
      `\nExamples:\n  foxfang wizard setup\n  foxfang wizard setup channels\n  foxfang wizard setup providers\n`
    )
    .action(async (target?: string) => {
      const setupTarget = normalizeSetupTarget(target);

      if (!setupTarget) {
        throw new Error(
          `Unknown setup target "${target}". Use one of: all, providers, channels.`
        );
      }

      if (setupTarget === 'all') {
        await runSetupWizard();
        return;
      }

      if (setupTarget === 'providers') {
        await runProvidersWizard();
        return;
      }

      await runChannelsWizard();
    });

  wizard
    .command('providers')
    .description('Add or update AI providers')
    .action(runProvidersWizard);

  wizard
    .command('channels')
    .description('Channel setup wizard')
    .action(runChannelsWizard);

  wizard
    .command('bindings')
    .description('Configure auto-reply bindings (route by channel/account/chat/thread)')
    .action(runBindingsWizard);
}

async function runProvidersWizard() {
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
}

async function runChannelsWizard() {
  intro(chalk.cyan('Channel Setup Wizard'));
  await runChannelSetupWizard();
  outro(chalk.green('Done!'));
}

async function runSetupWizard() {
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
    
    // Handle different auth flows per provider
    let apiKey = '';
    if (providerId === 'github-copilot') {
      // GitHub Copilot uses device code flow instead of API key
      console.log(chalk.cyan('Starting GitHub Copilot login via device code...'));
      console.log(chalk.dim('This will authenticate with your GitHub Copilot subscription.\n'));
      try {
        const result = await loginWithDeviceCode();
        apiKey = result.token;
        console.log(chalk.green('✓ GitHub authentication successful!'));
      } catch (error) {
        console.log(chalk.yellow(`⏭ Skipped ${providerMeta.name}: ${error instanceof Error ? error.message : String(error)}`));
        continue;
      }
    } else if (providerId !== 'ollama') {
      const keyResult = await text({
        message: `${providerMeta.name} API Key:`,
        placeholder: providerMeta.apiKeyPlaceholder,
        validate: (value) => {
          if (!value || value.trim() === '') {
            return 'API key is required (or press Ctrl+C to skip this provider)';
          }
          if ((providerMeta as any).apiKeyPrefix && (providerMeta as any).apiKeyPrefix !== 'not-needed' &&
              !value.startsWith((providerMeta as any).apiKeyPrefix)) {
            return `API key should start with \"${(providerMeta as any).apiKeyPrefix}\"`;
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
    
    // Use default base URL — only prompt for custom/ollama providers
    let baseUrl = providerMeta.baseUrl;
    if (providerId === 'custom' || providerId === 'ollama') {
      const customBaseUrl = await text({
        message: `${providerMeta.name} Base URL:`,
        placeholder: providerMeta.baseUrl,
        defaultValue: providerMeta.baseUrl,
      });

      if (!isCancel(customBaseUrl) && customBaseUrl) {
        baseUrl = customBaseUrl as string;
      }
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

  // Auto-reply defaults — no need to ask the user, sensible defaults work for everyone
  const autoReplyDefaultAgent = String(config.autoReply?.defaultAgent || 'orchestrator').trim() || 'orchestrator';
  const autoReplyDefaultSessionScope = String(config.autoReply?.defaultSessionScope || 'chat-thread').trim() || 'chat-thread';

  const currentToolCacheTtlMs = Number(config.agentRuntime?.toolCacheTtlMs);
  const currentToolCacheTtlHours = Number.isFinite(currentToolCacheTtlMs) && currentToolCacheTtlMs > 0
    ? Math.max(1, Math.round(currentToolCacheTtlMs / (60 * 60 * 1000)))
    : 24;
  const toolCacheTtlHoursInput = await text({
    message: 'Tool result cache TTL (hours):',
    placeholder: '24',
    defaultValue: String(currentToolCacheTtlHours),
    validate: (value) => {
      const parsed = Number((value || '').trim());
      if (!Number.isFinite(parsed)) return 'Please enter a number';
      if (parsed <= 0) return 'TTL must be greater than 0 hour';
      if (parsed > 24 * 30) return 'TTL too large (max: 720 hours)';
      return undefined;
    },
  });
  if (isCancel(toolCacheTtlHoursInput)) {
    outro(chalk.yellow('Setup cancelled.'));
    return;
  }
  const toolCacheTtlHours = Math.max(1, Math.round(Number(toolCacheTtlHoursInput)));
  const toolCacheTtlMs = toolCacheTtlHours * 60 * 60 * 1000;
  
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
    
    if (!isCancel(shouldMigrate) && shouldMigrate === true) {
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
  config.autoReply = {
    ...(config.autoReply || {}),
    defaultAgent: autoReplyDefaultAgent,
    defaultSessionScope: autoReplyDefaultSessionScope as 'from' | 'chat' | 'thread' | 'chat-thread',
    bindings: Array.isArray(config.autoReply?.bindings) ? config.autoReply.bindings : [],
  };
  config.agentRuntime = {
    ...(config.agentRuntime || {}),
    toolCacheTtlMs,
  };
  
  // Replace all providers with newly configured ones
  config.providers = configuredProviders;
  
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
  console.log(chalk.dim('   Example: \"I need to create a marketing campaign for my coffee shop\"'));
  
  // Setup channels immediately if requested
  if (!isCancel(setupChannels) && setupChannels === true) {
    console.log(chalk.dim('\n--- Channel Setup ---\n'));
    await runChannelSetupWizard(config);
  }
  
  // Setup GitHub integration
  console.log(chalk.dim('\n--- GitHub Integration ---\n'));
  const connectGitHub = await confirm({
    message: 'Connect GitHub now? (can be done later via chat)',
    initialValue: false,
  });
  
  if (!isCancel(connectGitHub) && connectGitHub === true) {
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
      console.log(chalk.dim('You can connect later by saying \"Connect GitHub\" in chat'));
    }
  } else {
    console.log(chalk.dim('Skipped — say \"Connect GitHub\" in chat anytime to connect'));
  }
  
  // Print helpful tips after setup
  printSetupTips(configuredProviders.map((p: any) => p.id));
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
  if (providerId === 'github-copilot') {
    console.log(chalk.cyan('Starting GitHub Copilot login via device code...'));
    try {
      const result = await loginWithDeviceCode();
      apiKey = result.token;
      console.log(chalk.green('✓ GitHub authentication successful!'));
    } catch (error) {
      console.log(chalk.red(`Login failed: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
  } else if (providerId !== 'ollama') {
    apiKey = await text({
      message: `${providerMeta.name} API Key:`,
      placeholder: providerMeta.apiKeyPlaceholder,
    }) as string;
  }

  // Use default base URL — only prompt for custom/ollama providers
  let baseUrl = providerMeta.baseUrl;
  if (providerId === 'custom' || providerId === 'ollama') {
    const customBaseUrl = await text({
      message: `${providerMeta.name} Base URL:`,
      placeholder: providerMeta.baseUrl,
      defaultValue: providerMeta.baseUrl,
    }) as string;
    if (customBaseUrl) {
      baseUrl = customBaseUrl;
    }
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
  
  // Only prompt base URL for custom/ollama providers
  let baseUrl = provider.baseUrl || providerMeta?.baseUrl || '';
  if (providerId === 'custom' || providerId === 'ollama') {
    baseUrl = await text({
      message: `${provider.name} Base URL:`,
      placeholder: providerMeta?.baseUrl || 'https://api...',
      defaultValue: provider.baseUrl || providerMeta?.baseUrl,
    }) as string;
  }

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

async function setupTelegram(): Promise<boolean> {
  console.log(chalk.dim('\nTelegram Bot Setup:'));
  console.log('1. Message @BotFather on Telegram');
  console.log('2. Create a new bot with /newbot');
  console.log('3. Copy the API token\n');

  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  const currentToken = String(config.channels?.telegram?.botToken || '').trim();
  
  const token = await text({
    message: 'Bot API Token:',
    placeholder: currentToken
      ? 'Leave empty to keep current token'
      : '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    validate: (value) => {
      const next = value?.trim() || '';
      if (!next && currentToken) return;
      if (!next || !next.includes(':')) return 'Invalid token format';
    },
  });

  if (isCancel(token)) {
    console.log(chalk.yellow('  Telegram setup canceled'));
    return false;
  }

  const botToken = String(token || '').trim() || currentToken;
  if (!botToken) {
    console.log(chalk.yellow('  Telegram not configured: missing bot token'));
    return false;
  }
  
  const groupActivation = await configureChannelGroupReplyMode(config, 'telegram', 'Telegram');
  config.channels.telegram = {
    enabled: true,
    botToken,
    groupActivation,
    requireMentionInGroups: groupActivation === 'mention',
  };
  await saveConfig(config);
  
  console.log(chalk.dim('  Token saved to config'));
  return true;
}

async function setupDiscord(): Promise<boolean> {
  console.log(chalk.dim('\nDiscord Bot Setup:'));
  console.log('1. Go to https://discord.com/developers/applications');
  console.log('2. Create a new application');
  console.log('3. Go to Bot section and copy the token\n');

  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  const currentToken = String(config.channels?.discord?.botToken || '').trim();
  
  const token = await text({
    message: 'Bot Token:',
    placeholder: currentToken ? 'Leave empty to keep current token' : undefined,
    validate: (value) => {
      const next = value?.trim() || '';
      if (!next && currentToken) return;
      if (!next) return 'Token is required';
    },
  });

  if (isCancel(token)) {
    console.log(chalk.yellow('  Discord setup canceled'));
    return false;
  }

  const botToken = String(token || '').trim() || currentToken;
  if (!botToken) {
    console.log(chalk.yellow('  Discord not configured: missing bot token'));
    return false;
  }
  
  const groupActivation = await configureChannelGroupReplyMode(config, 'discord', 'Discord');
  config.channels.discord = {
    enabled: true,
    botToken,
    groupActivation,
    requireMentionInGroups: groupActivation === 'mention',
  };
  await saveConfig(config);
  
  console.log(chalk.dim('  Token saved to config'));
  return true;
}

async function setupSlack(): Promise<boolean> {
  console.log(chalk.dim('\nSlack App Setup:'));
  console.log('1. Go to https://api.slack.com/apps');
  console.log('2. Create a new app');
  console.log('3. Add Bot Token Scopes: chat:write, im:history');
  console.log('4. Install app and copy Bot User OAuth Token\n');

  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  const currentBotToken = String(config.channels?.slack?.botToken || '').trim();
  const currentAppToken = String(config.channels?.slack?.appToken || '').trim();
  
  const botToken = await text({
    message: 'Bot User OAuth Token (xoxb-):',
    placeholder: currentBotToken ? 'Leave empty to keep current token' : 'xoxb-...',
    validate: (value) => {
      const next = value?.trim() || '';
      if (!next && currentBotToken) return;
      if (!next.startsWith('xoxb-')) return 'Token should start with xoxb-';
    },
  });

  if (isCancel(botToken)) {
    console.log(chalk.yellow('  Slack setup canceled'));
    return false;
  }
  
  // Socket Mode requires app-level token
  const appToken = await text({
    message: 'App-Level Token (xapp-):',
    placeholder: currentAppToken ? 'Leave empty to keep current token' : 'xapp-...',
    validate: (value) => {
      const next = value?.trim() || '';
      if (!next && currentAppToken) return;
      if (!next.startsWith('xapp-')) return 'Token should start with xapp-';
    },
  });

  if (isCancel(appToken)) {
    console.log(chalk.yellow('  Slack setup canceled'));
    return false;
  }

  const nextBotToken = String(botToken || '').trim() || currentBotToken;
  const nextAppToken = String(appToken || '').trim() || currentAppToken;
  if (!nextBotToken || !nextAppToken) {
    console.log(chalk.yellow('  Slack not configured: missing required token(s)'));
    return false;
  }
  
  const groupActivation = await configureChannelGroupReplyMode(config, 'slack', 'Slack');
  config.channels.slack = {
    enabled: true,
    botToken: nextBotToken,
    appToken: nextAppToken,
    groupActivation,
    requireMentionInGroups: groupActivation === 'mention',
  };
  await saveConfig(config);
  
  console.log(chalk.dim('  Tokens saved to config'));
  return true;
}

async function setupSignal(): Promise<boolean> {
  console.log(chalk.dim('\nSignal Setup:'));
  console.log('Signal requires signal-cli to be installed and running.');
  console.log('Docs: https://github.com/AsamK/signal-cli\n');

  const config = await loadConfig();
  if (!config.channels) config.channels = {};
  const currentPhoneNumber = String(config.channels?.signal?.phoneNumber || '').trim();
  const currentHttpUrl = String(config.channels?.signal?.httpUrl || '').trim();
  
  const phoneNumber = await text({
    message: 'Phone number (with country code):',
    placeholder: currentPhoneNumber ? 'Leave empty to keep current number' : '+1234567890',
    validate: (value) => {
      const next = value?.trim() || '';
      if (!next && currentPhoneNumber) return;
      if (!next) return 'Phone number is required';
    },
  });

  if (isCancel(phoneNumber)) {
    console.log(chalk.yellow('  Signal setup canceled'));
    return false;
  }
  
  const httpUrl = await text({
    message: 'Signal CLI HTTP URL:',
    placeholder: 'http://127.0.0.1:8686',
    defaultValue: currentHttpUrl || 'http://127.0.0.1:8686',
  });

  if (isCancel(httpUrl)) {
    console.log(chalk.yellow('  Signal setup canceled'));
    return false;
  }
  
  const resolvedPhoneNumber = String(phoneNumber || '').trim() || currentPhoneNumber;
  if (!resolvedPhoneNumber) {
    console.log(chalk.yellow('  Signal not configured: missing phone number'));
    return false;
  }

  const httpUrlStr = String(httpUrl || '').trim() || currentHttpUrl || 'http://127.0.0.1:8686';
  
  const groupActivation = await configureChannelGroupReplyMode(config, 'signal', 'Signal');
  config.channels.signal = {
    enabled: true,
    phoneNumber: resolvedPhoneNumber,
    httpUrl: httpUrlStr,
    groupActivation,
    requireMentionInGroups: groupActivation === 'mention',
  };
  await saveConfig(config);
  
  console.log(chalk.dim(`  Signal endpoint: ${httpUrlStr}`));
  return true;
}

/**
 * Run channel setup wizard inline (called during initial setup)
 */
export async function runChannelSetupWizard(_config?: any) {
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
          if (await setupTelegram()) {
            console.log(chalk.green('\n✓ Telegram configured!'));
          } else {
            console.log(chalk.yellow('\n- Telegram setup skipped'));
          }
          break;
        case 'discord':
          if (await setupDiscord()) {
            console.log(chalk.green('\n✓ Discord configured!'));
          } else {
            console.log(chalk.yellow('\n- Discord setup skipped'));
          }
          break;
        case 'slack':
          if (await setupSlack()) {
            console.log(chalk.green('\n✓ Slack configured!'));
          } else {
            console.log(chalk.yellow('\n- Slack setup skipped'));
          }
          break;
        case 'signal':
          if (await setupSignal()) {
            console.log(chalk.green('\n✓ Signal configured!'));
          } else {
            console.log(chalk.yellow('\n- Signal setup skipped'));
          }
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
    
    if (isCancel(setupAnother) || setupAnother !== true) {
      continueSetup = false;
    }
  }
  
  console.log(chalk.dim('\n--- Channel setup complete ---\n'));
}

/**
 * Print helpful tips after setup completion
 */
function printSetupTips(providerIds: string[]) {
  const providers = providerIds.map(id => AVAILABLE_PROVIDERS.find(p => p.id === id)?.name || id);

  console.log(chalk.green.bold('\n  🦊 FoxFang is ready!\n'));
  console.log(chalk.dim(`  Providers: ${providers.join(', ')}`));
  console.log();
  console.log(`  ${chalk.green('pnpm foxfang chat')}            ${chalk.dim('Start chatting')}`);
  console.log(`  ${chalk.green('pnpm foxfang run "..."')}       ${chalk.dim('Run a single task')}`);
  console.log(`  ${chalk.green('pnpm foxfang daemon run')}      ${chalk.dim('Start channels daemon')}`);
  console.log(`  ${chalk.green('pnpm foxfang --help')}          ${chalk.dim('All commands')}`);
  console.log();
}
