#!/usr/bin/env node
/**
 * Generate a GitHub App installation access token.
 *
 * Reads credentials from:
 *   ~/.config/github-app/app_id          — numeric App ID
 *   ~/.config/github-app/installation_id — numeric Installation ID
 *   ~/.config/github-app/private_key.pem — RSA private key (PEM)
 *
 * Usage:
 *   node scripts/github-app-token.mjs
 *   # prints the token to stdout
 *
 *   # use directly with gh CLI:
 *   GH_TOKEN=$(node scripts/github-app-token.mjs) gh pr list --repo owner/repo
 *
 *   # or export for the session:
 *   export GH_TOKEN=$(node scripts/github-app-token.mjs)
 */

import { createSign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".config", "github-app");

function readCredential(filename) {
  const filePath = join(CONFIG_DIR, filename);
  if (!existsSync(filePath)) {
    console.error(`Missing: ${filePath}`);
    console.error(`\nSetup instructions:`);
    console.error(`  mkdir -p ~/.config/github-app`);
    console.error(`  echo "YOUR_APP_ID"          > ~/.config/github-app/app_id`);
    console.error(`  echo "YOUR_INSTALLATION_ID" > ~/.config/github-app/installation_id`);
    console.error(`  cp /path/to/private-key.pem   ~/.config/github-app/private_key.pem`);
    console.error(`  chmod 600 ~/.config/github-app/private_key.pem`);
    process.exit(1);
  }
  return readFileSync(filePath, "utf-8").trim();
}

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function buildJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat: now - 60, // issued 60s ago to allow clock drift
      exp: now + 540, // expires in 9 minutes (max 10m)
      iss: appId,
    }),
  );
  const data = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  const signature = base64url(sign.sign(privateKey));
  return `${data}.${signature}`;
}

async function getInstallationToken(jwt, installationId) {
  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "foxfang-github-app",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`GitHub API error ${response.status}: ${body}`);
    process.exit(1);
  }

  const data = await response.json();
  return data.token;
}

const appId = readCredential("app_id");
const installationId = readCredential("installation_id");
const privateKey = readCredential("private_key.pem");

const jwt = buildJwt(appId, privateKey);
const token = await getInstallationToken(jwt, installationId);
process.stdout.write(token);
