/**
 * Interactive Mode
 * 
 * Enhanced REPL-like interaction with FoxFang.
 */

import { createInterface } from 'readline';

export interface InteractiveOptions {
  projectId?: string;
  sessionId?: string;
  onCommand?: (command: string, args: string[]) => Promise<void>;
}

/**
 * Start interactive mode
 */
export async function startInteractive(options: InteractiveOptions): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🦊 > '
  });

  console.log('FoxFang Interactive Mode');
  console.log('Type "/help" for commands, "/exit" to quit\n');

  rl.prompt();

  rl.on('line', async (input) => {
    const trimmed = input.trim();
    
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const [command, ...args] = trimmed.slice(1).split(' ');
      
      if (command === 'exit' || command === 'quit') {
        rl.close();
        return;
      }

      if (command === 'help') {
        showHelp();
        rl.prompt();
        return;
      }

      if (options.onCommand) {
        await options.onCommand(command, args);
      }
    } else {
      // Regular message - process through agent
      console.log(`Processing: ${trimmed}`);
      // TODO: Send to agent
    }

    rl.prompt();
  });

  return new Promise((resolve) => {
    rl.on('close', () => {
      console.log('\nGoodbye! 🦊');
      resolve();
    });
  });
}

function showHelp(): void {
  console.log(`
Available commands:
  /help          Show this help
  /exit, /quit   Exit interactive mode
  /project <id>  Switch to project
  /memory        Show relevant memories
  /clear         Clear screen
`);
}
