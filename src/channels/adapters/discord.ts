/**
 * Discord Channel Adapter - Full Implementation
 * 
 * Features:
 * - WebSocket Gateway connection
 * - Automatic reconnection with heartbeat
 * - Typing indicators
 * - Message replies
 * - Thread support
 * - Slash commands (future)
 * 
 * Setup:
 * 1. Create app at https://discord.com/developers/applications
 * 2. Enable Message Content Intent
 * 3. Get bot token
 * 4. Configure: pnpm foxfang wizard channels
 */

import type { ChannelAdapter, ChannelMessage, ChannelResponse } from '../types';
import { loadConfig } from '../../config';

// Discord Gateway Opcodes
enum GatewayOpcode {
  Dispatch = 0,
  Heartbeat = 1,
  Identify = 2,
  PresenceUpdate = 3,
  VoiceStateUpdate = 4,
  Resume = 6,
  Reconnect = 7,
  RequestGuildMembers = 8,
  InvalidSession = 9,
  Hello = 10,
  HeartbeatAck = 11,
}

// Discord Gateway Events
interface GatewayPayload {
  op: GatewayOpcode;
  d?: any;
  s?: number;
  t?: string;
}

interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
    discriminator?: string;
    global_name?: string;
  };
  channel_id: string;
  guild_id?: string;
  timestamp: string;
  referenced_message?: DiscordMessage;
  thread?: {
    id: string;
    name: string;
  };
  type: number;
}

interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  guild_id?: string;
}

// WebSocket close codes that should trigger reconnect
const RECONNECT_CLOSE_CODES = [1001, 1006, 1011, 1012, 1013, 1014, 1015, 4000, 4001, 4002, 4003, 4005, 4007, 4008, 4009];

// Exponential backoff config
const BACKOFF_CONFIG = {
  initialMs: 1000,
  maxMs: 60000,
  factor: 2,
  jitter: 0.25,
};

export class DiscordAdapter implements ChannelAdapter {
  readonly name = 'discord';
  connected = false;
  private botToken: string = '';
  private baseUrl: string = 'https://discord.com/api/v10';
  private ws?: WebSocket;
  private messageHandler?: (msg: ChannelMessage) => Promise<ChannelResponse | void>;
  private abortController?: AbortController;
  
  // Gateway state
  private sessionId?: string;
  private sequenceNumber?: number;
  private heartbeatInterval?: NodeJS.Timeout;
  private heartbeatAckReceived = true;
  private reconnectAttempts = 0;
  private reconnectTimeout?: NodeJS.Timeout;
  private gatewayUrl?: string;
  private botInfo?: { id: string; username: string; discriminator: string };
  
  // Intents (Message Content + Guild Messages + Direct Messages)
  private readonly intents = 1 << 15 | 1 << 9 | 1 << 12;

  constructor() {}

  async connect(): Promise<void> {
    const config = await loadConfig();
    const discordConfig = config.channels?.discord;
    
    if (!discordConfig?.enabled || !discordConfig?.botToken) {
      throw new Error(
        'Discord not configured. Run: pnpm foxfang wizard channels\n' +
        'Create bot at: https://discord.com/developers/applications'
      );
    }

    this.botToken = discordConfig.botToken;

    // Verify token and get bot info
    try {
      const response = await this.apiCall<{ id: string; username: string; discriminator: string }>('users/@me');
      this.botInfo = response;
      console.log(`[Discord] ✅ Connected as ${response?.username}#${response?.discriminator || '0000'}`);
    } catch (error: any) {
      throw new Error(
        `Cannot connect to Discord API: ${error?.message || 'Unknown error'}\n` +
        `Make sure your bot token is valid and has Message Content Intent enabled`
      );
    }

    this.connected = true;
    this.reconnectAttempts = 0;
    
    // Start Gateway connection
    await this.connectGateway();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.abortController?.abort();
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
    
    console.log('[Discord] Disconnected');
  }

  async send(to: string, content: string, options?: { replyToId?: string }): Promise<void> {
    if (!this.connected) {
      throw new Error('Discord not connected');
    }

    try {
      const body: Record<string, any> = { content };
      
      if (options?.replyToId) {
        body.message_reference = {
          message_id: options.replyToId,
        };
      }

      await this.apiCall(`channels/${to}/messages`, 'POST', body);
    } catch (error) {
      console.error('[Discord] Failed to send message:', error);
      throw error;
    }
  }

  async sendTyping(to: string, _threadId?: string): Promise<void> {
    if (!this.connected) return;

    try {
      await this.apiCall(`channels/${to}/typing`, 'POST');
    } catch {
      // Ignore typing indicator errors
    }
  }

  async reactToMessage(messageId: string, emoji: string, channelId?: string): Promise<void> {
    if (!this.connected || !channelId) return;

    try {
      // Discord emoji format: url encode for custom emojis (name:id), plain for unicode
      const encodedEmoji = encodeURIComponent(emoji);
      await this.apiCall(`channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`, 'PUT');
    } catch {
      // Ignore reaction errors
    }
  }

  async removeReaction(messageId: string, channelId?: string): Promise<void> {
    if (!this.connected || !channelId) return;

    try {
      // Remove all reactions by the bot user
      await this.apiCall(`channels/${channelId}/messages/${messageId}/reactions/@me`, 'DELETE');
    } catch {
      // Ignore removal errors
    }
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse | void>): void {
    this.messageHandler = handler;
  }

  getBotInfo(): { id: string; username: string; discriminator: string } | undefined {
    return this.botInfo;
  }

