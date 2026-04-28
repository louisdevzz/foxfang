// Narrow plugin-sdk surface for the bundled diffs plugin.
// Keep this list additive and scoped to symbols used under extensions/diffs.

export { definePluginEntry } from "./plugin-entry.js";
export type { FoxFangConfig } from "../config/config.js";
export { resolvePreferredFoxFangTmpDir } from "../infra/tmp-foxfang-dir.js";
export type {
  AnyAgentTool,
  FoxFangPluginApi,
  FoxFangPluginConfigSchema,
  FoxFangPluginToolContext,
  PluginLogger,
} from "../plugins/types.js";
