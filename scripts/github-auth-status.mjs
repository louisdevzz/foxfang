#!/usr/bin/env node
/**
 * Check which GitHub auth method is configured and active.
 *
 * Exit codes:
 *   0 — at least one method is available
 *   1 — no auth configured
 *
 * Stdout: JSON with auth status for agent consumption.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const CONFIG_DIR = join(homedir(), ".config", "github-app");

function checkGitHubApp() {
  const appIdPath = join(CONFIG_DIR, "app_id");
  const installationIdPath = join(CONFIG_DIR, "installation_id");
  const privateKeyPath = join(CONFIG_DIR, "private_key.pem");

  const hasAppId = existsSync(appIdPath);
  const hasInstallationId = existsSync(installationIdPath);
  const hasPrivateKey = existsSync(privateKeyPath);

  if (!hasAppId || !hasInstallationId || !hasPrivateKey) {
    return {
      configured: false,
      missing: [
        !hasAppId && "~/.config/github-app/app_id",
        !hasInstallationId && "~/.config/github-app/installation_id",
        !hasPrivateKey && "~/.config/github-app/private_key.pem",
      ].filter(Boolean),
    };
  }

  const appId = readFileSync(appIdPath, "utf-8").trim();
  const installationId = readFileSync(installationIdPath, "utf-8").trim();

  return {
    configured: true,
    appId,
    installationId,
    privateKeyPath,
  };
}

function checkGhCli() {
  try {
    const result = execSync("gh auth status 2>&1", { encoding: "utf-8", timeout: 5000 });
    const loggedIn = result.includes("Logged in to github.com");
    const account = result.match(/account (.+?) \(/)?.[1] ?? null;
    return { configured: true, loggedIn, account, raw: result.trim() };
  } catch {
    return { configured: false };
  }
}

function checkEnvToken() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    return { configured: true, source: process.env.GH_TOKEN ? "GH_TOKEN" : "GITHUB_TOKEN" };
  }
  return { configured: false };
}

const app = checkGitHubApp();
const cli = checkGhCli();
const env = checkEnvToken();

// Priority: GitHub App > env token > gh CLI
const activeMethod = app.configured
  ? "github-app"
  : env.configured
    ? "env-token"
    : cli.configured
      ? "gh-cli"
      : null;

const result = {
  activeMethod,
  recommended: "github-app",
  ready: activeMethod !== null,
  methods: {
    githubApp: app,
    envToken: env,
    ghCli: cli,
  },
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ready ? 0 : 1);
