import type { PluginRuntime } from "foxfang/plugin-sdk/core";
import { createPluginRuntimeStore } from "foxfang/plugin-sdk/runtime-store";

const {
  setRuntime: setSlackRuntime,
  clearRuntime: clearSlackRuntime,
  getRuntime: getSlackRuntime,
} = createPluginRuntimeStore<PluginRuntime>("Slack runtime not initialized");
export { clearSlackRuntime, getSlackRuntime, setSlackRuntime };
