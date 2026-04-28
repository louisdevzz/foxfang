import { vi } from "vitest";
import { installChromeUserDataDirHooks } from "./chrome-user-data-dir.test-harness.js";

const chromeUserDataDir = { dir: "/tmp/foxfang" };
installChromeUserDataDirHooks(chromeUserDataDir);

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchFoxFangChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveFoxFangUserDataDir: vi.fn(() => chromeUserDataDir.dir),
  stopFoxFangChrome: vi.fn(async () => {}),
}));
