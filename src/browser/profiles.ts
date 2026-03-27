/**
 * Profile Management
 * 
 * Manage browser profiles and their runtimes
 */

import type { BrowserConfig, BrowserProfile, BrowserRuntime, ProfileStatus } from './types';
import { getProfileConfig, getUserDataDir } from './config';
import { launchChrome, stopChrome, type LaunchedChrome } from './chrome';

export class ProfileManager {
  private runtimes: Map<string, BrowserRuntime> = new Map();
  private config: BrowserConfig;

  constructor(config: BrowserConfig) {
    this.config = config;
  }

  getConfig(): BrowserConfig {
    return this.config;
  }

  updateConfig(config: BrowserConfig): void {
    this.config = config;
  }

  async startProfile(profileName?: string): Promise<BrowserRuntime> {
    const profile = getProfileConfig(this.config, profileName);
    const name = profile.name;

    // Check if already running
    const existing = this.runtimes.get(name);
    if (existing) {
      return existing;
    }

    const userDataDir = getUserDataDir(this.config, name);

    // Launch Chrome with CDP
    const launched = await launchChrome({
      executablePath: profile.executablePath || this.config.executablePath,
      userDataDir,
      headless: profile.headless ?? this.config.headless,
      port: this.config.port,
    });

    // Connect Playwright to the launched Chrome
    const { chromium } = await import('playwright');
    const browser = await chromium.connectOverCDP(`http://localhost:${launched.cdpPort}`);
    const context = browser.contexts()[0] || await browser.newContext();

    const runtime: BrowserRuntime = {
      process: launched.process,
      cdpPort: launched.cdpPort,
      cdpUrl: launched.cdpUrl,
      browser,
      context,
      pages: new Map(),
    };

    this.runtimes.set(name, runtime);

    return runtime;
  }

  async stopProfile(profileName?: string): Promise<void> {
    const name = profileName || this.config.defaultProfile;
    const runtime = this.runtimes.get(name);

    if (!runtime) {
      return;
    }

    // Close all pages
    for (const [targetId, session] of runtime.pages) {
      try {
        await session.page.close();
      } catch {
        // Ignore errors when closing
      }
    }
    runtime.pages.clear();

    // Close browser
    if (runtime.browser) {
      try {
        await runtime.browser.close();
      } catch {
        // Ignore errors when closing
      }
    }

    // Stop Chrome process
    if (runtime.process) {
      await stopChrome(runtime);
    }

    this.runtimes.delete(name);
  }

  getRuntime(profileName?: string): BrowserRuntime | undefined {
    const name = profileName || this.config.defaultProfile;
    return this.runtimes.get(name);
  }

  isRunning(profileName?: string): boolean {
    const runtime = this.getRuntime(profileName);
    return !!runtime && runtime.process && runtime.process.exitCode === null;
  }

  listProfiles(): ProfileStatus[] {
    const profiles: ProfileStatus[] = [];

    for (const [name, profile] of Object.entries(this.config.profiles)) {
      const runtime = this.runtimes.get(name);
      const isRunning = runtime?.process && runtime.process.exitCode === null;

      profiles.push({
        name,
        cdpPort: runtime?.cdpPort || null,
        cdpUrl: runtime?.cdpUrl || null,
        color: 'default',
        driver: 'foxfang',
        running: !!isRunning,
        tabCount: runtime?.pages.size || 0,
        isDefault: name === this.config.defaultProfile,
        isRemote: false,
      });
    }

    return profiles;
  }

  async getOrCreateRuntime(profileName?: string): Promise<BrowserRuntime> {
    const runtime = this.getRuntime(profileName);
    if (runtime) {
      return runtime;
    }
    return this.startProfile(profileName);
  }
}
