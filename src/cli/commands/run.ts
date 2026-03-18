/**
 * Run Command - Execute a single agent task
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { AgentOrchestrator } from '../../agents/orchestrator';
import { SessionManager } from '../../sessions/manager';
import { loadConfigWithCredentials } from '../../config/index';
import { initializeProviders } from '../../providers/index';
import { initializeTools } from '../../tools/index';
import { setDefaultProvider } from '../../agents/runtime';

export async function registerRunCommand(program: Command): Promise<void> {
  program
    .command('run')
    .description('Run a single agent task')
    .argument('<message>', 'Message or task description')
    .option('-a, --agent <agent>', 'Agent ID to use', 'default')
    .option('-p, --project <project>', 'Project ID')
    .option('-s, --session <session>', 'Session ID (creates new if not provided)')
    .option('--stream', 'Stream output', true)
    .option('--no-stream', 'Disable streaming output')
    .option('-m, --model <model>', 'Model to use (e.g., gpt-4, claude-3)')
    .option('--provider <provider>', 'Provider to use (openai, anthropic, kimi)')
    .action(async (message, options) => {
      const spinner = ora('Initializing...').start();
      
      try {
        // Load configuration with credentials
        const config = await loadConfigWithCredentials();
        
        // Initialize providers
        initializeProviders(config.providers);
        
        // Set default provider for agents
        setDefaultProvider(config.defaultProvider);
        
        // Initialize tools
        initializeTools(config.tools?.tools || {});
        
        // Create session manager
        const sessionManager = new SessionManager(config.sessions);
        
        // Create orchestrator
        const orchestrator = new AgentOrchestrator(sessionManager);
        
        spinner.succeed('Ready');
        
        // Generate session ID if not provided
        const sessionId = options.session || `cli-${Date.now()}`;
        
        console.log(chalk.dim(`Session: ${sessionId}`));
        console.log(chalk.dim(`Agent: ${options.agent}`));
        console.log();
        
        // Run the task
        if (options.stream) {
          // Streaming output
          const result = await orchestrator.run({
            sessionId,
            agentId: options.agent,
            message,
            projectId: options.project,
            model: options.model,
            provider: options.provider,
            stream: true,
          });
          
          if (result.stream) {
            for await (const chunk of result.stream) {
              if (chunk.type === 'text' && chunk.content) {
                process.stdout.write(chunk.content);
              } else if (chunk.type === 'tool_call') {
                console.log(chalk.cyan(`\n[Using tool: ${chunk.tool}]`));
              }
            }
          }
          console.log(); // New line at end
        } else {
          // Run non-streaming
          const result = await orchestrator.run({
            sessionId,
            agentId: options.agent,
            message,
            projectId: options.project,
            model: options.model,
            provider: options.provider,
            stream: false,
          });
          
          console.log(result.content);
        }
        
        // Save session if needed
        if (options.session) {
          await sessionManager.saveSession(sessionId);
        }
        
      } catch (error) {
        spinner.fail('Failed');
        throw error;
      }
    });
}
