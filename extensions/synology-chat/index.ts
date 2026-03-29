import { defineChannelPluginEntry } from "foxfang/plugin-sdk/core";
import { synologyChatPlugin } from "./src/channel.js";
import { setSynologyRuntime } from "./src/runtime.js";

export { synologyChatPlugin } from "./src/channel.js";
export { setSynologyRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "synology-chat",
  name: "Synology Chat",
  description: "Native Synology Chat channel plugin for FoxFang",
  plugin: synologyChatPlugin,
  setRuntime: setSynologyRuntime,
});
