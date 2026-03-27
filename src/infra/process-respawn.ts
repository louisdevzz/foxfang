/**
 * Process respawn — platform-specific graceful daemon restart.
 *
 * Writes a tiny shell/bat script to /tmp, spawns it detached, then exits.
 * The script sleeps briefly (to let the current process release file locks),
 * invokes the system service manager, and self-deletes.
 */

import { spawn, execSync } from 'child_process';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';

const LAUNCHD_LABEL = 'com.foxfang.gateway';
const SYSTEMD_SERVICE = 'foxfang-gateway';

function getUid(): string {
  try {
    return execSync('id -u', { encoding: 'utf-8' }).trim();
  } catch {
    return '501';
  }
}

function buildMacScript(scriptPath: string): string {
  const uid = getUid();
  return [
    '#!/bin/sh',
    'sleep 1',
    `launchctl kickstart -k "gui/${uid}/${LAUNCHD_LABEL}" 2>/dev/null || launchctl start "${LAUNCHD_LABEL}"`,
    `rm -- "${scriptPath}"`,
  ].join('\n');
}

function buildLinuxScript(scriptPath: string): string {
  return [
    '#!/bin/sh',
    'sleep 1',
    `systemctl --user restart ${SYSTEMD_SERVICE} 2>/dev/null || systemctl restart ${SYSTEMD_SERVICE} 2>/dev/null || true`,
    `rm -- "${scriptPath}"`,
  ].join('\n');
}

function buildFallbackScript(scriptPath: string): string {
  const execPath = process.execPath;
  const args = [...process.execArgv, ...process.argv.slice(1)].map(a => `"${a}"`).join(' ');
  const cwd = process.cwd();
  return [
    '#!/bin/sh',
    'sleep 2',
    `cd "${cwd}"`,
    `${execPath} ${args} &`,
    'disown',
    `rm -- "${scriptPath}"`,
  ].join('\n');
}

/**
 * Schedule a daemon respawn and exit the current process.
 *
 * Call this AFTER writing the restart sentinel and only when the update
 * completed successfully. This function does not return.
 */
export async function scheduleRespawnAndExit(): Promise<never> {
  const scriptPath = `${tmpdir()}/foxfang-respawn-${Date.now()}.sh`;

  const platform = process.platform;
  let script: string;

  if (platform === 'darwin') {
    script = buildMacScript(scriptPath);
  } else if (platform === 'linux') {
    script = buildLinuxScript(scriptPath);
  } else {
    script = buildFallbackScript(scriptPath);
  }

  await writeFile(scriptPath, script, { mode: 0o755, encoding: 'utf-8' });

  spawn('/bin/sh', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  // Give the spawn a moment to fork before we exit
  await new Promise(resolve => setTimeout(resolve, 200));
  process.exit(0);
}
