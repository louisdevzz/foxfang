export { definePluginEntry } from "foxfang/plugin-sdk/core";
export type {
  AnyAgentTool,
  FoxFangPluginApi,
  FoxFangPluginToolContext,
  FoxFangPluginToolFactory,
} from "foxfang/plugin-sdk/core";
export {
  applyWindowsSpawnProgramPolicy,
  materializeWindowsSpawnProgram,
  resolveWindowsSpawnProgramCandidate,
} from "foxfang/plugin-sdk/windows-spawn";
