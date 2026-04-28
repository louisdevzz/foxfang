---
title: "GitHub PR Auto-Reviewer"
summary: "Plan for building automatic PR review via GitHub App webhooks and FoxFang agent"
---

# GitHub PR Auto-Reviewer — Implementation Plan

Automatically trigger the FoxFang agent to review pull requests when they are opened or updated on GitHub, and post the review as a GitHub PR review comment.

---

## Architecture Overview

```
GitHub PR opened/updated
        ↓
GitHub App sends webhook POST
        ↓
FoxFang gateway receives webhook
(gateway method: github.webhook)
        ↓
Validate webhook signature (HMAC-SHA256)
        ↓
Parse PR event → enqueue system event
        ↓
Agent wakes up, reads PR diff via github_get_pr tool
        ↓
Agent reviews code changes
        ↓
Agent posts review via github_add_pr_review tool
```

---

## Phase 1 — New GitHub PR Tools

Add 3 new tools to `extensions/github/src/`:

### 1. `github_get_pr` (`github-get-pr-tool.ts`)

Fetch PR metadata + unified diff:

```
GET /repos/{owner}/{repo}/pulls/{pull_number}
GET /repos/{owner}/{repo}/pulls/{pull_number}/files
```

Parameters:
- `owner` — repo owner (optional, falls back to defaultOwner)
- `repo` — repo name (optional, falls back to defaultRepo)
- `pull_number` — PR number (required)

Returns: PR title, description, author, base/head branches, list of changed files with patches (diffs).

### 2. `github_add_pr_review` (`github-add-pr-review-tool.ts`)

Post a review on a PR:

```
POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
```

Parameters:
- `owner`, `repo`, `pull_number`
- `event` — `"COMMENT"` | `"APPROVE"` | `"REQUEST_CHANGES"`
- `body` — Overall review summary (markdown)
- `comments` — (optional) JSON array of inline comments: `[{ path, line, body }]`

### 3. `github_list_prs` (`github-list-prs-tool.ts`)

List open PRs in a repo:

```
GET /repos/{owner}/{repo}/pulls?state=open
```

Parameters:
- `owner`, `repo`
- `state` — `"open"` | `"closed"` | `"all"` (default: open)

---

## Phase 2 — Webhook Handler

### New file: `extensions/github/src/github-webhook-handler.ts`

Register an HTTP route in the plugin to receive GitHub webhook POSTs:

```typescript
api.registerHttpRoute({
  method: "POST",
  path: "/webhooks/github",
  scope: "plugin",
  handler: async ({ req, respond, context }) => {
    // 1. Validate HMAC-SHA256 signature (X-Hub-Signature-256 header)
    // 2. Parse event type (X-GitHub-Event header)
    // 3. Handle pull_request events (action: opened, synchronize, reopened)
    // 4. Enqueue system event into target agent session
    // 5. Respond 200 OK immediately (GitHub expects fast response)
  }
});
```

**Webhook signature validation:**
```typescript
import { createHmac } from "node:crypto";

function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  return expected === signature;
}
```

**System event format injected into agent:**
```
[GitHub Webhook] PR #42 opened in PotLock/foxfang
Title: "Fix: normalize newlines in issue body"
Author: @louisdevzz
Branch: fix/newlines → main
Files changed: 3

Please review this PR using github_get_pr, then post your review using github_add_pr_review.
```

---

## Phase 3 — Agent Behavior (SOUL.md / SKILLS.md)

Add to `~/.foxfang/workspace/SKILLS.md`:

```markdown
## GitHub PR Review

When you receive a GitHub webhook system event for a pull request:

1. Call `github_get_pr` with the PR number and repo to get diff + changed files
2. Review each changed file: check for bugs, logic errors, security issues, code style
3. Write a concise review summary
4. Call `github_add_pr_review` with:
   - event: "COMMENT" (default), "APPROVE" if clean, "REQUEST_CHANGES" if critical issues
   - body: overall review summary
   - comments: inline comments on specific lines where relevant
5. Do this automatically without asking for confirmation
```

---

## Phase 4 — GitHub App Configuration

In the GitHub App settings (https://github.com/settings/apps/YOUR_APP):

1. **Webhook URL:** `https://your-server:18789/webhooks/github`
2. **Webhook secret:** Set a secret → add to `foxfang.json` as `plugins.entries.github.config.webhookSecret`
3. **Permissions:**
   - Pull requests: Read & Write
   - Contents: Read
4. **Subscribe to events:**
   - Pull request

---

## Config Changes

Add `webhookSecret` to `foxfang.json`:

```json
"github": {
  "enabled": true,
  "config": {
    "appId": "...",
    "privateKey": "...",
    "installationId": "...",
    "webhookSecret": "YOUR_WEBHOOK_SECRET",
    "defaultOwner": "PotLock"
  }
}
```

Add `resolveGitHubWebhookSecret()` to `extensions/github/src/config.ts`.

---

## Files to Create / Modify

| Action | File |
|--------|------|
| Create | `extensions/github/src/github-get-pr-tool.ts` |
| Create | `extensions/github/src/github-add-pr-review-tool.ts` |
| Create | `extensions/github/src/github-list-prs-tool.ts` |
| Create | `extensions/github/src/github-webhook-handler.ts` |
| Modify | `extensions/github/src/config.ts` — add `resolveGitHubWebhookSecret` |
| Modify | `extensions/github/index.ts` — register new tools + webhook handler |
| Modify | `extensions/github/foxfang.plugin.json` — add new tool names to contracts |
| Update | `~/.foxfang/workspace/SKILLS.md` — add PR review workflow |

---

## Key Code Patterns to Reuse

| Pattern | Source |
|---------|--------|
| Tool factory | `extensions/github/src/github-create-issue-tool.ts` |
| GitHub API auth | `extensions/github/src/github-app-auth.ts` — `githubFetch()` |
| HTTP route registration | `extensions/diffs/index.ts` — `api.registerHttpRoute()` |
| System event injection | `src/infra/system-events.ts` — `enqueueSystemEvent()` |
| Gateway method handler types | `src/gateway/server-methods/types.ts` |

---

## Verification

1. Set up ngrok or expose server port publicly
2. Configure GitHub App webhook URL → `https://your-server/webhooks/github`
3. Open a test PR in the configured repo
4. Check `foxfang logs --follow` → should see webhook received + agent triggered
5. Check the PR on GitHub → agent should have posted a review within ~30 seconds
