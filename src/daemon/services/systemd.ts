/**
 * Linux systemd service manager
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { ServiceConfig, ServiceManager } from './types';

const execAsync = promisify(exec);

const SERVICE_NAME = 'foxfang-gateway';

export class SystemdServiceManager implements ServiceManager {
  readonly platform = 'systemd' as const;
  private name: string;
  private servicePath: string;

  constructor(name: string = SERVICE_NAME) {
    this.name = name;
    this.servicePath = join(homedir(), '.config', 'systemd', 'user', `${name}.service`);
  }

  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`systemctl --user is-active ${this.name}`);
      return stdout.trim() === 'active';
    } catch {
      return false;
    }
  }

  async install(config: ServiceConfig): Promise<void> {
    const service = this.generateServiceFile(config);
    
    // Ensure directory exists
    await mkdir(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
    
    // Write service file
    await writeFile(this.servicePath, service, 'utf-8');
    
    // Reload systemd
    await execAsync('systemctl --user daemon-reload');
    
    // Enable and start
    await execAsync(`systemctl --user enable ${this.name}`);
    await execAsync(`systemctl --user start ${this.name}`);
  }

  async uninstall(): Promise<void> {
    try {
      await execAsync(`systemctl --user stop ${this.name} 2>/dev/null || true`);
      await execAsync(`systemctl --user disable ${this.name} 2>/dev/null || true`);
      await unlink(this.servicePath);
      await execAsync('systemctl --user daemon-reload');
    } catch {
      // Ignore errors
    }
  }

  async start(): Promise<void> {
    await execAsync(`systemctl --user start ${this.name}`);
  }

  async stop(): Promise<void> {
    await execAsync(`systemctl --user stop ${this.name}`);
  }

  async restart(): Promise<void> {
    await execAsync(`systemctl --user restart ${this.name}`);
  }

  async logs(lines: number = 50): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `journalctl --user -u ${this.name} -n ${lines} --no-pager`
      );
      return stdout;
    } catch {
      return 'Logs not available';
    }
  }

  private generateServiceFile(config: ServiceConfig): string {
    const envVars = Object.entries(config.env)
      .map(([key, value]) => `Environment="${key}=${value}"`)
      .join('\n');

    return `[Unit]
Description=${config.description}
After=network.target

[Service]
Type=simple
ExecStart=${config.command} ${config.args.join(' ')}
WorkingDirectory=${config.cwd}
Restart=on-failure
RestartSec=5
${envVars}

[Install]
WantedBy=default.target`;
  }
}
