import { getRuntimeConfigSnapshot, type FoxFangConfig } from "../../config/config.js";

export function resolveSkillRuntimeConfig(config?: FoxFangConfig): FoxFangConfig | undefined {
  return getRuntimeConfigSnapshot() ?? config;
}
