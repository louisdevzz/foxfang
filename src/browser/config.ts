/**
 * Browser Config
 * 
 * Configuration management for browser service
 */

import { join } from 'path';
import { homedir } from 'os';
import type { BrowserConfig, BrowserProfile } from './types';

const DEFAULT_PORT = 9222;
const DEFAULT_HOST = 'localhost';

export function getDefaultBrowserConfig(): BrowserConfig {
  return {
    enabled: false,
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    headless: true,
    defaultProfile: 'default',
    profiles: {
      default: {
        name: 'default',
        headless: true,
      },
    },
    autoStart: true,
    userDataDir: join(homedir(), '.foxfang', 'browser', 'profiles', 'default'),
  };
}

export function resolveBrowserConfig(userConfig?: Partial<BrowserConfig>): BrowserConfig {
  const defaults = getDefaultBrowserConfig();
  
  return {
    ...defaults,
    ...userConfig,
    profiles: {
      ...defaults.profiles,
      ...userConfig?.profiles,
    },
  };
}

export function getProfileConfig(config: BrowserConfig, profileName?: string): BrowserProfile {
  const name = profileName || config.defaultProfile;
  const profile = config.profiles[name];
  
  if (!profile) {
    // Return default profile if specified one doesn't exist
    return config.profiles[config.defaultProfile] || {
      name: 'default',
      headless: config.headless,
    };
  }
  
  return {
    headless: config.headless,
    ...profile,
    name,
  };
}

export function getUserDataDir(config: BrowserConfig, profileName?: string): string {
  const profile = getProfileConfig(config, profileName);
  return profile.userDataDir || join(
    homedir(), 
    '.foxfang', 
    'browser', 
    'profiles', 
    profile.name
  );
}
