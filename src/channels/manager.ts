/**
 * Channel Manager
 * 
 * Manages all channel connections and routes messages between
 * channels and the agent orchestrator.
 */

import { SignalAdapter } from './adapters/signal';
import type { ChannelAdapter, ChannelMessage, ChannelResponse, StreamChunk } from './types';
import type { AgentOrchestrator } from '../agents/orchestrator';

export class ChannelManager {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private orchestrator: AgentOrchestrator | null = null;
  private enabledChannels: string[] = [];

  constructor(channels: string[] = []) {
    this.enabledChannels = channels;
  }

  setOrchestrator(orchestrator: AgentOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  async connectAll(): Promise<void> {
    for (const channelName of this.enabledChannels) {
      try {
        await this.connectChannel(channelName);
      } catch (error) {
        // Log warning but don't crash - channel may be started later
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[ChannelManager] ⚠️  ${channelName} not available: ${errorMsg.split('\n')[0]}`);
        console.warn(`[ChannelManager]    Gateway will run without ${channelName}. Start it and restart daemon to enable.`);
      }
    }
  }

  async connectChannel(name: string): Promise<void> {
    if (this.adapters.has(name)) {
      console.log(`[ChannelManager] ${name} already connected`);
      return;
    }

    const adapter = this.createAdapter(name);
    if (!adapter) {
      throw new Error(`Unknown channel: ${name}`);
    }

    // Set up message handler
    adapter.onMessage(async (msg: ChannelMessage) => {
      return this.handleChannelMessage(msg);
    });

    await adapter.connect();
    this.adapters.set(name, adapter);
  }

  async disconnectAll(): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.disconnect();
        console.log(`[ChannelManager] ${name} disconnected`);
      } catch (error) {
        console.error(`[ChannelManager] Error disconnecting ${name}:`, error);
      }
    }
    this.adapters.clear();
  }

  async disconnectChannel(name: string): Promise<void> {
    const adapter = this.adapters.get(name);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(name);
    }
  }

  getConnectedChannels(): string[] {
    return Array.from(this.adapters.keys());
  }

  isConnected(name: string): boolean {
    return this.adapters.has(name);
  }

  private createAdapter(name: string): ChannelAdapter | null {
    switch (name) {
      case 'signal':
        return new SignalAdapter();
      // Add more channels here:
      // case 'telegram': return new TelegramAdapter();
      // case 'discord': return new DiscordAdapter();
      // case 'slack': return new SlackAdapter();
      default:
        return null;
    }
  }

  private async handleChannelMessage(msg: ChannelMessage): Promise<ChannelResponse | void> {
    console.log(`[ChannelManager] 📩 ${msg.channel}:${msg.from.split(' ')[0]}: ${msg.content.substring(0, 40)}${msg.content.length > 40 ? '...' : ''}`);

    if (!this.orchestrator) {
      console.error('[ChannelManager] No orchestrator set');
      return;
    }

    try {
      // Process through agent with streaming
      const result = await this.orchestrator.run({
        sessionId: `channel-${msg.channel}-${msg.from}`,
        agentId: 'orchestrator',
        message: `[From ${msg.channel}:${msg.from}] ${msg.content}`,
        stream: true,
      });

      if (result.stream) {
        // Stream response back to channel
        return this.streamResponse(msg, result.stream);
      } else if (result.content) {
        // Fallback to non-streaming
        return {
          messageId: msg.id,
          content: result.content,
        };
      }
    } catch (error) {
      console.error('[ChannelManager] Error processing message:', error);
      return {
        messageId: msg.id,
        content: 'Sorry, I encountered an error processing your message.',
      };
    }
  }

  private async streamResponse(
    msg: ChannelMessage, 
    stream: AsyncIterable<{ type: 'text' | 'done' | 'tool_call'; content?: string }>
  ): Promise<ChannelResponse | void> {
    const adapter = this.adapters.get(msg.channel);
    if (!adapter) return;

    // Collect chunks and send in blocks (similar to OpenClaw's block streaming)
    const chunks: string[] = [];
    const MIN_BLOCK_SIZE = 200;  // Minimum chars before sending
    const MAX_BLOCK_SIZE = 2000; // Maximum chars per message
    let buffer = '';

    for await (const chunk of stream) {
      // Skip tool calls for channel streaming
      if (chunk.type === 'tool_call') continue;
      
      if (chunk.type === 'text' && chunk.content) {
        chunks.push(chunk.content);
        buffer += chunk.content;

        // Send block if we have enough content
        if (buffer.length >= MIN_BLOCK_SIZE) {
          // Try to break at sentence boundary
          const breakPoint = this.findBreakPoint(buffer, MAX_BLOCK_SIZE);
          const toSend = buffer.slice(0, breakPoint).trim();
          buffer = buffer.slice(breakPoint).trim();

          if (toSend) {
            console.log(`[ChannelManager] 📤 Streaming block (${toSend.length} chars)`);
            await adapter.send(msg.from, toSend);
          }
        }
      }
    }

    // Send remaining buffer
    if (buffer.trim()) {
      await adapter.send(msg.from, buffer.trim());
    }

    const fullContent = chunks.join('');
    return {
      messageId: msg.id,
      content: fullContent,
    };
  }

  private findBreakPoint(text: string, maxChars: number): number {
    // Prefer breaking at paragraph, then sentence, then word boundary
    if (text.length <= maxChars) return text.length;

    // Look for paragraph break
    const paraIndex = text.lastIndexOf('\n\n', maxChars);
    if (paraIndex > maxChars * 0.5) return paraIndex + 2;

    // Look for sentence break
    const sentenceMatch = text.slice(0, maxChars).match(/[.!?]\s+/g);
    if (sentenceMatch) {
      const lastSentence = text.lastIndexOf(sentenceMatch[sentenceMatch.length - 1], maxChars);
      if (lastSentence > maxChars * 0.5) return lastSentence + 2;
    }

    // Look for word break
    const spaceIndex = text.lastIndexOf(' ', maxChars);
    if (spaceIndex > maxChars * 0.5) return spaceIndex + 1;

    // Hard break at max
    return maxChars;
  }
}
