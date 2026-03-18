/**
 * GitHub Command - Manage GitHub integration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import ora from 'ora';
import { spawn } from 'child_process';
import {
  isGitHubConnected,
  getGitHubToken,
  saveGitHubToken,
  disconnectGitHub,
  getGitHubUser,
  githubApiRequest,
  extractOwnerRepo,
  generateIssueTemplate,
  generatePRTemplate,
  startGitHubOAuthFlow,
} from '../../integrations/github';

export async function registerGitHubCommand(program: Command): Promise<void> {
  const github = program
    .command('github')
    .description('Manage GitHub integration');

  // Status command
  github
    .command('status')
    .description('Check GitHub connection status')
    .action(async () => {
      const token = await getGitHubToken();
      
      if (token) {
        console.log(chalk.green('✓ GitHub connected'));
        console.log(chalk.dim(`  User: ${token.username || 'unknown'}`));
        console.log(chalk.dim(`  Scopes: ${token.scopes.join(', ')}`));
        console.log(chalk.dim(`  Connected: ${new Date(token.createdAt).toLocaleString()}`));
      } else {
        console.log(chalk.red('✗ GitHub not connected'));
        console.log(chalk.dim('\nTo connect:'));
        console.log(chalk.dim('  foxfang github login'));
      }
    });

  // Login command - OAuth flow via proxy
  github
    .command('login')
    .description('Connect to GitHub via OAuth')
    .option('-t, --token <token>', 'GitHub personal access token (alternative to OAuth)')
    .action(async (options) => {
      // If token provided directly, use it
      if (options.token) {
        const spinner = ora('Verifying token...').start();
        
        try {
          const user = await getGitHubUser(options.token);
          await saveGitHubToken(options.token, user.login, ['repo', 'read:user']);
          
          spinner.succeed(chalk.green(`Connected as ${user.login}`));
        } catch (error) {
          spinner.fail('Failed to connect');
          console.error(chalk.red(error instanceof Error ? error.message : String(error)));
          process.exit(1);
        }
        return;
      }

      // Otherwise, use OAuth flow
      console.log(chalk.cyan('GitHub OAuth Authentication'));
      console.log();
      console.log('Opening browser for GitHub authorization...');
      console.log();

      try {
        const { authUrl, waitForCallback } = await startGitHubOAuthFlow();
        
        // Open browser
        const openCommand = process.platform === 'darwin' ? 'open' : 
                           process.platform === 'win32' ? 'start' : 'xdg-open';
        spawn(openCommand, [authUrl], { detached: true, stdio: 'ignore' }).unref();
        
        console.log(chalk.dim(`If browser doesn't open, visit:`));
        console.log(chalk.blue(authUrl));
        console.log();
        
        const spinner = ora('Waiting for authorization...').start();
        
        try {
          const token = await waitForCallback();
          spinner.succeed(chalk.green(`Connected as ${token.username || 'unknown'}`));
        } catch (error) {
          spinner.fail('Authorization failed');
          console.error(chalk.red(error instanceof Error ? error.message : String(error)));
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red('Failed to start OAuth flow:'));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        
        // Fallback to manual token entry
        console.log();
        console.log(chalk.yellow('Falling back to manual token entry...'));
        console.log();
        console.log('Get a token at: https://github.com/settings/tokens');
        console.log('Required scopes: repo, read:user');
        console.log();
        
        const token = await new Promise<string>((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question('Enter your GitHub personal access token: ', (answer) => {
            rl.close();
            resolve(answer.trim());
          });
        });
        
        if (!token) {
          console.log(chalk.red('No token provided'));
          process.exit(1);
        }
        
        const spinner = ora('Verifying token...').start();
        
        try {
          const user = await getGitHubUser(token);
          await saveGitHubToken(token, user.login, ['repo', 'read:user']);
          
          spinner.succeed(chalk.green(`Connected as ${user.login}`));
        } catch (error) {
          spinner.fail('Failed to connect');
          console.error(chalk.red(error instanceof Error ? error.message : String(error)));
          process.exit(1);
        }
      }
    });

  // Logout command
  github
    .command('logout')
    .description('Disconnect from GitHub')
    .action(async () => {
      const connected = await isGitHubConnected();
      if (!connected) {
        console.log(chalk.yellow('GitHub is not connected'));
        return;
      }
      
      await disconnectGitHub();
      console.log(chalk.green('✓ Disconnected from GitHub'));
    });

  // Issue commands
  const issue = github
    .command('issue')
    .description('Manage GitHub issues');

  issue
    .command('create')
    .description('Create a new issue')
    .requiredOption('-r, --repo <repo>', 'Repository (owner/repo)')
    .requiredOption('-t, --title <title>', 'Issue title')
    .option('-b, --body <body>', 'Issue body')
    .option('-l, --labels <labels>', 'Comma-separated labels', (val: string) => val.split(',').map(s => s.trim()))
    .action(async (options) => {
      const token = await getGitHubToken();
      if (!token) {
        console.log(chalk.red('GitHub is not connected. Run: foxfang github login'));
        process.exit(1);
      }

      const ownerRepo = extractOwnerRepo(options.repo);
      if (!ownerRepo) {
        console.log(chalk.red(`Invalid repo format: ${options.repo}`));
        process.exit(1);
      }

      const body = options.body || generateIssueTemplate(options.title);
      const labels = options.labels || ['feature'];

      const spinner = ora('Creating issue...').start();

      try {
        const result = await githubApiRequest(
          `/repos/${ownerRepo.owner}/${ownerRepo.repo}/issues`,
          {
            method: 'POST',
            token: token.token,
            body: {
              title: options.title,
              body,
              labels,
            },
          }
        );

        spinner.succeed(chalk.green(`Issue #${result.number} created`));
        console.log(chalk.dim(`  ${result.html_url}`));
      } catch (error) {
        spinner.fail('Failed to create issue');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  issue
    .command('list')
    .description('List issues')
    .requiredOption('-r, --repo <repo>', 'Repository (owner/repo)')
    .option('-s, --state <state>', 'Issue state (open/closed/all)', 'open')
    .option('-l, --limit <n>', 'Maximum issues to show', '30')
    .action(async (options) => {
      const token = await getGitHubToken();
      if (!token) {
        console.log(chalk.red('GitHub is not connected. Run: foxfang github login'));
        process.exit(1);
      }

      const ownerRepo = extractOwnerRepo(options.repo);
      if (!ownerRepo) {
        console.log(chalk.red(`Invalid repo format: ${options.repo}`));
        process.exit(1);
      }

      const spinner = ora('Fetching issues...').start();

      try {
        const issues = await githubApiRequest(
          `/repos/${ownerRepo.owner}/${ownerRepo.repo}/issues?state=${options.state}&per_page=${options.limit}`,
          { token: token.token }
        );

        spinner.stop();

        if (issues.length === 0) {
          console.log(chalk.yellow('No issues found'));
          return;
        }

        console.log(chalk.cyan(`${issues.length} issue(s):`));
        console.log();

        for (const issue of issues) {
          const stateColor = issue.state === 'open' ? chalk.green : chalk.red;
          console.log(`  #${issue.number} ${stateColor(`[${issue.state}]`)} ${issue.title}`);
          console.log(chalk.dim(`      ${issue.html_url}`));
          if (issue.labels?.length > 0) {
            console.log(chalk.dim(`      Labels: ${issue.labels.map((l: any) => l.name).join(', ')}`));
          }
          console.log();
        }
      } catch (error) {
        spinner.fail('Failed to fetch issues');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  // PR commands
  const pr = github
    .command('pr')
    .description('Manage GitHub pull requests');

  pr
    .command('create')
    .description('Create a new pull request')
    .requiredOption('-r, --repo <repo>', 'Repository (owner/repo)')
    .requiredOption('-t, --title <title>', 'PR title')
    .requiredOption('-h, --head <branch>', 'Branch to merge from')
    .option('-b, --body <body>', 'PR body')
    .option('--base <branch>', 'Branch to merge into', 'main')
    .action(async (options) => {
      const token = await getGitHubToken();
      if (!token) {
        console.log(chalk.red('GitHub is not connected. Run: foxfang github login'));
        process.exit(1);
      }

      const ownerRepo = extractOwnerRepo(options.repo);
      if (!ownerRepo) {
        console.log(chalk.red(`Invalid repo format: ${options.repo}`));
        process.exit(1);
      }

      const body = options.body || generatePRTemplate(options.title);

      const spinner = ora('Creating pull request...').start();

      try {
        const result = await githubApiRequest(
          `/repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls`,
          {
            method: 'POST',
            token: token.token,
            body: {
              title: options.title,
              body,
              head: options.head,
              base: options.base,
            },
          }
        );

        spinner.succeed(chalk.green(`Pull request #${result.number} created`));
        console.log(chalk.dim(`  ${result.html_url}`));
      } catch (error) {
        spinner.fail('Failed to create pull request');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  pr
    .command('list')
    .description('List pull requests')
    .requiredOption('-r, --repo <repo>', 'Repository (owner/repo)')
    .option('-s, --state <state>', 'PR state (open/closed/all)', 'open')
    .option('-l, --limit <n>', 'Maximum PRs to show', '30')
    .action(async (options) => {
      const token = await getGitHubToken();
      if (!token) {
        console.log(chalk.red('GitHub is not connected. Run: foxfang github login'));
        process.exit(1);
      }

      const ownerRepo = extractOwnerRepo(options.repo);
      if (!ownerRepo) {
        console.log(chalk.red(`Invalid repo format: ${options.repo}`));
        process.exit(1);
      }

      const spinner = ora('Fetching pull requests...').start();

      try {
        const prs = await githubApiRequest(
          `/repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls?state=${options.state}&per_page=${options.limit}`,
          { token: token.token }
        );

        spinner.stop();

        if (prs.length === 0) {
          console.log(chalk.yellow('No pull requests found'));
          return;
        }

        console.log(chalk.cyan(`${prs.length} pull request(s):`));
        console.log();

        for (const pr of prs) {
          const stateColor = pr.state === 'open' ? chalk.green : chalk.red;
          console.log(`  #${pr.number} ${stateColor(`[${pr.state}]`)} ${pr.title}`);
          console.log(chalk.dim(`      ${pr.head.ref} → ${pr.base.ref}`));
          console.log(chalk.dim(`      ${pr.html_url}`));
          console.log();
        }
      } catch (error) {
        spinner.fail('Failed to fetch pull requests');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });
}
