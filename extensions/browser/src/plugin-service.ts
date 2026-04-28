import {
  startLazyPluginServiceModule,
  type LazyPluginServiceHandle,
  type FoxFangPluginService,
} from "foxfang/plugin-sdk/browser-support";

type BrowserControlHandle = LazyPluginServiceHandle | null;

export function createBrowserPluginService(): FoxFangPluginService {
  let handle: BrowserControlHandle = null;

  return {
    id: "browser-control",
    start: async () => {
      if (handle) {
        return;
      }
      handle = await startLazyPluginServiceModule({
        skipEnvVar: "FOXFANG_SKIP_BROWSER_CONTROL_SERVER",
        overrideEnvVar: "FOXFANG_BROWSER_CONTROL_MODULE",
        // Keep the default module import static so compiled builds still bundle it.
        loadDefaultModule: async () => await import("./server.js"),
        startExportNames: [
          "startBrowserControlServiceFromConfig",
          "startBrowserControlServerFromConfig",
        ],
        stopExportNames: ["stopBrowserControlService", "stopBrowserControlServer"],
      });
    },
    stop: async () => {
      const current = handle;
      handle = null;
      if (!current) {
        return;
      }
      await current.stop().catch(() => {});
    },
  };
}
