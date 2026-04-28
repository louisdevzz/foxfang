import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          FOXFANG_STATE_DIR: "/tmp/foxfang-state",
          FOXFANG_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "foxfang-gateway",
        windowsTaskName: "FoxFang Gateway",
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/foxfang-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/foxfang-state/logs/gateway.err.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        systemdServiceName: "foxfang-gateway",
        windowsTaskName: "FoxFang Gateway",
      }),
    ).toEqual(["Logs: journalctl --user -u foxfang-gateway.service -n 200 --no-pager"]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        systemdServiceName: "foxfang-gateway",
        windowsTaskName: "FoxFang Gateway",
      }),
    ).toEqual(['Logs: schtasks /Query /TN "FoxFang Gateway" /V /FO LIST']);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installCommand: "foxfang gateway install",
        startCommand: "foxfang gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.foxfang.gateway.plist",
        systemdServiceName: "foxfang-gateway",
        windowsTaskName: "FoxFang Gateway",
      }),
    ).toEqual([
      "foxfang gateway install",
      "foxfang gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.foxfang.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installCommand: "foxfang gateway install",
        startCommand: "foxfang gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.foxfang.gateway.plist",
        systemdServiceName: "foxfang-gateway",
        windowsTaskName: "FoxFang Gateway",
      }),
    ).toEqual([
      "foxfang gateway install",
      "foxfang gateway",
      "systemctl --user start foxfang-gateway.service",
    ]);
  });
});
