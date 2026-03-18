/**
 * FoxFang CLI Program Builder
 * 
 * Builds the CLI program with all commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { registerRunCommand } from './commands/run';
import { registerChatCommand } from './commands/chat';
import { registerDaemonCommand } from './commands/daemon';
import { registerConfigCommand } from './commands/config';
import { registerWizardCommand } from './commands/wizard';
import { registerChannelsCommand } from './commands/channels';
import { registerGitHubCommand } from './commands/github';
import { registerSessionsCommand } from './commands/sessions';
import { registerMemoryCommand } from './commands/memory';
import { registerStatusCommand } from './commands/status';
import { getVersion } from './version';

export async function buildProgram(): Promise<Command> {
  const program = new Command();
  
  program
    .name('foxfang')
    .description('FoxFang 🦊 — Your Personal AI Marketing Agent. A dedicated companion that learns your style, manages campaigns, and helps create content that resonates.')
    .version(await getVersion(), '-v, --version')
    .option('-d, --debug', 'Enable debug mode', false)
    .option('--config <path>', 'Path to config file')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts.debug) {
        process.env.DEBUG = '1';
        process.env.LOG_LEVEL = 'debug';
      }
    });

  // Register all commands
  await registerRunCommand(program);
  await registerChatCommand(program);
  await registerDaemonCommand(program);
  await registerConfigCommand(program);
  await registerWizardCommand(program);
  await registerChannelsCommand(program);
  await registerGitHubCommand(program);
  await registerSessionsCommand(program);
  await registerMemoryCommand(program);
  await registerStatusCommand(program);

  // Add help text
  program.addHelpText('after', `
${chalk.cyan('Examples:')}
  ${chalk.dim('$')} foxfang run "Create a marketing campaign for Q4"
  ${chalk.dim('$')} foxfang chat --agent content-specialist
  ${chalk.dim('$')} foxfang daemon start
  ${chalk.dim('$')} foxfang wizard setup
  ${chalk.dim('$')} foxfang channels telegram send --message "Hello"
  ${chalk.dim('$')} foxfang github login
  ${chalk.dim('$')} foxfang github issue create --repo owner/repo --title "[Feature]: Add new feature"

${chalk.cyan('Documentation:')}
  https://docs.foxfang.dev

${chalk.cyan('Need help?')}
  Run ${chalk.yellow('foxfang <command> --help')} for detailed usage.
`);

  return program;
}
