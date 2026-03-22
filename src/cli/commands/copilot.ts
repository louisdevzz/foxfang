/**
 * Copilot Command — GitHub Copilot provider login and status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loginWithDeviceCode } from '../../providers/github-copilot';
import { loadConfigWithCredentials, saveConfig } from '../../config/index';
import { ProviderConfig } from '../../providers/index';

export async function registerCopilotCommand(program: Command): Promise<void> {
  const copilot = program
    .command('copilot')
    .description('GitHub Copilot provider management');

  copilot
    .command('login')
    .description('Login to GitHub Copilot via device code flow')
    .action(async () => {
      try {
        console.log(chalk.cyan('Starting GitHub Copilot login...'));
        console.log(chalk.dim('This will open a device code flow with GitHub.\n'));

        const result = await loginWithDeviceCode();

        console.log(chalk.green('\n✓ Successfully authenticated with GitHub!'));

        // Save the token to config
        const config = await loadConfigWithCredentials();
        const existingProviders = config.providers || [];

        const filtered = (existingProviders as ProviderConfig[]).filter(
          (p) => p.id !== 'github-copilot',
        );

        filtered.push({
          id: 'github-copilot',
          name: 'GitHub Copilot',
          apiKey: result.token,
          enabled: true,
          defaultModel: 'gpt-4o',
          smallModel: 'gpt-4.1-mini',
          models: [
            'claude-sonnet-4.6',
            'gpt-4o',
            'gpt-4.1',
            'gpt-4.1-mini',
            'gpt-4.1-nano',
            'o1',
            'o1-mini',
            'o3-mini',
          ],
        });

        await saveConfig({ ...config, providers: filtered });

        console.log(chalk.green('✓ Provider saved to config.'));
        console.log(chalk.dim('\nAvailable models: gpt-4o, gpt-4.1, claude-sonnet-4.6, o1, o3-mini'));
        console.log(chalk.dim('Set as default: foxfang config set defaultProvider github-copilot'));
      } catch (error) {
        console.error(chalk.red('Login failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  copilot
    .command('status')
    .description('Check GitHub Copilot connection status')
    .action(async () => {
      try {
        const config = await loadConfigWithCredentials();
        const copilotConfig = (config.providers || []).find(
          (p: { id: string }) => p.id === 'github-copilot',
        );

        if (!copilotConfig?.apiKey) {
          const envToken = process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
          if (!envToken) {
            console.log(chalk.yellow('Not configured. Run: foxfang copilot login'));
            return;
          }
          console.log(chalk.dim('Using GitHub token from environment variable.'));
        }

        const { GitHubCopilotProvider } = require('../../providers/github-copilot');
        const provider = new GitHubCopilotProvider(copilotConfig || { id: 'github-copilot', name: 'GitHub Copilot', enabled: true });
        const status = await provider.getStatus();

        if (status.healthy) {
          console.log(chalk.green('✓ GitHub Copilot is connected and working.'));
        } else {
          console.log(chalk.red('✗ Connection issue:'), status.error);
        }
      } catch (error) {
        console.error(chalk.red('Status check failed:'), error instanceof Error ? error.message : String(error));
      }
    });
}
