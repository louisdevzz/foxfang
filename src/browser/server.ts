/**
 * Browser Server
 * 
 * HTTP server for browser automation
 */

import { createServer, type Server } from 'http';
import type { BrowserConfig } from './types';
import { getOrCreateState, clearBrowserServerState } from './server-context';
import { resolveBrowserConfig } from './config';
import { createRouteHandler } from './server-routes';

let serverInstance: Server | null = null;

export interface StartServerOptions {
  config?: Partial<BrowserConfig>;
  port?: number;
  host?: string;
}

export async function startBrowserServer(options: StartServerOptions = {}): Promise<Server> {
  const { config: userConfig, port, host } = options;

  // Stop existing server if any
  if (serverInstance) {
    await stopBrowserServer();
  }

  // Resolve configuration
  const config = resolveBrowserConfig(userConfig);
  
  // Create server state
  const state = getOrCreateState(config);

  // Create HTTP server
  const requestHandler = createRouteHandler(state);
  const server = createServer(requestHandler);

  // Start listening
  const listenPort = port || config.port;
  const listenHost = host || config.host;

  await new Promise<void>((resolve, reject) => {
    server.listen(listenPort, listenHost, () => {
      console.log(`[BrowserServer] Started on http://${listenHost}:${listenPort}`);
      resolve();
    });

    server.on('error', (err) => {
      reject(err);
    });
  });

  serverInstance = server;
  return server;
}

export async function stopBrowserServer(): Promise<void> {
  if (!serverInstance) {
    return;
  }

  await new Promise<void>((resolve) => {
    serverInstance?.close(() => {
      console.log('[BrowserServer] Stopped');
      resolve();
    });
  });

  serverInstance = null;
  clearBrowserServerState();
}

export function getBrowserServer(): Server | null {
  return serverInstance;
}

export function isServerRunning(): boolean {
  return !!serverInstance;
}

// Auto-start server if configured
export async function autoStartBrowserServer(config?: BrowserConfig): Promise<void> {
  if (!config?.enabled || !config?.autoStart) {
    return;
  }

  if (isServerRunning()) {
    return;
  }

  try {
    await startBrowserServer({ config });
  } catch (error) {
    console.error('[BrowserServer] Auto-start failed:', error);
  }
}
