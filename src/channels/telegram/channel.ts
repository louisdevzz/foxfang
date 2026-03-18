/**
 * Telegram Channel
 */

export interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
}

export interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    username: string;
  };
  chat: {
    id: number;
    type: string;
  };
  text: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export class TelegramChannel {
  private config: TelegramConfig;
  private baseUrl: string;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.baseUrl = `https://api.telegram.org/bot${config.botToken}`;
  }

  async initialize(): Promise<void> {
    // Verify token by calling getMe
    const response = await fetch(`${this.baseUrl}/getMe`);
    const data = await response.json() as TelegramApiResponse<{ id: number; username: string; first_name: string }>;
    
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }
  }

  async getBotInfo(): Promise<{ id: number; username: string; first_name: string }> {
    const response = await fetch(`${this.baseUrl}/getMe`);
    const data = await response.json() as TelegramApiResponse<{ id: number; username: string; first_name: string }>;
    
    if (!data.ok || !data.result) {
      throw new Error(data.description || 'Unknown error');
    }
    
    return data.result;
  }

  async sendMessage(chatId: string | number, text: string): Promise<TelegramMessage> {
    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    
    const data = await response.json() as TelegramApiResponse<TelegramMessage>;
    
    if (!data.ok || !data.result) {
      throw new Error(data.description || 'Unknown error');
    }
    
    return data.result;
  }

  async getUpdates(offset?: number): Promise<TelegramMessage[]> {
    const url = new URL(`${this.baseUrl}/getUpdates`);
    if (offset) url.searchParams.append('offset', offset.toString());
    
    const response = await fetch(url.toString());
    const data = await response.json() as TelegramApiResponse<Array<{ message?: TelegramMessage }>>;
    
    if (!data.ok) {
      throw new Error(data.description || 'Unknown error');
    }
    
    return (data.result || []).map(update => update.message).filter((m): m is TelegramMessage => !!m);
  }

  async startWebhook(callback: (message: TelegramMessage) => Promise<void>): Promise<void> {
    // Poll for updates
    let offset = 0;
    
    while (true) {
      try {
        const updates = await this.getUpdates(offset);
        
        for (const message of updates) {
          await callback(message);
          offset = message.message_id + 1;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Telegram polling error:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
}
