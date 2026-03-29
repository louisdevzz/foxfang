// Private runtime barrel for the bundled Feishu extension.
// Keep this barrel thin and aligned with the local extension surface.

export type {
  ChannelMessageActionName,
  ChannelMeta,
  ChannelOutboundAdapter,
  FoxFangConfig as ClawdbotConfig,
  FoxFangConfig,
  FoxFangPluginApi,
  PluginRuntime,
  RuntimeEnv,
} from "foxfang/plugin-sdk/feishu";
export {
  DEFAULT_ACCOUNT_ID,
  PAIRING_APPROVED_MESSAGE,
  buildChannelConfigSchema,
  buildProbeChannelStatusSummary,
  createActionGate,
  createDefaultChannelRuntimeState,
} from "foxfang/plugin-sdk/feishu";
export * from "foxfang/plugin-sdk/feishu";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "foxfang/plugin-sdk/webhook-ingress";
