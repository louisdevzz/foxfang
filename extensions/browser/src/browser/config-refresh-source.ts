import { createConfigIO, getRuntimeConfigSnapshot, type FoxFangConfig } from "../config/config.js";

export function loadBrowserConfigForRuntimeRefresh(): FoxFangConfig {
  return getRuntimeConfigSnapshot() ?? createConfigIO().loadConfig();
}
