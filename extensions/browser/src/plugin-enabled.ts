import type { FoxFangConfig } from "foxfang/plugin-sdk/browser-support";
import {
  normalizePluginsConfig,
  resolveEffectiveEnableState,
} from "foxfang/plugin-sdk/browser-support";

export function isDefaultBrowserPluginEnabled(cfg: FoxFangConfig): boolean {
  return resolveEffectiveEnableState({
    id: "browser",
    origin: "bundled",
    config: normalizePluginsConfig(cfg.plugins),
    rootConfig: cfg,
    enabledByDefault: true,
  }).enabled;
}
