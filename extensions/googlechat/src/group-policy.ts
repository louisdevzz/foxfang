import { resolveChannelGroupRequireMention } from "foxfang/plugin-sdk/channel-policy";
import type { FoxFangConfig } from "foxfang/plugin-sdk/core";

type GoogleChatGroupContext = {
  cfg: FoxFangConfig;
  accountId?: string | null;
  groupId?: string | null;
};

export function resolveGoogleChatGroupRequireMention(params: GoogleChatGroupContext): boolean {
  return resolveChannelGroupRequireMention({
    cfg: params.cfg,
    channel: "googlechat",
    groupId: params.groupId,
    accountId: params.accountId,
  });
}
