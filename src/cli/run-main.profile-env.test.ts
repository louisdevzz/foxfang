import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileState = vi.hoisted(() => ({
  hasCliDotEnv: false,
}));

const dotenvState = vi.hoisted(() => {
  const state = {
    profileAtDotenvLoad: undefined as string | undefined,
    containerAtDotenvLoad: undefined as string | undefined,
  };
  return {
    state,
    loadDotEnv: vi.fn(() => {
      state.profileAtDotenvLoad = process.env.FOXFANG_PROFILE;
      state.containerAtDotenvLoad = process.env.FOXFANG_CONTAINER;
    }),
  };
});

const maybeRunCliInContainerMock = vi.hoisted(() =>
  vi.fn((argv: string[]) => ({ handled: false, argv })),
);

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  type ExistsSyncPath = Parameters<typeof actual.existsSync>[0];
  return {
    ...actual,
    existsSync: vi.fn((target: ExistsSyncPath) => {
      if (typeof target === "string" && target.endsWith(".env")) {
        return fileState.hasCliDotEnv;
      }
      return actual.existsSync(target);
    }),
  };
});

vi.mock("./dotenv.js", () => ({
  loadCliDotEnv: dotenvState.loadDotEnv,
}));

vi.mock("../infra/env.js", () => ({
  normalizeEnv: vi.fn(),
}));

vi.mock("../infra/runtime-guard.js", () => ({
  assertSupportedRuntime: vi.fn(),
}));

vi.mock("../infra/path-env.js", () => ({
  ensureFoxFangCliOnPath: vi.fn(),
}));

vi.mock("./route.js", () => ({
  tryRouteCli: vi.fn(async () => true),
}));

vi.mock("./windows-argv.js", () => ({
  normalizeWindowsArgv: (argv: string[]) => argv,
}));

vi.mock("./container-target.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./container-target.js")>();
  return {
    ...actual,
    maybeRunCliInContainer: maybeRunCliInContainerMock,
  };
});

import { runCli } from "./run-main.js";

