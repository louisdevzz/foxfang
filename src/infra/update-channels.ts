/**
 * Update configuration for FoxFang
 */

export const UPDATE_BRANCH = 'main';
export const UPDATE_REMOTE = 'origin';
export const UPSTREAM_REPO = 'https://github.com/PotLock/foxfang';

export type UpdateChannel = 'stable' | 'beta' | 'dev';

export function normalizeUpdateChannel(channel: string): UpdateChannel {
  if (channel === 'beta' || channel === 'dev') {
    return channel;
  }
  return 'stable';
}
