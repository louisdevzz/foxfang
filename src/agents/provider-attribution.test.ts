import { describe, expect, it } from "vitest";
import {
  listProviderAttributionPolicies,
  resolveProviderAttributionHeaders,
  resolveProviderAttributionIdentity,
  resolveProviderAttributionPolicy,
} from "./provider-attribution.js";

describe("provider attribution", () => {
  it("resolves the canonical FoxFang product and runtime version", () => {
    const identity = resolveProviderAttributionIdentity({
      FOXFANG_VERSION: "2026.3.99",
    });

    expect(identity).toEqual({
      product: "FoxFang",
      version: "2026.3.99",
    });
  });

  it("returns a documented OpenRouter attribution policy", () => {
    const policy = resolveProviderAttributionPolicy("openrouter", {
      FOXFANG_VERSION: "2026.3.22",
    });

    expect(policy).toEqual({
      provider: "openrouter",
      enabledByDefault: true,
      verification: "vendor-documented",
      hook: "request-headers",
      docsUrl: "https://openrouter.ai/docs/app-attribution",
      reviewNote: "Documented app attribution headers. Verified in FoxFang runtime wrapper.",
      product: "FoxFang",
      version: "2026.3.22",
      headers: {
        "HTTP-Referer": "https://foxfang.ai",
        "X-OpenRouter-Title": "FoxFang",
        "X-OpenRouter-Categories": "cli-agent",
      },
    });
  });

  it("normalizes aliases when resolving provider headers", () => {
    expect(
      resolveProviderAttributionHeaders("OpenRouter", {
        FOXFANG_VERSION: "2026.3.22",
      }),
    ).toEqual({
      "HTTP-Referer": "https://foxfang.ai",
      "X-OpenRouter-Title": "FoxFang",
      "X-OpenRouter-Categories": "cli-agent",
    });
  });

  it("returns a hidden-spec OpenAI attribution policy", () => {
    expect(resolveProviderAttributionPolicy("openai", { FOXFANG_VERSION: "2026.3.22" })).toEqual({
      provider: "openai",
      enabledByDefault: true,
      verification: "vendor-hidden-api-spec",
      hook: "request-headers",
      reviewNote:
        "OpenAI native traffic supports hidden originator/User-Agent attribution. Verified against the Codex wire contract.",
      product: "FoxFang",
      version: "2026.3.22",
      headers: {
        originator: "foxfang",
        version: "2026.3.22",
        "User-Agent": "foxfang/2026.3.22",
      },
    });
    expect(resolveProviderAttributionHeaders("openai", { FOXFANG_VERSION: "2026.3.22" })).toEqual({
      originator: "foxfang",
      version: "2026.3.22",
      "User-Agent": "foxfang/2026.3.22",
    });
  });

  it("returns a hidden-spec OpenAI Codex attribution policy", () => {
    expect(
      resolveProviderAttributionPolicy("openai-codex", { FOXFANG_VERSION: "2026.3.22" }),
    ).toEqual({
      provider: "openai-codex",
      enabledByDefault: true,
      verification: "vendor-hidden-api-spec",
      hook: "request-headers",
      reviewNote:
        "OpenAI Codex ChatGPT-backed traffic supports the same hidden originator/User-Agent attribution contract.",
      product: "FoxFang",
      version: "2026.3.22",
      headers: {
        originator: "foxfang",
        version: "2026.3.22",
        "User-Agent": "foxfang/2026.3.22",
      },
    });
  });

  it("lists the current attribution support matrix", () => {
    expect(
      listProviderAttributionPolicies({ FOXFANG_VERSION: "2026.3.22" }).map((policy) => [
        policy.provider,
        policy.enabledByDefault,
        policy.verification,
        policy.hook,
      ]),
    ).toEqual([
      ["openrouter", true, "vendor-documented", "request-headers"],
      ["openai", true, "vendor-hidden-api-spec", "request-headers"],
      ["openai-codex", true, "vendor-hidden-api-spec", "request-headers"],
      ["anthropic", false, "vendor-sdk-hook-only", "default-headers"],
      ["google", false, "vendor-sdk-hook-only", "user-agent-extra"],
      ["groq", false, "vendor-sdk-hook-only", "default-headers"],
      ["mistral", false, "vendor-sdk-hook-only", "custom-user-agent"],
      ["together", false, "vendor-sdk-hook-only", "default-headers"],
    ]);
  });
});
