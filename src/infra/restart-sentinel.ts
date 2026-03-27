/**
 * Restart sentinel — persists cross-restart delivery context.
 *
 * Written just before the daemon exits for an update.
 * Read and consumed on the next daemon boot to notify the user.
 */

import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SENTINEL_PATH = join(homedir(), '.foxfang', 'restart-sentinel.json');

export type RestartSentinel = {
  /** Channel that triggered the update (e.g. 'telegram', 'signal', 'discord') */
  channel: string;
  /** Chat / user ID to reply to after restart */
  chatId: string;
  /** Optional thread / topic ID (e.g. Telegram message thread) */
  threadId?: number | string;
  /** Message to deliver after successful restart */
  message: string;
  /** Unix timestamp (ms) when the update was triggered */
  triggeredAt: number;
};

export async function writeRestartSentinel(sentinel: RestartSentinel): Promise<void> {
  await writeFile(SENTINEL_PATH, JSON.stringify(sentinel, null, 2), 'utf-8');
}

/**
 * Read the sentinel and immediately delete it so it is delivered only once.
 * Returns null if no sentinel exists.
 */
export async function readAndConsumeRestartSentinel(): Promise<RestartSentinel | null> {
  if (!existsSync(SENTINEL_PATH)) return null;
  try {
    const raw = await readFile(SENTINEL_PATH, 'utf-8');
    const sentinel = JSON.parse(raw) as RestartSentinel;
    await unlink(SENTINEL_PATH).catch(() => {});
    return sentinel;
  } catch {
    await unlink(SENTINEL_PATH).catch(() => {});
    return null;
  }
}
