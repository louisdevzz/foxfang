/**
 * Discord Channel
 */

export interface DiscordConfig {
  enabled: boolean;
  botToken?: string;
}

export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
  };
  channel_id: string;
}

interface DiscordApiError {
  message: string;
}

export class DiscordChannel {
  private config: DiscordConfig;
  private baseUrl = 'https://discord.com/api/v10';

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Verify token
    const response = await fetch(`${this.baseUrl}/users/@me`, {
      headers: {
        Authorization: `Bot ${this.config.botToken}`,
      },
    });
    
    if (!response.ok) {
      const error = await response.json() as DiscordApiError;
      throw new Error(`Discord API error: ${error.message || response.status}`);
    }
  }

  async sendMessage(channelId: string, content: string): Promise<DiscordMessage> {
    const response = await fetch(`${this.baseUrl}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.config.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    
    if (!response.ok) {
      const error = await response.json() as DiscordApiError;
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    
    return response.json() as Promise<DiscordMessage>;
  }

  async getBotInfo(): Promise<{ id: string; username: string; discriminator: string }> {
    const response = await fetch(`${this.baseUrl}/users/@me`, {
      headers: {
        Authorization: `Bot ${this.config.botToken}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return response.json() as Promise<{ id: string; username: string; discriminator: string }>;
  }

  async startGateway(callback: (message: DiscordMessage) => Promise<void>): Promise<void> {
    // Connect to Discord Gateway for real-time messages
    const gateway = await fetch(`${this.baseUrl}/gateway/bot`, {
      headers: {
        Authorization: `Bot ${this.config.botToken}`,
      },
    });
    
    const data = await gateway.json() as { url: string };
    
    // WebSocket connection would go here
    console.log('Discord Gateway connected:', data.url);
  }
}
