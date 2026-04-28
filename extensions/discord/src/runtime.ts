import type { PluginRuntime } from "foxfang/plugin-sdk/core";
import { createPluginRuntimeStore } from "foxfang/plugin-sdk/runtime-store";

const { setRuntime: setDiscordRuntime, getRuntime: getDiscordRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Discord runtime not initialized");
export { getDiscordRuntime, setDiscordRuntime };
