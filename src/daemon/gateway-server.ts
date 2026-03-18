#!/usr/bin/env node
/**
 * FoxFang Gateway Server
 * 
 * Runs as a persistent service, manages:
 * - WebSocket connections from CLI
 * - Channel connections (Telegram, Discord, Slack, Signal)
 * - Message routing between channels and agents
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'url';
import { loadConfigWithCredentials } from '../config/index';
import { initializeProviders } from '../providers/index';
import { AgentOrchestrator } from '../agents/orchestrator';
import { SessionManager } from '../sessions/manager';
import { initializeTools } from '../tools/index';
import { setDefaultProvider } from '../agents/runtime';
import { ChannelManager } from '../channels/manager';

const PORT = parseInt(process.env.FOXFANG_GATEWAY_PORT || '8787', 10);
const CHANNELS = (process.env.FOXFANG_CHANNELS || '').split(',').filter(Boolean);

interface ClientConnection {
  ws: WebSocket;
  id: string;
  type: 'cli' | 'channel';
  channelName?: string;
}

class GatewayServer {
  private wss: WebSocketServer;
  private clients: Map<string, ClientConnection> = new Map();
  private orchestrator: AgentOrchestrator | null = null;
  private sessionManager: SessionManager | null = null;
  private channelManager: ChannelManager;

  constructor(port: number) {
    const server = createServer();
    this.wss = new WebSocketServer({ server });
    this.channelManager = new ChannelManager(CHANNELS);
    
    this.setupWebSocket();
    this.initialize();
    
    server.listen(port, () => {
      console.log(`[Gateway] Server listening on port ${port}`);
      console.log(`[Gateway] Channels enabled: ${CHANNELS.join(', ') || 'none'}`);
    });
  }

  private async initialize(): Promise<void> {
    // Initialize agents
    await this.initializeAgents();
    
    // Connect channels
    if (CHANNELS.length > 0) {
      this.channelManager.setOrchestrator(this.orchestrator!);
      await this.channelManager.connectAll();
    }
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws, req) => {
      const { query } = parse(req.url || '', true);
      const clientType = query.type as string || 'cli';
      const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const connection: ClientConnection = {
        ws,
        id: clientId,
        type: clientType as 'cli' | 'channel',
        channelName: query.channel as string | undefined,
      };
      
      this.clients.set(clientId, connection);
      console.log(`[Gateway] Client connected: ${clientId} (${clientType})`);
      
      ws.on('message', (data) => this.handleMessage(clientId, data));
      ws.on('close', () => this.handleDisconnect(clientId));
      ws.on('error', (err) => console.error(`[Gateway] Client ${clientId} error:`, err));
      
      // Send welcome
      this.sendToClient(clientId, {
        type: 'connected',
        clientId,
        gatewayVersion: '1.0.0',
      });
    });
  }

  private async handleMessage(clientId: string, data: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    try {
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const message = JSON.parse(dataBuffer.toString());
      console.log(`[Gateway] Message from ${clientId}:`, message.type);
      
      switch (message.type) {
        case 'chat':
          await this.handleChatMessage(clientId, message);
          break;
        case 'channel:message':
          await this.handleChannelMessage(clientId, message);
          break;
        case 'ping':
          this.sendToClient(clientId, { type: 'pong' });
          break;
        case 'status':
          this.sendToClient(clientId, {
            type: 'status',
            clients: this.clients.size,
            channels: Array.from(this.clients.values())
              .filter(c => c.type === 'channel')
              .map(c => c.channelName),
          });
          break;
        default:
          console.log(`[Gateway] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error(`[Gateway] Error handling message:`, err);
      this.sendToClient(clientId, {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleChatMessage(clientId: string, message: any): Promise<void> {
    if (!this.orchestrator) {
      await this.initializeAgents();
    }
    
    if (!this.orchestrator) {
      this.sendToClient(clientId, { type: 'error', error: 'Orchestrator not available' });
      return;
    }
    
    // Stream response
    const result = await this.orchestrator.run({
      sessionId: message.sessionId || `gateway-${Date.now()}`,
      agentId: message.agentId || 'orchestrator',
      message: message.content,
      projectId: message.projectId,
      stream: true,
    });
    
    if (result.stream) {
      for await (const chunk of result.stream) {
        this.sendToClient(clientId, {
          type: 'chat:chunk',
          chunk,
        });
      }
      
      this.sendToClient(clientId, { type: 'chat:done' });
    }
  }

  private async handleChannelMessage(clientId: string, message: any): Promise<void> {
    // Handle incoming messages from channels (Telegram, Discord, etc.)
    console.log(`[Gateway] Channel message from ${clientId}:`, message.channel, message.content);
    
    // TODO: Route to appropriate agent and send response back to channel
    this.sendToClient(clientId, {
      type: 'channel:ack',
      messageId: message.messageId,
    });
  }

  private async initializeAgents(): Promise<void> {
    const config = await loadConfigWithCredentials();
    initializeProviders(config.providers);
    setDefaultProvider(config.defaultProvider);
    initializeTools(config.tools?.tools || {});
    
    this.sessionManager = new SessionManager(config.sessions);
    this.orchestrator = new AgentOrchestrator(this.sessionManager);
    
    console.log('[Gateway] Agents initialized');
  }

  private handleDisconnect(clientId: string): void {
    this.clients.delete(clientId);
    console.log(`[Gateway] Client disconnected: ${clientId}`);
  }

  private sendToClient(clientId: string, data: any): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  public broadcast(data: any): void {
    const message = JSON.stringify(data);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

// Start server
const server = new GatewayServer(PORT);

// Handle process signals
process.on('SIGTERM', async () => {
  console.log('[Gateway] SIGTERM received, shutting down...');
  await server['channelManager'].disconnectAll();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Gateway] SIGINT received, shutting down...');
  await server['channelManager'].disconnectAll();
  process.exit(0);
});
