import { describe, expect, it, vi } from "vitest";
import type { FoxFangConfig } from "../config/config.js";
import {
  applyGoogleGeminiModelDefault,
  GOOGLE_GEMINI_DEFAULT_MODEL,
} from "../plugin-sdk/google.js";
import {
  applyOpenAIConfig,
  applyOpenAIProviderConfig,
  OPENAI_DEFAULT_MODEL,
} from "../plugin-sdk/openai.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { applyDefaultModelChoice } from "./auth-choice.default-model.js";
import {
  applyOpencodeZenModelDefault,
  OPENCODE_ZEN_DEFAULT_MODEL,
} from "./opencode-zen-model-default.js";

function makePrompter(): WizardPrompter {
  return {
    intro: async () => {},
    outro: async () => {},
    note: async () => {},
    select: (async <T>() => "" as T) as WizardPrompter["select"],
    multiselect: (async <T>() => [] as T[]) as WizardPrompter["multiselect"],
    text: async () => "",
    confirm: async () => false,
    progress: () => ({ update: () => {}, stop: () => {} }),
  };
}

function expectPrimaryModelChanged(
  applied: { changed: boolean; next: FoxFangConfig },
  primary: string,
) {
  expect(applied.changed).toBe(true);
  expect(applied.next.agents?.defaults?.model).toEqual({ primary });
}

function expectConfigUnchanged(
  applied: { changed: boolean; next: FoxFangConfig },
  cfg: FoxFangConfig,
) {
  expect(applied.changed).toBe(false);
  expect(applied.next).toEqual(cfg);
}

type SharedDefaultModelCase = {
  apply: (cfg: FoxFangConfig) => { changed: boolean; next: FoxFangConfig };
  defaultModel: string;
  overrideConfig: FoxFangConfig;
  alreadyDefaultConfig: FoxFangConfig;
};

const SHARED_DEFAULT_MODEL_CASES: SharedDefaultModelCase[] = [
  {
    apply: applyGoogleGeminiModelDefault,
    defaultModel: GOOGLE_GEMINI_DEFAULT_MODEL,
    overrideConfig: {
      agents: { defaults: { model: { primary: "anthropic/claude-opus-4-5" } } },
    } as FoxFangConfig,
    alreadyDefaultConfig: {
      agents: { defaults: { model: { primary: GOOGLE_GEMINI_DEFAULT_MODEL } } },
    } as FoxFangConfig,
  },
  {
    apply: applyOpencodeZenModelDefault,
    defaultModel: OPENCODE_ZEN_DEFAULT_MODEL,
    overrideConfig: {
      agents: { defaults: { model: "anthropic/claude-opus-4-5" } },
    } as FoxFangConfig,
    alreadyDefaultConfig: {
      agents: { defaults: { model: OPENCODE_ZEN_DEFAULT_MODEL } },
    } as FoxFangConfig,
  },
];

describe("applyDefaultModelChoice", () => {
  it("ensures allowlist entry exists when returning an agent override", async () => {
    const defaultModel = "vercel-ai-gateway/anthropic/claude-opus-4.6";
    const noteAgentModel = vi.fn(async () => {});
    const applied = await applyDefaultModelChoice({
      config: {},
      setDefaultModel: false,
      defaultModel,
      // Simulate a provider function that does not explicitly add the entry.
      applyProviderConfig: (config: FoxFangConfig) => config,
      applyDefaultConfig: (config: FoxFangConfig) => config,
      noteAgentModel,
      prompter: makePrompter(),
    });

    expect(noteAgentModel).toHaveBeenCalledWith(defaultModel);
    expect(applied.agentModelOverride).toBe(defaultModel);
    expect(applied.config.agents?.defaults?.models?.[defaultModel]).toEqual({});
  });

  it("adds canonical allowlist key for anthropic aliases", async () => {
    const defaultModel = "anthropic/opus-4.6";
    const applied = await applyDefaultModelChoice({
      config: {},
      setDefaultModel: false,
      defaultModel,
      applyProviderConfig: (config: FoxFangConfig) => config,
      applyDefaultConfig: (config: FoxFangConfig) => config,
      noteAgentModel: async () => {},
      prompter: makePrompter(),
    });

    expect(applied.config.agents?.defaults?.models?.[defaultModel]).toEqual({});
    expect(applied.config.agents?.defaults?.models?.["anthropic/claude-opus-4-6"]).toEqual({});
  });

  it("uses applyDefaultConfig path when setDefaultModel is true", async () => {
    const defaultModel = "openai/gpt-5.4";
    const applied = await applyDefaultModelChoice({
      config: {},
      setDefaultModel: true,
      defaultModel,
      applyProviderConfig: (config: FoxFangConfig) => config,
      applyDefaultConfig: () => ({
        agents: {
          defaults: {
            model: { primary: defaultModel },
          },
        },
      }),
      noteDefault: defaultModel,
      noteAgentModel: async () => {},
      prompter: makePrompter(),
    });

    expect(applied.agentModelOverride).toBeUndefined();
    expect(applied.config.agents?.defaults?.model).toEqual({ primary: defaultModel });
  });
});

