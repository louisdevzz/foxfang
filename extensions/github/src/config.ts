import type { FoxFangConfig } from "foxfang/plugin-sdk/config-runtime";
import {
  normalizeResolvedSecretInputString,
  normalizeSecretInput,
} from "foxfang/plugin-sdk/secret-input";

type GitHubPluginConfig =
  | {
      appId?: unknown;
      privateKey?: unknown;
      installationId?: unknown;
      defaultOwner?: unknown;
      defaultRepo?: unknown;
    }
  | undefined;

function pluginConfig(cfg?: FoxFangConfig): GitHubPluginConfig {
  return cfg?.plugins?.entries?.github?.config as GitHubPluginConfig;
}

function resolveSecret(value: unknown, path: string): string | undefined {
  return normalizeSecretInput(
    normalizeResolvedSecretInputString({ value, path }),
  );
}

export function resolveGitHubAppId(cfg?: FoxFangConfig): string | undefined {
  const pc = pluginConfig(cfg);
  return (
    (typeof pc?.appId === "string" ? pc.appId.trim() : undefined) ||
    normalizeSecretInput(process.env.GITHUB_APP_ID) ||
    undefined
  );
}

export function resolveGitHubPrivateKey(cfg?: FoxFangConfig): string | undefined {
  const pc = pluginConfig(cfg);
  const fromConfig = resolveSecret(pc?.privateKey, "plugins.entries.github.config.privateKey");
  const fromEnv = normalizeSecretInput(process.env.GITHUB_APP_PRIVATE_KEY);
  const raw = fromConfig || fromEnv;
  if (!raw) return undefined;
  // Normalize escaped newlines from env vars or JSON storage
  let pem = raw.replace(/\\n/g, "\n");
  // If still no newlines, the PEM is one long line — reconstruct with proper line breaks
  if (!pem.includes("\n")) {
    const match = pem.match(/^(-----BEGIN [^-]+-----)([A-Za-z0-9+/=]+)(-----END [^-]+-----)$/);
    if (match) {
      const [, header, body, footer] = match;
      const lines = body.match(/.{1,64}/g) ?? [];
      pem = `${header}\n${lines.join("\n")}\n${footer}\n`;
    }
  }
  return pem;
}

export function resolveGitHubInstallationId(cfg?: FoxFangConfig): string | undefined {
  const pc = pluginConfig(cfg);
  return (
    (typeof pc?.installationId === "string" ? pc.installationId.trim() : undefined) ||
    normalizeSecretInput(process.env.GITHUB_APP_INSTALLATION_ID) ||
    undefined
  );
}

export function resolveGitHubDefaultOwner(cfg?: FoxFangConfig): string | undefined {
  const pc = pluginConfig(cfg);
  return (
    (typeof pc?.defaultOwner === "string" ? pc.defaultOwner.trim() : undefined) ||
    process.env.GITHUB_DEFAULT_OWNER ||
    undefined
  );
}

export function resolveGitHubDefaultRepo(cfg?: FoxFangConfig): string | undefined {
  const pc = pluginConfig(cfg);
  return (
    (typeof pc?.defaultRepo === "string" ? pc.defaultRepo.trim() : undefined) ||
    process.env.GITHUB_DEFAULT_REPO ||
    undefined
  );
}
