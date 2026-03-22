/**
 * FoxFang Main Entry
 */

import dotenv from 'dotenv';
dotenv.config();

import { loadConfig } from './config/index';
import { initializeProviders } from './providers/index';
import { initializeTools, wireDelegateOrchestrator } from './tools/index';
import { AgentOrchestrator } from './agents/orchestrator';
import { SessionManager } from './sessions/manager';
import { Gateway } from './gateway/index';
import { initializeLogging } from './logging/index';
import { createWorkspaceManager, initFoxFangHome } from './workspace';

async function main() {
  console.log('🚀 Starting FoxFang...\n');
  
  try {
    // Initialize logging
    await initializeLogging();
    
    // Load configuration
    console.log('[1/5] Loading configuration...');
    const config = await loadConfig();
    console.log(`      Config loaded: ${config.defaultProvider} (${config.defaultModel})`);
    
    // Initialize providers
    console.log('[2/5] Initializing providers...');
    initializeProviders(config.providers);
    console.log(`      Initialized ${config.providers.length} provider(s)`);
    
    // Initialize tools
    console.log('[3/5] Initializing tools...');
    initializeTools(config.tools?.tools || {});
    console.log(`      Initialized tools`);
    
    // Create session manager and orchestrator
    console.log('[4/5] Initializing agent...');
    const sessionManager = new SessionManager(config.sessions);
    const foxfangHome = initFoxFangHome(config.workspace?.homeDir);
    const workspaceManager = createWorkspaceManager('default_user', foxfangHome);
    const orchestrator = new AgentOrchestrator(sessionManager, workspaceManager);
    wireDelegateOrchestrator(orchestrator);
    
    // Create and start gateway
    console.log('[5/5] Starting Gateway...');
    const gateway = new Gateway(orchestrator, {
      port: config.gateway.port,
      host: config.gateway.host,
      enableCors: config.gateway.enableCors,
      allowedOrigins: config.security.allowedOrigins,
    });
    
    await gateway.start();
    
    console.log('\n✅ FoxFang ready!');
    console.log(`   Provider: ${config.defaultProvider}`);
    console.log(`   Model: ${config.defaultModel}`);
    console.log(`   API: http://${config.gateway.host}:${config.gateway.port}`);
    console.log('');
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('\n👋 SIGTERM received. Shutting down gracefully...');
      await gateway.stop();
      process.exit(0);
    });
    
    process.on('SIGINT', async () => {
      console.log('\n👋 SIGINT received. Shutting down gracefully...');
      await gateway.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start:', error);
    process.exit(1);
  }
}

main();