describe("shared default model behavior", () => {
  it("sets defaults when model is unset", () => {
    for (const testCase of SHARED_DEFAULT_MODEL_CASES) {
      const cfg: FoxFangConfig = { agents: { defaults: {} } };
      const applied = testCase.apply(cfg);
      expectPrimaryModelChanged(applied, testCase.defaultModel);
    }
  });

  it("overrides existing models", () => {
    for (const testCase of SHARED_DEFAULT_MODEL_CASES) {
      const applied = testCase.apply(testCase.overrideConfig);
      expectPrimaryModelChanged(applied, testCase.defaultModel);
    }
  });

  it("no-ops when already on the target default", () => {
    for (const testCase of SHARED_DEFAULT_MODEL_CASES) {
      const applied = testCase.apply(testCase.alreadyDefaultConfig);
      expectConfigUnchanged(applied, testCase.alreadyDefaultConfig);
    }
  });
});

describe("applyOpenAIProviderConfig", () => {
  it("adds allowlist entry for default model", () => {
    const next = applyOpenAIProviderConfig({});
    expect(Object.keys(next.agents?.defaults?.models ?? {})).toContain(OPENAI_DEFAULT_MODEL);
  });

  it("preserves existing alias for default model", () => {
    const next = applyOpenAIProviderConfig({
      agents: {
        defaults: {
          models: {
            [OPENAI_DEFAULT_MODEL]: { alias: "My GPT" },
          },
        },
      },
    });
    expect(next.agents?.defaults?.models?.[OPENAI_DEFAULT_MODEL]?.alias).toBe("My GPT");
  });
});

describe("applyOpenAIConfig", () => {
  it("sets default when model is unset", () => {
    const next = applyOpenAIConfig({});
    expect(next.agents?.defaults?.model).toEqual({ primary: OPENAI_DEFAULT_MODEL });
  });

  it("overrides model.primary when model object already exists", () => {
    const next = applyOpenAIConfig({
      agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6", fallbacks: [] } } },
    });
    expect(next.agents?.defaults?.model).toEqual({ primary: OPENAI_DEFAULT_MODEL, fallbacks: [] });
  });
});

describe("applyOpencodeZenModelDefault", () => {
  it("no-ops when already legacy opencode-zen default", () => {
    const cfg = {
      agents: { defaults: { model: "opencode-zen/claude-opus-4-5" } },
    } as FoxFangConfig;
    const applied = applyOpencodeZenModelDefault(cfg);
    expectConfigUnchanged(applied, cfg);
  });

  it("preserves fallbacks when setting primary", () => {
    const cfg: FoxFangConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-5",
            fallbacks: ["google/gemini-3-pro"],
          },
        },
      },
    };
    const applied = applyOpencodeZenModelDefault(cfg);
    expect(applied.changed).toBe(true);
    expect(applied.next.agents?.defaults?.model).toEqual({
      primary: OPENCODE_ZEN_DEFAULT_MODEL,
      fallbacks: ["google/gemini-3-pro"],
    });
  });
});
