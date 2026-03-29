import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "foxfang",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "foxfang", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("leaves gateway --dev for subcommands after leading root options", () => {
    const res = parseCliProfileArgs([
      "node",
      "foxfang",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual([
      "node",
      "foxfang",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "foxfang", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "foxfang", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "foxfang", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "foxfang", "status"]);
  });

  it("parses interleaved --profile after the command token", () => {
    const res = parseCliProfileArgs(["node", "foxfang", "status", "--profile", "work", "--deep"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "foxfang", "status", "--deep"]);
  });

  it("parses interleaved --dev after the command token", () => {
    const res = parseCliProfileArgs(["node", "foxfang", "status", "--dev"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "foxfang", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "foxfang", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "foxfang", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "foxfang", "--profile", "work", "--dev", "status"]],
    ["interleaved after command", ["node", "foxfang", "status", "--profile", "work", "--dev"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".foxfang-dev");
    expect(env.FOXFANG_PROFILE).toBe("dev");
    expect(env.FOXFANG_STATE_DIR).toBe(expectedStateDir);
    expect(env.FOXFANG_CONFIG_PATH).toBe(path.join(expectedStateDir, "foxfang.json"));
    expect(env.FOXFANG_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      FOXFANG_STATE_DIR: "/custom",
      FOXFANG_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.FOXFANG_STATE_DIR).toBe("/custom");
    expect(env.FOXFANG_GATEWAY_PORT).toBe("19099");
    expect(env.FOXFANG_CONFIG_PATH).toBe(path.join("/custom", "foxfang.json"));
  });

  it("uses FOXFANG_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      FOXFANG_HOME: "/srv/foxfang-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/foxfang-home");
    expect(env.FOXFANG_STATE_DIR).toBe(path.join(resolvedHome, ".foxfang-work"));
    expect(env.FOXFANG_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".foxfang-work", "foxfang.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "foxfang doctor --fix",
      env: {},
      expected: "foxfang doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "foxfang doctor --fix",
      env: { FOXFANG_PROFILE: "default" },
      expected: "foxfang doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "foxfang doctor --fix",
      env: { FOXFANG_PROFILE: "Default" },
      expected: "foxfang doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "foxfang doctor --fix",
      env: { FOXFANG_PROFILE: "bad profile" },
      expected: "foxfang doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "foxfang --profile work doctor --fix",
      env: { FOXFANG_PROFILE: "work" },
      expected: "foxfang --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "foxfang --dev doctor",
      env: { FOXFANG_PROFILE: "dev" },
      expected: "foxfang --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("foxfang doctor --fix", { FOXFANG_PROFILE: "work" })).toBe(
      "foxfang --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("foxfang doctor --fix", { FOXFANG_PROFILE: "  jbfoxfang  " })).toBe(
      "foxfang --profile jbfoxfang doctor --fix",
    );
  });

  it("handles command with no args after foxfang", () => {
    expect(formatCliCommand("foxfang", { FOXFANG_PROFILE: "test" })).toBe(
      "foxfang --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm foxfang doctor", { FOXFANG_PROFILE: "work" })).toBe(
      "pnpm foxfang --profile work doctor",
    );
  });

  it("inserts --container when a container hint is set", () => {
    expect(
      formatCliCommand("foxfang gateway status --deep", { FOXFANG_CONTAINER_HINT: "demo" }),
    ).toBe("foxfang --container demo gateway status --deep");
  });

  it("preserves both --container and --profile hints", () => {
    expect(
      formatCliCommand("foxfang doctor", {
        FOXFANG_CONTAINER_HINT: "demo",
        FOXFANG_PROFILE: "work",
      }),
    ).toBe("foxfang --container demo doctor");
  });

  it("does not prepend --container for update commands", () => {
    expect(formatCliCommand("foxfang update", { FOXFANG_CONTAINER_HINT: "demo" })).toBe(
      "foxfang update",
    );
    expect(
      formatCliCommand("pnpm foxfang update --channel beta", { FOXFANG_CONTAINER_HINT: "demo" }),
    ).toBe("pnpm foxfang update --channel beta");
  });
});
