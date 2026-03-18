/**
 * macOS LaunchAgent service manager
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { ServiceConfig, ServiceManager } from './types';

const execAsync = promisify(exec);

const SERVICE_NAME = 'com.foxfang.gateway';
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_NAME}.plist`);

export class LaunchdServiceManager implements ServiceManager {
  readonly platform = 'launchd' as const;
  private name: string;
  private plistPath: string;

  constructor(name: string = SERVICE_NAME) {
    this.name = name;
    this.plistPath = join(homedir(), 'Library', 'LaunchAgents', `${name}.plist`);
  }

  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`launchctl list | grep ${this.name}`);
      return stdout.includes(this.name);
    } catch {
      return false;
    }
  }

  async install(config: ServiceConfig): Promise<void> {
    const plist = this.generatePlist(config);
    
    // Ensure directory exists
    await mkdir(dirname(this.plistPath), { recursive: true });
    
    // Write plist
    await writeFile(this.plistPath, plist, 'utf-8');
    
    // Load service
    await execAsync(`launchctl load -w "${this.plistPath}"`);
  }

  async uninstall(): Promise<void> {
    try {
      await execAsync(`launchctl unload -w "${this.plistPath}" 2>/dev/null || true`);
      await unlink(this.plistPath);
    } catch {
      // Ignore errors
    }
  }

  async start(): Promise<void> {
    await execAsync(`launchctl start ${this.name}`);
  }

  async stop(): Promise<void> {
    await execAsync(`launchctl stop ${this.name}`);
  }

  async restart(): Promise<void> {
    await this.stop();
    await new Promise(r => setTimeout(r, 500));
    await this.start();
  }

  async logs(lines: number = 50): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `log show --predicate 'process == "${this.name}"' --last 1h | tail -${lines}`
      );
      return stdout;
    } catch {
      return 'Logs not available';
    }
  }

  private generatePlist(config: ServiceConfig): string {
    const envVars = Object.entries(config.env)
      .map(([key, value]) => `    <key>${key}</key>\n    <string>${value}</string>`)
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${this.name}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${config.command}</string>${config.args.map(arg => `\n    <string>${arg}</string>`).join('')}
  </array>
  <key>WorkingDirectory</key>
  <string>${config.cwd}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envVars}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${homedir()}/.foxfang/logs/gateway.log</string>
  <key>StandardErrorPath</key>
  <string>${homedir()}/.foxfang/logs/gateway.error.log</string>
</dict>
</plist>`;
  }
}
