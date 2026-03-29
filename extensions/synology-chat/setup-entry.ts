import { defineSetupPluginEntry } from "foxfang/plugin-sdk/core";
import { synologyChatPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(synologyChatPlugin);
