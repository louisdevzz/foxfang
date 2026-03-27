/**
 * Browser Service - Main Entry Point
 * 
 * Foxfang Browser Automation Service
 * Compatible with OpenClaw's browser API
 */

// Types
export * from './types';

// Config
export * from './config';

// Chrome launcher
export * from './chrome';

// Profile management
export { ProfileManager } from './profiles';

// Server
export {
  startBrowserServer,
  stopBrowserServer,
  getBrowserServer,
  isServerRunning,
  autoStartBrowserServer,
} from './server';

// Server context
export {
  createBrowserServerState,
  getBrowserServerState,
  getOrCreateState,
  clearBrowserServerState,
  getProfileManager,
  getStatus,
  listKnownProfiles,
} from './server-context';

// Snapshot
export { takeSnapshot, findElementByRef } from './snapshot';

// Actions
export { performAction } from './act';
