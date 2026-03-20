/**
 * Signal Channel Adapter
 *
 * Supports both APIs:
 * - signal-cli daemon JSON-RPC (`/api/v1/...`)
 * - bbernhard/signal-cli-rest-api (`/v1`, `/v2`)
 */

import type { ChannelAdapter, ChannelMessage, ChannelResponse } from '../types';
import { loadConfig } from '../../config';
import { stripMarkdown } from '../formatters';

interface SignalSseEvent {
  event?: string;
  data?: string;
  id?: string;
}

type SignalApiMode = 'daemon-rpc' | 'rest-wrapper';

export class SignalAdapter implements ChannelAdapter {
  readonly name = 'signal';
  readonly supportsEditing = true;
  connected = false;
  private apiMode: SignalApiMode = 'daemon-rpc';
  private phoneNumber: string = '';
  private httpUrl: string = 'http://127.0.0.1:8686';
  private messageHandler?: (msg: ChannelMessage) => Promise<ChannelResponse | void>;
  private abortController?: AbortController;

  /** Track sent messages for editing support */
  private sentMessages: Map<string, { to: string; timestamp: number }> = new Map();

  constructor() {}

  async connect(): Promise<void> {
    const config = await loadConfig();
    const signalConfig = config.channels?.signal;

    if (!signalConfig?.enabled || !signalConfig?.phoneNumber) {
      throw new Error('Signal not configured. Run: foxfang channel setup signal');
    }

    this.phoneNumber = signalConfig.phoneNumber;

    const normalizeUrl = (value: string): string => value.replace(/\/+$/, '');
    const candidateUrls = [
      process.env.SIGNAL_HTTP_URL || '',
      signalConfig.httpUrl || '',
      'http://signal-api:8080',
      'http://signal-cli:8080',
      'http://127.0.0.1:8686',
    ]
      .map((value) => value.trim())
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
      .map(normalizeUrl);

    const connectionErrors: string[] = [];
    let notRegisteredError = '';

    for (const candidate of candidateUrls) {
      try {
        const mode = await this.detectApiMode(candidate);
        if (!mode) {
          connectionErrors.push(
            `${candidate} (expected /api/v1/check for daemon RPC or /v1/health for signal-cli-rest-api)`
          );
          continue;
        }

        if (mode === 'rest-wrapper') {
          await this.ensureRestAccountRegistered(candidate);
        }

        this.httpUrl = candidate;
        this.apiMode = mode;
        this.connected = true;
        break;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!notRegisteredError && reason.includes('not registered on signal-api')) {
          notRegisteredError = reason;
        }
        connectionErrors.push(`${candidate} (${reason})`);
      }
    }

    if (!this.connected) {
      if (notRegisteredError) {
        throw new Error(notRegisteredError);
      }
      throw new Error(
        `Cannot connect to Signal API.\n` +
        `Tried:\n  - ${connectionErrors.join('\n  - ')}\n` +
        `Set SIGNAL_HTTP_URL to your Signal host, e.g. http://signal-api:8080`
      );
    }

    console.log(`[Signal] ✅ Connected to ${this.httpUrl} (${this.apiMode})`);