  private async connectGateway(): Promise<void> {
    if (!this.connected) return;

    try {
      // Get Gateway URL
      const gatewayInfo = await this.apiCall<{ url: string; session_start_limit?: { remaining: number } }>('gateway/bot');
      
      if (gatewayInfo.session_start_limit && gatewayInfo.session_start_limit.remaining === 0) {
        throw new Error('Discord session start limit reached. Wait before reconnecting.');
      }

      this.gatewayUrl = `${gatewayInfo.url}/?v=10&encoding=json`;
      
      // Connect WebSocket
      this.ws = new WebSocket(this.gatewayUrl);
      
      this.ws.onopen = () => {
        console.log('[Discord] 🔌 Gateway connected');
      };
      
      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as GatewayPayload;
          this.handleGatewayPayload(payload);
        } catch (error) {
          console.error('[Discord] Failed to parse gateway message:', error);
        }
      };
      
      this.ws.onclose = (event) => {
        console.log(`[Discord] Gateway closed: ${event.code} ${event.reason}`);
        
        if (this.connected && RECONNECT_CLOSE_CODES.includes(event.code)) {
          this.handleReconnect();
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('[Discord] Gateway error:', error);
      };
      
    } catch (error) {
      console.error('[Discord] Failed to connect gateway:', error);
      this.handleReconnect();
    }
  }

  private handleGatewayPayload(payload: GatewayPayload): void {
    switch (payload.op) {
      case GatewayOpcode.Hello:
        // Start heartbeat
        const heartbeatInterval = payload.d.heartbeat_interval;
        this.startHeartbeat(heartbeatInterval);
        
        // Identify or Resume
        if (this.sessionId && this.sequenceNumber) {
          this.sendResume();
        } else {
          this.sendIdentify();
        }
        break;
        
      case GatewayOpcode.HeartbeatAck:
        this.heartbeatAckReceived = true;
        break;
        
      case GatewayOpcode.InvalidSession:
        console.log('[Discord] Invalid session, re-identifying...');
        this.sessionId = undefined;
        this.sequenceNumber = undefined;
        setTimeout(() => this.sendIdentify(), payload.d ? 0 : 5000);
        break;
        
      case GatewayOpcode.Reconnect:
        console.log('[Discord] Server requested reconnect');
        this.ws?.close(4000, 'Server requested reconnect');
        break;
        
      case GatewayOpcode.Dispatch:
        // Update sequence number
        if (payload.s !== undefined) {
          this.sequenceNumber = payload.s;
        }
        
        // Handle events
        this.handleDispatch(payload.t!, payload.d);
        break;
    }
  }

  private handleDispatch(eventType: string, data: any): void {
    switch (eventType) {
      case 'READY':
        this.sessionId = data.session_id;
        this.reconnectAttempts = 0; // Reset on successful connection
        console.log(`[Discord] ✅ Ready! Session: ${this.sessionId?.slice(0, 8)}...`);
        break;
        
      case 'MESSAGE_CREATE':
        this.handleMessageCreate(data as DiscordMessage);
        break;
        
      case 'RESUMED':
        console.log('[Discord] ✅ Session resumed');
        this.reconnectAttempts = 0;
        break;
    }
  }

  private handleMessageCreate(message: DiscordMessage): void {
    // Skip messages from the bot itself
    if (message.author.id === this.botInfo?.id) return;
    
    // Skip messages without content
    if (!message.content?.trim()) return;

    const channelMsg: ChannelMessage = {
      id: message.id,
      channel: 'discord',
      from: `${message.author.username}#${message.author.discriminator || '0000'}`,
      content: message.content,
      timestamp: new Date(message.timestamp),
      metadata: {
        channelId: message.channel_id,
        guildId: message.guild_id,
        authorId: message.author.id,
        isReply: !!message.referenced_message,
        replyToMessageId: message.referenced_message?.id,
      },
    };

    if (this.messageHandler) {
      this.messageHandler(channelMsg).catch(error => {
        console.error('[Discord] Message handler error:', error);
      });
    }
  }

  private startHeartbeat(interval: number): void {
    // Send first heartbeat after jitter
    const jitter = Math.random() * interval;
    
    setTimeout(() => {
      this.sendHeartbeat();
      
      this.heartbeatInterval = setInterval(() => {
        if (!this.heartbeatAckReceived) {
          console.error('[Discord] Heartbeat not acknowledged, reconnecting...');
          this.ws?.close(4000, 'Heartbeat timeout');
          return;
        }
        
        this.heartbeatAckReceived = false;
        this.sendHeartbeat();
      }, interval);
    }, jitter);
  }

  private sendHeartbeat(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        op: GatewayOpcode.Heartbeat,
        d: this.sequenceNumber ?? null,
      }));
    }
  }

  private sendIdentify(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        op: GatewayOpcode.Identify,
        d: {
          token: this.botToken,
          intents: this.intents,
          properties: {
            os: process.platform,
            browser: 'foxfang',
            device: 'foxfang',
          },
        },
      }));
    }
  }

  private sendResume(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        op: GatewayOpcode.Resume,
        d: {
          token: this.botToken,
          session_id: this.sessionId,
          seq: this.sequenceNumber,
        },
      }));
    }
  }

  private handleReconnect(): void {
    if (!this.connected) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      BACKOFF_CONFIG.initialMs * Math.pow(BACKOFF_CONFIG.factor, this.reconnectAttempts - 1),
      BACKOFF_CONFIG.maxMs
    );
    const jitter = delay * BACKOFF_CONFIG.jitter * (Math.random() - 0.5);
    const finalDelay = Math.max(0, delay + jitter);

    console.log(`[Discord] 🔄 Reconnecting in ${Math.round(finalDelay / 1000)}s (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimeout = setTimeout(() => {
      this.connectGateway();
    }, finalDelay);
  }

  private async apiCall<T>(endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET', body?: any): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.botToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://github.com/foxfang/foxfang, 1.0.0)',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(errorData?.message || `HTTP ${response.status}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
