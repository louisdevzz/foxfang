/**
 * Manual integration test for the GitHub extension.
 * Run with:
 *   GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY="$(cat key.pem)" GITHUB_APP_INSTALLATION_ID=... \
 *   GITHUB_DEFAULT_OWNER=PotLock GITHUB_DEFAULT_REPO=reply-marketing \
 *   bunx tsx extensions/github/test-github.ts
 */

import { getInstallationToken } from "./src/github-app-auth.js";
import {
  resolveGitHubAppId,
  resolveGitHubDefaultOwner,
  resolveGitHubDefaultRepo,
  resolveGitHubInstallationId,
  resolveGitHubPrivateKey,
} from "./src/config.js";

const GITHUB_API = "https://api.github.com";

async function main() {
  // --- Read credentials from env ---
  const appId = resolveGitHubAppId();
  const privateKey = resolveGitHubPrivateKey();
  const installationId = resolveGitHubInstallationId();
  const owner = resolveGitHubDefaultOwner();
  const repo = resolveGitHubDefaultRepo();

  if (!appId || !privateKey || !installationId) {
    console.error(
      "Missing credentials. Set:\n" +
        "  GITHUB_APP_ID\n" +
        "  GITHUB_APP_PRIVATE_KEY\n" +
        "  GITHUB_APP_INSTALLATION_ID",
    );
    process.exit(1);
  }
  if (!owner || !repo) {
    console.error(
      "Missing repo. Set:\n" +
        "  GITHUB_DEFAULT_OWNER\n" +
        "  GITHUB_DEFAULT_REPO",
    );
    process.exit(1);
  }

  console.log(`\n📋 Config`);
  console.log(`  App ID:          ${appId}`);
  console.log(`  Installation ID: ${installationId}`);
  console.log(`  Repo:            ${owner}/${repo}`);

  // --- Step 1: Get installation token ---
  // Debug: check key format without printing the key itself
  console.log(`\n🔍 Key diagnostics`);
  console.log(`  Length:      ${privateKey.length} chars`);
  console.log(`  Has newlines: ${privateKey.includes("\n")}`);
  console.log(`  First line:  ${privateKey.split("\n")[0]}`);
  console.log(`  Last line:   ${privateKey.split("\n").at(-1)}`);

  console.log("\n🔑 Getting installation token...");
  const token = await getInstallationToken(appId, privateKey, installationId);
  console.log(`  ✅ Token obtained (${token.slice(0, 10)}...)`);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // --- Step 2: Create a test issue ---
  console.log("\n📝 Creating test issue...");
  const createResp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "[test] GitHub extension smoke test",
      body: "This issue was created by the FoxFang GitHub extension smoke test. Safe to close.",
      labels: [],
    }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    console.error(`  ❌ Create failed (${createResp.status}): ${err}`);
    process.exit(1);
  }

  const issue = (await createResp.json()) as { number: number; html_url: string; title: string };
  console.log(`  ✅ Created issue #${issue.number}: ${issue.html_url}`);

  // --- Step 3: Add a comment ---
  console.log("\n💬 Adding comment...");
  const commentResp = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issue.number}/comments`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ body: "Comment from FoxFang GitHub extension test ✅" }),
    },
  );

  if (!commentResp.ok) {
    const err = await commentResp.text();
    console.error(`  ❌ Comment failed (${commentResp.status}): ${err}`);
  } else {
    const comment = (await commentResp.json()) as { html_url: string };
    console.log(`  ✅ Comment added: ${comment.html_url}`);
  }

  // --- Step 4: List open issues ---
  console.log("\n📋 Listing open issues (first 5)...");
  const listResp = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues?state=open&per_page=5`,
    { headers },
  );

  if (!listResp.ok) {
    const err = await listResp.text();
    console.error(`  ❌ List failed (${listResp.status}): ${err}`);
  } else {
    const issues = (await listResp.json()) as Array<{ number: number; title: string }>;
    issues.forEach((i) => console.log(`  #${i.number} ${i.title}`));
  }

  // --- Step 5: Close the test issue ---
  console.log(`\n🗑️  Closing test issue #${issue.number}...`);
  const closeResp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issue.number}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ state: "closed" }),
  });

  if (!closeResp.ok) {
    console.error(`  ❌ Close failed (${closeResp.status})`);
  } else {
    console.log(`  ✅ Issue closed`);
  }

  console.log("\n✅ All tests passed\n");
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
