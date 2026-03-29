---
name: github
description: "GitHub operations via `gh` CLI: issues, PRs, CI runs, code review, API queries. Use when: (1) checking PR status or CI, (2) creating/commenting on issues, (3) listing/filtering PRs or issues, (4) viewing run logs. NOT for: complex web UI interactions requiring manual browser flows (use browser tooling when available), bulk operations across many repos (script with gh api), or when gh auth is not configured."
metadata:
  {
    "foxfang":
      {
        "emoji": "🐙",
        "requires": { "bins": ["gh"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "gh",
              "bins": ["gh"],
              "label": "Install GitHub CLI (brew)",
            },
            {
              "id": "apt",
              "kind": "apt",
              "package": "gh",
              "bins": ["gh"],
              "label": "Install GitHub CLI (apt)",
            },
          ],
      },
  }
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub repositories, issues, PRs, and CI.

## Auth Priority (check this first)

**Before any GitHub operation, always resolve which auth method to use:**

```bash
node scripts/github-auth-status.mjs
```

This outputs JSON with `activeMethod` — use it as follows:

| `activeMethod` | What to do |
|---|---|
| `"github-app"` | Run `export GH_TOKEN=$(node scripts/github-app-token.mjs)` then use `gh` normally |
| `"env-token"` | `GH_TOKEN`/`GITHUB_TOKEN` already set — use `gh` normally |
| `"gh-cli"` | Already logged in via `gh auth login` — use `gh` normally |
| `null` | Not connected — tell user to set up auth (see Setup below) |

**GitHub App is preferred** over `gh` CLI when both are configured. Always use GitHub App if `methods.githubApp.configured` is `true`.

### Quick check for agent

```bash
# Am I connected to GitHub?
node scripts/github-auth-status.mjs

# If githubApp.configured = true → activate it:
export GH_TOKEN=$(node scripts/github-app-token.mjs)

# Verify the token works:
gh api user --jq '.login'
```

## When to Use

✅ **USE this skill when:**

- Checking PR status, reviews, or merge readiness
- Viewing CI/workflow run status and logs
- Creating, closing, or commenting on issues
- Creating or merging pull requests
- Querying GitHub API for repository data
- Listing repos, releases, or collaborators

## When NOT to Use

❌ **DON'T use this skill when:**

- Local git operations (commit, push, pull, branch) → use `git` directly
- Non-GitHub repos (GitLab, Bitbucket, self-hosted) → different CLIs
- Cloning repositories → use `git clone`
- Reviewing actual code changes → use `coding-agent` skill
- Complex multi-file diffs → use `coding-agent` or read files directly

## Setup

### Option A — Personal account (gh CLI device flow)

```bash
# Authenticate (one-time)
gh auth login

# Verify
gh auth status
```

### Option B — GitHub App (App ID + Installation ID + Private Key)

Store credentials in files — nothing passes through chat:

```bash
mkdir -p ~/.config/github-app
echo "YOUR_APP_ID"           > ~/.config/github-app/app_id
echo "YOUR_INSTALLATION_ID"  > ~/.config/github-app/installation_id
cp /path/to/private-key.pem    ~/.config/github-app/private_key.pem
chmod 600 ~/.config/github-app/private_key.pem
```

Then generate a token and use it with `gh`:

```bash
# One-off command
GH_TOKEN=$(node scripts/github-app-token.mjs) gh pr list --repo owner/repo

# Export for the whole session
export GH_TOKEN=$(node scripts/github-app-token.mjs)
gh issue list --repo owner/repo
```

The token expires in ~10 minutes. Re-run `scripts/github-app-token.mjs` when it expires.

**Where to find your credentials:**
- `app_id` + `private_key.pem`: GitHub → Settings → Developer settings → GitHub Apps → your app
- `installation_id`: GitHub → your org/repo → Settings → Integrations → GitHub Apps → Configure → the numeric ID in the URL (`/installations/XXXXXXX`)

## Common Commands

### Pull Requests

```bash
# List PRs
gh pr list --repo owner/repo

# Check CI status
gh pr checks 55 --repo owner/repo

# View PR details
gh pr view 55 --repo owner/repo

# Create PR
gh pr create --title "feat: add feature" --body "Description"

# Merge PR
gh pr merge 55 --squash --repo owner/repo
```

### Issues

```bash
# List issues
gh issue list --repo owner/repo --state open

# Create issue
gh issue create --title "Bug: something broken" --body "Details..."

# Close issue
gh issue close 42 --repo owner/repo
```

### CI/Workflow Runs

```bash
# List recent runs
gh run list --repo owner/repo --limit 10

# View specific run
gh run view <run-id> --repo owner/repo

# View failed step logs only
gh run view <run-id> --repo owner/repo --log-failed

# Re-run failed jobs
gh run rerun <run-id> --failed --repo owner/repo
```

### API Queries

```bash
# Get PR with specific fields
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'

# List all labels
gh api repos/owner/repo/labels --jq '.[].name'

# Get repo stats
gh api repos/owner/repo --jq '{stars: .stargazers_count, forks: .forks_count}'
```

## JSON Output

Most commands support `--json` for structured output with `--jq` filtering:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
gh pr list --json number,title,state,mergeable --jq '.[] | select(.mergeable == "MERGEABLE")'
```

## Templates

### PR Review Summary

```bash
# Get PR overview for review
PR=55 REPO=owner/repo
echo "## PR #$PR Summary"
gh pr view $PR --repo $REPO --json title,body,author,additions,deletions,changedFiles \
  --jq '"**\(.title)** by @\(.author.login)\n\n\(.body)\n\n📊 +\(.additions) -\(.deletions) across \(.changedFiles) files"'
gh pr checks $PR --repo $REPO
```

### Issue Triage

```bash
# Quick issue triage view
gh issue list --repo owner/repo --state open --json number,title,labels,createdAt \
  --jq '.[] | "[\(.number)] \(.title) - \([.labels[].name] | join(", ")) (\(.createdAt[:10]))"'
```

## Notes

- Always specify `--repo owner/repo` when not in a git directory
- Use URLs directly: `gh pr view https://github.com/owner/repo/pull/55`
- Rate limits apply; use `gh api --cache 1h` for repeated queries