    this.startReceiveLoop();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.abortController?.abort();
    console.log('[Signal] Disconnected');
  }

  async send(to: string, content: string, _options?: { replyToMessageId?: string; threadId?: string }): Promise<string> {
    if (!this.connected) {
      throw new Error('Signal not connected');
    }

    try {
      const plainContent = stripMarkdown(content);
      const messageId = this.apiMode === 'daemon-rpc'
        ? await this.sendViaDaemonRpc(to, plainContent)
        : await this.sendViaRestWrapper(to, plainContent);

      const parsedTimestamp = this.parseTimestamp(messageId) || Date.now();
      this.sentMessages.set(messageId, { to, timestamp: parsedTimestamp });
      return messageId;
    } catch (error) {
      console.error('[Signal] Failed to send message:', error);
      throw error;
    }
  }

  async edit(messageId: string, newContent: string, to?: string): Promise<boolean> {
    if (!this.connected) {
      console.error('[Signal] Not connected');
      return false;
    }

    const sentMsg = this.sentMessages.get(messageId);
    if (!sentMsg) {
      console.error(`[Signal] Message ${messageId} not found in sent messages store`);
      return false;
    }

    const recipient = to || sentMsg.to;
    if (!recipient) {
      console.error('[Signal] No recipient specified for edit');
      return false;
    }

    try {
      const deleted = await this.remoteDelete(recipient, sentMsg.timestamp);
      if (!deleted) {
        console.warn('[Signal] Could not delete original message, sending edited version anyway');
      }

      const editedContent = `✏️ Edited: ${stripMarkdown(newContent)}`;
      const newMessageId = await this.send(recipient, editedContent);
      this.sentMessages.delete(messageId);
      return Boolean(newMessageId);
    } catch (error) {
      console.error('[Signal] Failed to edit message:', error);
      return false;
    }
  }

  async delete(messageId: string, to?: string): Promise<boolean> {
    if (!this.connected) {
      console.error('[Signal] Not connected');
      return false;
    }

    const sentMsg = this.sentMessages.get(messageId);
    if (!sentMsg) {
      console.error(`[Signal] Message ${messageId} not found in sent messages store`);
      return false;
    }

    const recipient = to || sentMsg.to;
    if (!recipient) {
      console.error('[Signal] No recipient specified for delete');
      return false;
    }

    try {
      const ok = await this.remoteDelete(recipient, sentMsg.timestamp);
      if (ok) {
        this.sentMessages.delete(messageId);
        console.log(`[Signal] Message deleted from ${recipient}`);
      }
      return ok;
    } catch (error) {
      console.error('[Signal] Failed to delete message:', error);
      return false;
    }
  }

  async sendTyping(to: string, _threadId?: string): Promise<void> {
    if (!this.connected) return;

    try {
      if (this.apiMode === 'daemon-rpc') {
        await this.callDaemonRpc('sendTyping', {
          account: this.phoneNumber,
          recipient: [to],
        });
        return;
      }

      await fetch(`${this.httpUrl}/v1/typing-indicator/${encodeURIComponent(this.phoneNumber)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: to }),
      });
    } catch {
      // Ignore typing errors
    }
  }

  async reactToMessage(messageId: string, emoji: string, to?: string): Promise<void> {
    if (!this.connected || !to) return;
    const timestamp = this.parseTimestamp(messageId);
    if (!timestamp) return;

    try {
      if (this.apiMode === 'daemon-rpc') {
        await this.callDaemonRpc('sendReaction', {
          account: this.phoneNumber,
          recipient: [to],
          targetTimestamp: timestamp,
          emoji,
        });
        return;
      }

      await fetch(`${this.httpUrl}/v1/reactions/${encodeURIComponent(this.phoneNumber)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: to,
          reaction: emoji,
          target_author: to,
          timestamp,
        }),
      });
    } catch {
      // Ignore reaction errors
    }
  }

  async removeReaction(messageId: string, to?: string): Promise<void> {
    if (!this.connected || !to) return;
    const timestamp = this.parseTimestamp(messageId);
    if (!timestamp) return;

    try {
      if (this.apiMode === 'daemon-rpc') {
        await this.callDaemonRpc('sendReaction', {
          account: this.phoneNumber,
          recipient: [to],
          targetTimestamp: timestamp,
          emoji: '',
          remove: true,
        });
        return;
      }

      await fetch(`${this.httpUrl}/v1/reactions/${encodeURIComponent(this.phoneNumber)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: to,
          reaction: '',
          target_author: to,
          timestamp,
        }),
      });
    } catch {
      // Ignore removal errors
    }
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<ChannelResponse | void>): void {
    this.messageHandler = handler;
  }

  private async detectApiMode(baseUrl: string): Promise<SignalApiMode | null> {
    try {
      const daemonCheck = await this.fetchWithTimeout(`${baseUrl}/api/v1/check`);
      if (daemonCheck.ok) {
        return 'daemon-rpc';
      }
    } catch {
      // ignore
    }

    try {
      const restHealth = await this.fetchWithTimeout(`${baseUrl}/v1/health`);
      if (restHealth.ok) {
        return 'rest-wrapper';
      }
    } catch {
      // ignore
    }

    try {
      const restAbout = await this.fetchWithTimeout(`${baseUrl}/v1/about`);
      if (restAbout.ok) {
        return 'rest-wrapper';
      }
    } catch {
      // ignore
    }

    return null;
  }

  private async fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 8000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...(init || {}), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureRestAccountRegistered(baseUrl: string): Promise<void> {
    const response = await this.fetchWithTimeout(`${baseUrl}/v1/accounts`);
    if (!response.ok) {
      throw new Error(`cannot read registered accounts (HTTP ${response.status})`);
    }

    const payload: any = await response.json().catch(() => []);
    const currentPhone = this.normalizePhone(this.phoneNumber);
    const registeredPhones = Array.isArray(payload)
      ? payload
          .map((item) => {
            if (typeof item === 'string') return this.normalizePhone(item);
            if (item && typeof item === 'object') {
              return this.normalizePhone((item as any).number || (item as any).username || '');
            }
            return '';
          })
          .filter(Boolean)
      : [];

    if (!registeredPhones.includes(currentPhone)) {
      throw new Error(
        `Signal account ${this.phoneNumber} is not registered on signal-api. ` +
        `Register/link this number first, then restart FoxFang.`
      );
    }
  }

  private async sendViaDaemonRpc(to: string, message: string): Promise<string> {
    const response = await this.callDaemonRpc('send', {
      account: this.phoneNumber,
      recipient: [to],
      message,
    });

    const fromResult = this.extractJsonRpcTimestamp(response);
    return String(fromResult || Date.now());
  }

  private async sendViaRestWrapper(to: string, message: string): Promise<string> {
    const response = await fetch(`${this.httpUrl}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: this.phoneNumber,
        recipients: [to],
        message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const payload: any = await response.json().catch(() => null);
    const timestamp = this.parseTimestamp(payload?.timestamp) || Date.now();
    return String(timestamp);
  }

  private async callDaemonRpc(method: string, params: Record<string, unknown>): Promise<any> {
    const response = await fetch(`${this.httpUrl}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Math.random().toString(36).slice(2, 11),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json().catch(() => ({}));
  }

  private extractJsonRpcTimestamp(payload: any): number | null {
    const result = payload?.result;
    if (!result) return null;

    const direct = this.parseTimestamp(result?.timestamp || result?.id);
    if (direct) return direct;

    if (Array.isArray(result?.timestamps) && result.timestamps.length > 0) {
      return this.parseTimestamp(result.timestamps[0]);
    }

    return null;
  }

  private parseTimestamp(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private normalizePhone(value: string): string {
    return value.trim().replace(/\s+/g, '');
  }

  private async remoteDelete(recipient: string, timestamp: number): Promise<boolean> {
    if (this.apiMode === 'daemon-rpc') {
      await this.callDaemonRpc('remoteDelete', {
        account: this.phoneNumber,
        recipient: [recipient],
        targetTimestamp: timestamp,
      });
      return true;
    }

    const response = await fetch(`${this.httpUrl}/v1/remote-delete/${encodeURIComponent(this.phoneNumber)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient,
        timestamp,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn(`[Signal] remote-delete failed: HTTP ${response.status} ${errorText}`);
      return false;
    }

    return true;
  }

  private startReceiveLoop(): void {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const runLoop = async () => {
      let reconnectDelay = 1000;

      while (this.connected && !signal.aborted) {
        try {
          if (this.apiMode === 'daemon-rpc') {
            await this.streamDaemonEvents(signal);
          } else {
            await this.streamRestEvents(signal);
          }
          reconnectDelay = 1000;
        } catch (error) {
          if (signal.aborted) return;
          console.log(`[Signal] Connection lost, reconnecting in ${reconnectDelay}ms...`);
          await this.sleep(reconnectDelay, signal);
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        }
      }
    };

    void runLoop();
  }

  private async streamDaemonEvents(abortSignal: AbortSignal): Promise<void> {
    const url = `${this.httpUrl}/api/v1/events?account=${encodeURIComponent(this.phoneNumber)}`;
    const response = await fetch(url, { signal: abortSignal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent: SignalSseEvent = {};

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent.event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentEvent.data = line.slice(5).trim();
        } else if (line.startsWith('id:')) {
          currentEvent.id = line.slice(3).trim();
        } else if (line === '' && currentEvent.data) {
          this.handleIncomingPayload(currentEvent.data);
          currentEvent = {};
        }
      }
    }
  }

  private async streamRestEvents(abortSignal: AbortSignal): Promise<void> {
    const receiveUrl =
      `${this.httpUrl}/v1/receive/${encodeURIComponent(this.phoneNumber)}` +
      '?timeout=5&ignore_attachments=true';
    const response = await this.fetchWithTimeout(receiveUrl, undefined, 15000);
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`receive failed: HTTP ${response.status} ${errorText}`);
    }

    const payload = await response.json().catch(() => null);
    this.handleIncomingPayload(payload);
    await this.sleep(250, abortSignal);
  }

  private handleIncomingPayload(raw: unknown): void {
    let data: any = raw;
    try {
      if (typeof raw === 'string') {
        data = JSON.parse(raw);
      }
    } catch {
      return;
    }

    if (Array.isArray(data)) {
      for (const item of data) {
        this.handleIncomingPayload(item);
      }
      return;
    }

    if (Array.isArray(data?.messages)) {
      for (const item of data.messages) {
        this.handleIncomingPayload(item);
      }
      return;
    }

    if (data?.envelope) {
      this.handleEnvelope(data.envelope);
      return;
    }

    if (data?.data?.envelope) {
      this.handleEnvelope(data.data.envelope);
    }
  }

  private handleEnvelope(envelope: any): void {
    if (!this.messageHandler) return;

    const dataMessage = envelope?.dataMessage;
    if (!dataMessage?.message) return;

    const source = envelope?.source || envelope?.sourceNumber || '';
    const sourceName = envelope?.sourceName || source || 'Signal';
    const groupId = dataMessage?.groupInfo?.groupId || dataMessage?.groupV2?.id || '';
    const timestamp = this.parseTimestamp(envelope?.timestamp) || Date.now();
    const chatId = groupId || source || sourceName;
    const from = source && sourceName !== source
      ? `${sourceName} (${source})`
      : sourceName;

    const channelMsg: ChannelMessage = {
      id: String(timestamp),
      channel: 'signal',
      from,
      content: dataMessage.message,
      timestamp: new Date(timestamp),
      threadId: groupId || undefined,
      metadata: {
        chatId,
        chatType: groupId ? 'group' : 'private',
        sourcePhone: source,
      },
    };

    this.messageHandler(channelMsg).catch((err) => {
      console.error('[Signal] Error:', err);
    });
  }

  private sleep(ms: number, abortSignal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (abortSignal.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const timeout = setTimeout(resolve, ms);
      abortSignal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Aborted'));
      }, { once: true });
    });
  }
}
