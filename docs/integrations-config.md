# Integration Credentials Configuration

This guide explains how to configure credentials for Notion and GitHub App integrations. All credentials are stored in local config files — nothing is passed through chat or stored in the codebase.

---

## Notion

### Prerequisites

1. Go to https://notion.so/my-integrations
2. Click **"New integration"**
3. Give it a name, select the workspace, and click **"Submit"**
4. Copy the **Internal Integration Secret** (starts with `ntn_` or `secret_`)
5. On each Notion page or database you want the agent to access: click **"..."** → **"Connect to"** → select your integration

### Store the API key

```bash
mkdir -p ~/.config/notion
echo "ntn_your_key_here" > ~/.config/notion/api_key
chmod 600 ~/.config/notion/api_key
```

### Verify

```bash
NOTION_KEY=$(cat ~/.config/notion/api_key)
curl -s -X POST "https://api.notion.com/v1/search" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{}' | head -c 200
```

A response containing `"results"` confirms the key is working.

### How the agent uses it

The agent loads the skill at `skills/notion/SKILL.md` and reads the key from `~/.config/notion/api_key` via the `NOTION_API_KEY` environment variable or directly from the file. It then calls the Notion REST API to read and write pages, databases (data sources), and blocks.

---

## GitHub App

Use this method instead of `gh auth login` when you need to authenticate as a GitHub App — for example, to access organization repositories, use fine-grained permissions, or avoid personal account coupling.

### Prerequisites

1. Go to **GitHub → Settings → Developer settings → GitHub Apps**
2. Click **"New GitHub App"**
3. Fill in the name, homepage URL, and disable the webhook (uncheck **"Active"**)
4. Under **Permissions**, select the repository/organization permissions your agent needs
5. Click **"Create GitHub App"**
6. On the app page, note the **App ID**
7. Scroll to **"Private keys"** → click **"Generate a private key"** → a `.pem` file downloads
8. Install the app on your org/repo: **"Install App"** tab → select the account → install
9. After install, the URL will be `github.com/settings/installations/XXXXXXX` — note the **Installation ID** (the number at the end)

### Store the credentials

```bash
mkdir -p ~/.config/github-app
echo "YOUR_APP_ID"           > ~/.config/github-app/app_id
echo "YOUR_INSTALLATION_ID"  > ~/.config/github-app/installation_id
cp /path/to/your-app.pem      ~/.config/github-app/private_key.pem
chmod 600 ~/.config/github-app/private_key.pem
chmod 600 ~/.config/github-app/app_id
chmod 600 ~/.config/github-app/installation_id
```

**Example:**

```bash
echo "123456"              > ~/.config/github-app/app_id
echo "78901234"            > ~/.config/github-app/installation_id
cp ~/Downloads/my-app.pem   ~/.config/github-app/private_key.pem
chmod 600 ~/.config/github-app/private_key.pem
```

### Check connection status

```bash
node scripts/github-auth-status.mjs
```

Output example when configured:

```json
{
  "activeMethod": "github-app",
  "recommended": "github-app",
  "ready": true,
  "methods": {
    "githubApp": {
      "configured": true,
      "appId": "123456",
      "installationId": "78901234"
    }
  }
}
```

### Generate a token and use it

The private key never leaves your machine. The script signs a JWT locally and exchanges it for a short-lived installation access token (~10 minutes TTL).

```bash
# One-off command
GH_TOKEN=$(node scripts/github-app-token.mjs) gh pr list --repo owner/repo

# Export for the whole shell session
export GH_TOKEN=$(node scripts/github-app-token.mjs)
gh issue list --repo owner/repo
gh api repos/owner/repo --jq '.full_name'
```

### Auth priority

When both GitHub App and `gh` CLI are configured, the agent always prefers GitHub App:

| Priority | Method | Active when |
|----------|--------|-------------|
| 1 (highest) | GitHub App | `~/.config/github-app/` has all three files |
| 2 | Env token | `GH_TOKEN` or `GITHUB_TOKEN` is set |
| 3 | gh CLI | `gh auth login` was run |

---

## File layout summary

```
~/.config/
├── notion/
│   └── api_key                  # Notion integration secret
└── github-app/
    ├── app_id                   # GitHub App numeric ID
    ├── installation_id          # Installation numeric ID
    └── private_key.pem          # RSA private key (PEM)
```

All files are local and never committed to the repository.
