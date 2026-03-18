/**
 * Cross-platform service types
 */

export interface ServiceConfig {
  name: string;
  description: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface ServiceManager {
  readonly platform: 'launchd' | 'systemd' | 'schtasks' | 'manual';
  
  /** Check if service is installed and running */
  isRunning(): Promise<boolean>;
  
  /** Install and start service */
  install(config: ServiceConfig): Promise<void>;
  
  /** Stop and uninstall service */
  uninstall(): Promise<void>;
  
  /** Start service */
  start(): Promise<void>;
  
  /** Stop service */
  stop(): Promise<void>;
  
  /** Restart service */
  restart(): Promise<void>;
  
  /** Get service logs (last n lines) */
  logs(lines?: number): Promise<string>;
}

export interface GatewayConfig {
  port: number;
  authToken: string;
  channels: string[]; // enabled channels
}
