// Private runtime barrel for the bundled Signal extension.
// Prefer narrower SDK subpaths plus local extension seams over the legacy signal barrel.

export type { ChannelMessageActionAdapter } from "foxfang/plugin-sdk/channel-contract";
export { SignalConfigSchema } from "foxfang/plugin-sdk/channel-config-schema";
export { PAIRING_APPROVED_MESSAGE } from "foxfang/plugin-sdk/channel-status";
import type { FoxFangConfig as RuntimeFoxFangConfig } from "foxfang/plugin-sdk/config-runtime";
export type { RuntimeFoxFangConfig as FoxFangConfig };
export type { FoxFangPluginApi, PluginRuntime } from "foxfang/plugin-sdk/core";
export type { ChannelPlugin } from "foxfang/plugin-sdk/core";
export {
  DEFAULT_ACCOUNT_ID,
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  deleteAccountFromConfigSection,
  emptyPluginConfigSchema,
  formatPairingApproveHint,
  getChatChannelMeta,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  setAccountEnabledInConfigSection,
} from "foxfang/plugin-sdk/core";
export { resolveChannelMediaMaxBytes } from "foxfang/plugin-sdk/media-runtime";
export { formatCliCommand, formatDocsLink } from "foxfang/plugin-sdk/setup-tools";
export { chunkText } from "foxfang/plugin-sdk/reply-runtime";
export { detectBinary, installSignalCli } from "foxfang/plugin-sdk/setup-tools";
export {
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "foxfang/plugin-sdk/config-runtime";
export {
  buildBaseAccountStatusSnapshot,
  buildBaseChannelStatusSummary,
  collectStatusIssuesFromLastError,
  createDefaultChannelRuntimeState,
} from "foxfang/plugin-sdk/status-helpers";
export { normalizeE164 } from "foxfang/plugin-sdk/text-runtime";
export { looksLikeSignalTargetId, normalizeSignalMessagingTarget } from "./normalize.js";
export {
  listEnabledSignalAccounts,
  listSignalAccountIds,
  resolveDefaultSignalAccountId,
  resolveSignalAccount,
} from "./accounts.js";
export { monitorSignalProvider } from "./monitor.js";
export { probeSignal } from "./probe.js";
export { resolveSignalReactionLevel } from "./reaction-level.js";
export { removeReactionSignal, sendReactionSignal } from "./send-reactions.js";
export { sendMessageSignal } from "./send.js";
export { signalMessageActions } from "./message-actions.js";
export type { ResolvedSignalAccount } from "./accounts.js";
export type SignalAccountConfig = Omit<
  Exclude<NonNullable<RuntimeFoxFangConfig["channels"]>["signal"], undefined>,
  "accounts"
>;
