/**
 * Command Registry
 *
 * Slash command handling for auto-reply system.
 */

import { ReplyPayload, CommandRegistry, CommandContext } from './types';
import { runUpdate } from '../infra/update-runner';
import { writeRestartSentinel } from '../infra/restart-sentinel';
import { scheduleRespawnAndExit } from '../infra/process-respawn';

export class CommandRegistryManager {
  private commands: Map<string, CommandRegistry> = new Map();

  register(cmd: CommandRegistry): void {
    this.commands.set(cmd.name.toLowerCase(), cmd);
  }

  unregister(name: string): void {
    this.commands.delete(name.toLowerCase());
  }

  get(name: string): CommandRegistry | undefined {
    return this.commands.get(name.toLowerCase());
  }

  list(): CommandRegistry[] {
    return Array.from(this.commands.values());
  }

  /**
   * Parse command from message text
   * Returns [commandName, args] or null if not a command
   */
  parse(text: string): [string, string[]] | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    return [commandName, args];
  }

  /**
   * Execute command from context
   */
  async execute(ctx: CommandContext): Promise<ReplyPayload | null> {
    if (!ctx.message.text) return null;
    
    const parsed = this.parse(ctx.message.text);
    if (!parsed) return null;

    const [commandName, args] = parsed;
    const command = this.get(commandName);
    
    if (!command) {
      return {
        text: `Unknown command: /${commandName}\nUse /help for available commands.`,
      };
    }

    // Check auth if required
    if (command.requireAuth) {
      // TODO: Implement auth check
      // For now, allow all
    }

    return await command.handler({ ...ctx, args });
  }

  /**
   * Check if text is a command
   */
  isCommand(text: string): boolean {
    return this.parse(text) !== null;
  }
}

// Global registry instance
export const globalCommandRegistry = new CommandRegistryManager();

/**
 * Built-in commands
 */
export function registerBuiltinCommands(registry: CommandRegistryManager): void {
  // Help command
  registry.register({
    name: 'help',
    description: 'Show available commands',
    handler: async () => {
      const commands = registry.list();
      const commandList = commands
        .map(cmd => `/${cmd.name} - ${cmd.description}`)
        .join('\n');
      return {
        text: `🦊 **FoxFang Commands**\n\n${commandList}`,
      };
    },
  });

  // Status command
  registry.register({
    name: 'status',
    description: 'Show agent status',
    handler: async () => {
      return {
        text: '📊 Status: Online\n🤖 Agent: FoxFang\n📡 Channels: Connected',
      };
    },
  });

  // Reset command - clear session
  registry.register({
    name: 'reset',
    description: 'Reset conversation session',
    handler: async (ctx) => {
      // Session will be reset by the handler
      return {
        text: '✅ New session started. Previous context cleared.',
      };
    },
  });

  // New command - alias for reset
  registry.register({
    name: 'new',
    description: 'Start new conversation (alias for /reset)',
    handler: async (ctx) => {
      return {
        text: '✅ New session started. Previous context cleared.',
      };
    },
  });

  // Update command - pull latest from main and restart
  registry.register({
    name: 'update',
    description: 'Update FoxFang to the latest version from main',
    requireAuth: true,
    handler: async (ctx) => {
      const channel = ctx.message.channel;
      const chatId = ctx.message.chat?.id ?? ctx.message.from.id;
      const threadId = ctx.message.threadId;

      // Run update in the background so we can reply immediately
      setImmediate(async () => {
        const result = await runUpdate();

        if (result.status !== 'ok') {
          const reason = result.reason ?? 'unknown';
          await ctx.sendReply?.({
            text: `❌ Update failed (${reason}). The agent is still running on the previous version.`,
          });
          return;
        }

        // Write sentinel so the restarted daemon can notify the user
        await writeRestartSentinel({
          channel,
          chatId,
          threadId,
          message: '✅ FoxFang updated successfully. I\'m back online!',
          triggeredAt: Date.now(),
        });

        // Exit — the service manager (launchd / systemd) restarts the daemon
        await scheduleRespawnAndExit();
      });

      return {
        text: '⏳ Updating FoxFang from main branch... I\'ll notify you when done (or if something fails).',
      };
    },
  });
}
