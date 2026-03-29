import { definePluginEntry } from "foxfang/plugin-sdk/plugin-entry";
import type { AnyAgentTool, FoxFangPluginApi, FoxFangPluginToolFactory } from "./runtime-api.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default definePluginEntry({
  id: "lobster",
  name: "Lobster",
  description: "Optional local shell helper tools",
  register(api: FoxFangPluginApi) {
    api.registerTool(
      ((ctx) => {
        if (ctx.sandboxed) {
          return null;
        }
        return createLobsterTool(api) as AnyAgentTool;
      }) as FoxFangPluginToolFactory,
      { optional: true },
    );
  },
});
