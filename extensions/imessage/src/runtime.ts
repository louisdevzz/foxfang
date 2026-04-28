import type { PluginRuntime } from "foxfang/plugin-sdk/core";
import { createPluginRuntimeStore } from "foxfang/plugin-sdk/runtime-store";

const { setRuntime: setIMessageRuntime, getRuntime: getIMessageRuntime } =
  createPluginRuntimeStore<PluginRuntime>("iMessage runtime not initialized");
export { getIMessageRuntime, setIMessageRuntime };