describe("runCli profile env bootstrap", () => {
  const originalProfile = process.env.FOXFANG_PROFILE;
  const originalStateDir = process.env.FOXFANG_STATE_DIR;
  const originalConfigPath = process.env.FOXFANG_CONFIG_PATH;
  const originalContainer = process.env.FOXFANG_CONTAINER;
  const originalGatewayPort = process.env.FOXFANG_GATEWAY_PORT;
  const originalGatewayUrl = process.env.FOXFANG_GATEWAY_URL;
  const originalGatewayToken = process.env.FOXFANG_GATEWAY_TOKEN;
  const originalGatewayPassword = process.env.FOXFANG_GATEWAY_PASSWORD;

  beforeEach(() => {
    delete process.env.FOXFANG_PROFILE;
    delete process.env.FOXFANG_STATE_DIR;
    delete process.env.FOXFANG_CONFIG_PATH;
    delete process.env.FOXFANG_CONTAINER;
    delete process.env.FOXFANG_GATEWAY_PORT;
    delete process.env.FOXFANG_GATEWAY_URL;
    delete process.env.FOXFANG_GATEWAY_TOKEN;
    delete process.env.FOXFANG_GATEWAY_PASSWORD;
    dotenvState.state.profileAtDotenvLoad = undefined;
    dotenvState.state.containerAtDotenvLoad = undefined;
    dotenvState.loadDotEnv.mockClear();
    maybeRunCliInContainerMock.mockClear();
    fileState.hasCliDotEnv = false;
  });

  afterEach(() => {
    if (originalProfile === undefined) {
      delete process.env.FOXFANG_PROFILE;
    } else {
      process.env.FOXFANG_PROFILE = originalProfile;
    }
    if (originalContainer === undefined) {
      delete process.env.FOXFANG_CONTAINER;
    } else {
      process.env.FOXFANG_CONTAINER = originalContainer;
    }
    if (originalStateDir === undefined) {
      delete process.env.FOXFANG_STATE_DIR;
    } else {
      process.env.FOXFANG_STATE_DIR = originalStateDir;
    }
    if (originalConfigPath === undefined) {
      delete process.env.FOXFANG_CONFIG_PATH;
    } else {
      process.env.FOXFANG_CONFIG_PATH = originalConfigPath;
    }
    if (originalGatewayPort === undefined) {
      delete process.env.FOXFANG_GATEWAY_PORT;
    } else {
      process.env.FOXFANG_GATEWAY_PORT = originalGatewayPort;
    }
    if (originalGatewayUrl === undefined) {
      delete process.env.FOXFANG_GATEWAY_URL;
    } else {
      process.env.FOXFANG_GATEWAY_URL = originalGatewayUrl;
    }
    if (originalGatewayToken === undefined) {
      delete process.env.FOXFANG_GATEWAY_TOKEN;
    } else {
      process.env.FOXFANG_GATEWAY_TOKEN = originalGatewayToken;
    }
    if (originalGatewayPassword === undefined) {
      delete process.env.FOXFANG_GATEWAY_PASSWORD;
    } else {
      process.env.FOXFANG_GATEWAY_PASSWORD = originalGatewayPassword;
    }
  });

  it("applies --profile before dotenv loading", async () => {
    fileState.hasCliDotEnv = true;
    await runCli(["node", "foxfang", "--profile", "rawdog", "status"]);

    expect(dotenvState.loadDotEnv).toHaveBeenCalledOnce();
    expect(dotenvState.state.profileAtDotenvLoad).toBe("rawdog");
    expect(process.env.FOXFANG_PROFILE).toBe("rawdog");
  });

  it("rejects --container combined with --profile", async () => {
    await expect(
      runCli(["node", "foxfang", "--container", "demo", "--profile", "rawdog", "status"]),
    ).rejects.toThrow("--container cannot be combined with --profile/--dev");

    expect(dotenvState.loadDotEnv).not.toHaveBeenCalled();
    expect(process.env.FOXFANG_PROFILE).toBe("rawdog");
  });

  it("rejects --container combined with interleaved --profile", async () => {
    await expect(
      runCli(["node", "foxfang", "status", "--container", "demo", "--profile", "rawdog"]),
    ).rejects.toThrow("--container cannot be combined with --profile/--dev");
  });

  it("rejects --container combined with interleaved --dev", async () => {
    await expect(
      runCli(["node", "foxfang", "status", "--container", "demo", "--dev"]),
    ).rejects.toThrow("--container cannot be combined with --profile/--dev");
  });

  it("does not let dotenv change container target resolution", async () => {
    fileState.hasCliDotEnv = true;
    dotenvState.loadDotEnv.mockImplementationOnce(() => {
      process.env.FOXFANG_CONTAINER = "demo";
      dotenvState.state.profileAtDotenvLoad = process.env.FOXFANG_PROFILE;
      dotenvState.state.containerAtDotenvLoad = process.env.FOXFANG_CONTAINER;
    });

    await runCli(["node", "foxfang", "status"]);

    expect(dotenvState.loadDotEnv).toHaveBeenCalledOnce();
    expect(process.env.FOXFANG_CONTAINER).toBe("demo");
    expect(dotenvState.state.containerAtDotenvLoad).toBe("demo");
    expect(maybeRunCliInContainerMock).toHaveBeenCalledWith(["node", "foxfang", "status"]);
    expect(maybeRunCliInContainerMock).toHaveReturnedWith({
      handled: false,
      argv: ["node", "foxfang", "status"],
    });
  });

  it("allows container mode when FOXFANG_PROFILE is already set in env", async () => {
    process.env.FOXFANG_PROFILE = "work";

    await expect(
      runCli(["node", "foxfang", "--container", "demo", "status"]),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["FOXFANG_GATEWAY_PORT", "19001"],
    ["FOXFANG_GATEWAY_URL", "ws://127.0.0.1:18789"],
    ["FOXFANG_GATEWAY_TOKEN", "demo-token"],
    ["FOXFANG_GATEWAY_PASSWORD", "demo-password"],
  ])("allows container mode when %s is set in env", async (key, value) => {
    process.env[key] = value;

    await expect(
      runCli(["node", "foxfang", "--container", "demo", "status"]),
    ).resolves.toBeUndefined();
  });

  it("allows container mode when only FOXFANG_STATE_DIR is set in env", async () => {
    process.env.FOXFANG_STATE_DIR = "/tmp/foxfang-host-state";

    await expect(
      runCli(["node", "foxfang", "--container", "demo", "status"]),
    ).resolves.toBeUndefined();
  });

  it("allows container mode when only FOXFANG_CONFIG_PATH is set in env", async () => {
    process.env.FOXFANG_CONFIG_PATH = "/tmp/foxfang-host-state/foxfang.json";

    await expect(
      runCli(["node", "foxfang", "--container", "demo", "status"]),
    ).resolves.toBeUndefined();
  });
});
