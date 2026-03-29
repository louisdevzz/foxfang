import type { PluginRuntime } from "foxfang/plugin-sdk/core";
import { createPluginRuntimeStore } from "foxfang/plugin-sdk/runtime-store";

const {
  setRuntime: setTelegramRuntime,
  clearRuntime: clearTelegramRuntime,
  getRuntime: getTelegramRuntime,
} = createPluginRuntimeStore<PluginRuntime>("Telegram runtime not initialized");
export { clearTelegramRuntime, getTelegramRuntime, setTelegramRuntime };
