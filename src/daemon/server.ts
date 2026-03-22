/**
 * Daemon Server
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

export interface DaemonServerOptions {
  port: number;
  host: string;
}

export async function startDaemonServer(options: DaemonServerOptions): Promise<void> {
  const app = express();
  
  app.use(cors());
  app.use(express.json());
  
  // Health endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      version: process.env.npm_package_version || '0.0.0',
      uptime: process.uptime(),
    });
  });
  
  // Agent run endpoint
  app.post('/agent/run', async (req, res) => {
    try {
      const { message, sessionId, agentId, model, provider } = req.body;
      
      // Import and run agent
      const { AgentOrchestrator } = await import('../agents/orchestrator');
      const { SessionManager } = await import('../sessions/manager');
      const { loadConfig } = await import('../config/index');
      const { initializeProviders } = await import('../providers/index');
      const { initializeTools, wireDelegateOrchestrator } = await import('../tools/index');
      const { createWorkspaceManager, initFoxFangHome } = await import('../workspace');
      
      const config = await loadConfig();
      initializeProviders(config.providers);
      initializeTools(config.tools?.tools || {});
      
      const sessionManager = new SessionManager(config.sessions);
      const foxfangHome = initFoxFangHome(config.workspace?.homeDir);
      const workspaceManager = createWorkspaceManager('default_user', foxfangHome);
      const orchestrator = new AgentOrchestrator(sessionManager, workspaceManager);
      wireDelegateOrchestrator(orchestrator);
      
      const result = await orchestrator.run({
        sessionId: sessionId || `daemon-${Date.now()}`,
        agentId: agentId || 'default',
        message,
        model,
        provider,
        stream: false,
      });
      
      res.json({ success: true, content: result.content });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  
  // Create HTTP server
  const server = createServer(app);
  
  return new Promise((resolve, reject) => {
    server.listen(options.port, options.host, () => {
      console.log(`Daemon listening on http://${options.host}:${options.port}`);
      resolve();
    });
    
    server.on('error', reject);
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down...');
      server.close(() => {
        process.exit(0);
      });
    });
  });
}
