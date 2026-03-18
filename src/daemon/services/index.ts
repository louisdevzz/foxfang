/**
 * Service manager factory
 */

import { platform } from 'os';
import { LaunchdServiceManager } from './launchd';
import { SystemdServiceManager } from './systemd';
import type { ServiceManager, ServiceConfig } from './types';

export * from './types';
export { LaunchdServiceManager } from './launchd';
export { SystemdServiceManager } from './systemd';

export function createServiceManager(name?: string): ServiceManager {
  const currentPlatform = platform();
  
  switch (currentPlatform) {
    case 'darwin':
      return new LaunchdServiceManager(name);
    case 'linux':
      return new SystemdServiceManager(name);
    default:
      throw new Error(`Platform ${currentPlatform} not supported for service management`);
  }
}

export async function installGatewayService(
  port: number,
  channels: string[] = []
): Promise<void> {
  const manager = createServiceManager('foxfang-gateway');
  
  const config: ServiceConfig = {
    name: 'foxfang-gateway',
    description: 'FoxFang Gateway Service',
    command: process.execPath,
    args: [require.resolve('../gateway-server'), '--port', String(port)],
    cwd: process.cwd(),
    env: {
      NODE_ENV: 'production',
      FOXFANG_GATEWAY_PORT: String(port),
      FOXFANG_CHANNELS: channels.join(','),
      PATH: process.env.PATH || '',
    },
  };
  
  await manager.install(config);
}

export async function uninstallGatewayService(): Promise<void> {
  const manager = createServiceManager('foxfang-gateway');
  await manager.uninstall();
}

export async function getGatewayStatus(): Promise<{ running: boolean; platform: string }> {
  const manager = createServiceManager('foxfang-gateway');
  const running = await manager.isRunning();
  return { running, platform: manager.platform };
}
