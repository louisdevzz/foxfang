/**
 * Chat Command - Interactive chat with agent
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { AgentOrchestrator } from '../../agents/orchestrator';
import { SessionManager } from '../../sessions/manager';
import { loadConfigWithCredentials } from '../../config/index';
import { initializeProviders } from '../../providers/index';
import { initializeTools, toolRegistry } from '../../tools/index';
import { setDefaultProvider } from '../../agents/runtime';

export async function registerChatCommand(program: Command): Promise<void> {
  program
    .command('chat')
    .description('Start an interactive chat session with an agent')
    .option('-a, --agent <agent>', 'Agent ID to use', 'orchestrator')
    .option('-p, --project <project>', 'Project ID')
    .option('-s, --session <session>', 'Session ID (creates new if not provided)')
    .option('-m, --model <model>', 'Model to use')
    .option('--provider <provider>', 'Provider to use')
    .option('--system <prompt>', 'System prompt override')
    .action(async (options) => {
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
      
      // Generate session ID
      const sessionId = options.session || `chat-${Date.now()}`;
      
      console.log(chalk.cyan('╔════════════════════════════════════════╗'));
      console.log(chalk.cyan('║     FoxFang - Agent Chat Mode          ║'));
      console.log(chalk.cyan('╚════════════════════════════════════════╝'));
      console.log();
      console.log(chalk.dim(`Session: ${sessionId}`));
      console.log(chalk.dim(`Agent: ${options.agent}`));
      console.log(chalk.dim('Type "exit" or "quit" to end the chat'));
      console.log(chalk.dim('Type "/help" for available commands'));
      console.log();
      
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.green('You: '),
      });
      
      let isProcessing = false;
      let shouldExit = false;
      
      rl.prompt();
      
      rl.on('line', async (input) => {
        const message = input.trim();
        
        if (!message) {
          rl.prompt();
          return;
        }
        
        // Handle special commands
        if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
          console.log(chalk.yellow('Goodbye!'));
          rl.close();
          return;
        }
        
        if (message === '/help') {
          console.log(chalk.cyan('Available commands:'));
          console.log('  /help     - Show this help');
          console.log('  /clear    - Clear conversation history');
          console.log('  /agents   - List available agents');
          console.log('  /tools    - List available tools');
          console.log('  /save     - Save current session');
          console.log('  exit/quit - End the chat');
          console.log();
          rl.prompt();
          return;
        }
        
        if (message === '/clear') {
          await sessionManager.clearSession(sessionId);
          console.log(chalk.yellow('Conversation history cleared.'));
          console.log();
          rl.prompt();
          return;
        }
        
        if (message === '/agents') {
          console.log(chalk.cyan('Available agents:'));
          console.log('  - orchestrator (Routes tasks to specialists)');
          console.log('  - content-specialist');
          console.log('  - growth-analyst');
          console.log();
          rl.prompt();
          return;
        }
        
        if (message === '/tools') {
          console.log(chalk.cyan('Available tools:'));
          console.log('  - web_search - Search the web');
          console.log('  - memory_store - Store information');
          console.log('  - memory_recall - Recall stored information');
          console.log();
          rl.prompt();
          return;
        }
        
        if (message === '/save') {
          await sessionManager.saveSession(sessionId);
          console.log(chalk.yellow('Session saved.'));
          console.log();
          rl.prompt();
          return;
        }
        
        isProcessing = true;
        
        try {
          // Show thinking indicator while waiting for first chunk
          const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
          let spinnerIndex = 0;
          let hasStarted = false;
          let fullContent = '';
          
          // Write prefix and start spinner on same line
          process.stdout.write(chalk.blue('\nAgent: '));
          
          const spinnerInterval = setInterval(() => {
            if (!hasStarted) {
              // Use carriage return to go back to start of line
              process.stdout.write('\r' + chalk.blue('Agent: ') + chalk.dim(spinnerFrames[spinnerIndex] + ' thinking...'));
              spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
            }
          }, 80);
          
          const result = await orchestrator.run({
            sessionId,
            agentId: options.agent,
            message,
            projectId: options.project,
            model: options.model,
            provider: options.provider,
            systemPrompt: options.system,
            stream: true,
          });
          
          if (result.stream) {
            for await (const chunk of result.stream) {
              if (chunk.type === 'text' && chunk.content) {
                if (!hasStarted) {
                  // First chunk received - clear spinner and start streaming
                  hasStarted = true;
                  clearInterval(spinnerInterval);
                  // Clear the spinner by writing spaces, then reset to start
                  process.stdout.write('\r' + chalk.blue('Agent: ') + '                    ');
                  process.stdout.write('\r' + chalk.blue('Agent: '));
                }
                fullContent += chunk.content;
                process.stdout.write(chunk.content);
              } else if (chunk.type === 'tool_call') {
                // Show tool call inline (model is using a tool)
                if (!hasStarted) {
                  hasStarted = true;
                  clearInterval(spinnerInterval);
                  process.stdout.write('\r' + chalk.blue('Agent: ') + '                    ');
                }
                process.stdout.write(chalk.dim(` [tool: ${chunk.tool}] `));
              }
              // tool_result chunks are internal - model will generate text based on them
              // We don't display them to avoid duplication with model's response
            }
          }
          
          // Clear spinner if stream ended without content
          if (!hasStarted) {
            clearInterval(spinnerInterval);
            process.stdout.write('\r' + chalk.blue('Agent: ') + chalk.dim('(no response)'));
          }
          
          console.log('\n');
          
        } catch (error) {
          console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
        }
        
        isProcessing = false;
        
        // If close was triggered while processing, exit now
        if (shouldExit) {
          console.log(chalk.yellow('\nChat ended. Session saved.'));
          process.exit(0);
        }
        
        rl.prompt();
      });
      
      rl.on('close', () => {
        if (isProcessing) {
          // Wait for processing to complete
          shouldExit = true;
        } else {
          console.log(chalk.yellow('\nChat ended. Session saved.'));
          process.exit(0);
        }
      });
    });
}
