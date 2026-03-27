/**
 * Chrome Launcher
 * 
 * Launch and manage Chrome/Chromium browser instances
 */

import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync } from 'fs';
import type { BrowserRuntime } from './types';

export interface LaunchChromeOptions {
  executablePath?: string;
  userDataDir: string;
  headless?: boolean;
  port?: number;
  extraArgs?: string[];
}

export interface LaunchedChrome {
  process: ChildProcess;
  cdpPort: number;
  cdpUrl: string;
  pid: number;
}

const DEFAULT_CDP_PORT = 9222;

export async function launchChrome(options: LaunchChromeOptions): Promise<LaunchedChrome> {
  const {
    executablePath = 'chromium',
    userDataDir,
    headless = true,
    port = DEFAULT_CDP_PORT,
    extraArgs = [],
  } = options;

  // Ensure user data directory exists
  try {
    mkdirSync(userDataDir, { recursive: true });
  } catch {
    // Directory might already exist
  }

  const cdpUrl = `http://localhost:${port}`;

  const args: string[] = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
  ];

  // Try to find Chrome/Chromium executable
  const chromeExecutable = await findChromeExecutable(executablePath);

  const chromeProcess = spawn(chromeExecutable, args, {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!chromeProcess.pid) {
    throw new Error('Failed to launch Chrome: no PID');
  }

  // Wait a bit for Chrome to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check if process is still running
  if (chromeProcess.exitCode !== null) {
    throw new Error(`Chrome exited immediately with code ${chromeProcess.exitCode}`);
  }

  return {
    process: chromeProcess,
    cdpPort: port,
    cdpUrl,
    pid: chromeProcess.pid,
  };
}

export async function stopChrome(launched: LaunchedChrome | BrowserRuntime): Promise<void> {
  const process = 'process' in launched ? launched.process : undefined;
  
  if (!process) {
    return;
  }

  // Try graceful shutdown first
  process.kill('SIGTERM');

  // Wait up to 5 seconds for graceful shutdown
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Force kill if still running
  if (process.exitCode === null) {
    process.kill('SIGKILL');
  }
}

async function findChromeExecutable(preferred?: string): Promise<string> {
  if (preferred) {
    return preferred;
  }

  // Platform-specific defaults
  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    );
  } else if (platform === 'linux') {
    candidates.push(
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    );
  } else if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  }

  // Add generic names to try
  candidates.push('chromium', 'chromium-browser', 'google-chrome', 'chrome', 'msedge');

  // Try to find the first available executable
  const { execSync } = await import('child_process');
  
  for (const candidate of candidates) {
    try {
      execSync(`which "${candidate}"`, { stdio: 'ignore' });
      return candidate;
    } catch {
      continue;
    }
  }

  // Fallback to 'chromium' and hope it's in PATH
  return 'chromium';
}

export function isChromeRunning(runtime: BrowserRuntime): boolean {
  if (!runtime.process) {
    return false;
  }
  
  return runtime.process.exitCode === null;
}
