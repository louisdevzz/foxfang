/**
 * Update channels for FoxFang
 */

export type UpdateChannel = 'stable' | 'beta' | 'dev';

export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = 'dev';

export const DEV_BRANCH = 'main';

export function channelToNpmTag(channel: UpdateChannel): string {
  switch (channel) {
    case 'stable':
      return 'latest';
    case 'beta':
      return 'beta';
    case 'dev':
      return 'dev';
    default:
      return 'latest';
  }
}

export function isStableTag(tag: string): boolean {
  return /^v\d+\.\d+\.\d+$/.test(tag) && !tag.includes('-');
}

export function isBetaTag(tag: string): boolean {
  return /^v\d+\.\d+\.\d+-beta\.\d+$/.test(tag);
}

export function normalizeUpdateChannel(input: string | undefined): UpdateChannel {
  if (!input) return DEFAULT_UPDATE_CHANNEL;
  if (['stable', 'beta', 'dev'].includes(input)) {
    return input as UpdateChannel;
  }
  return DEFAULT_UPDATE_CHANNEL;
}
