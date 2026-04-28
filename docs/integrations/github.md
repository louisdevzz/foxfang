---
title: "GitHub"
summary: "Create and manage GitHub issues directly from FoxFang agents using a GitHub App"
read_when:
  - Setting up GitHub issue creation from Signal or other channels
  - Configuring the GitHub plugin
---

# GitHub (App Integration)

The GitHub plugin lets FoxFang agents create issues, list issues, and add comments on GitHub repositories — authenticated via a **GitHub App** (not a personal token or `gh` CLI).

Using a GitHub App gives you fine-grained permissions, works across organizations, and doesn't expire like personal tokens do.

## What you can do

- **Create issues** from Signal messages, agent conversations, or any trigger
- **List issues** so agents can check for duplicates before filing
- **Add comments** to existing issues with follow-up context

---

## Setup overview

1. Create a GitHub App in your org or personal account
2. Install the app on the target repository
3. Get your App ID, private key, and Installation ID
4. Configure the FoxFang GitHub plugin with those credentials

---

## Step-by-step

<Steps>

<Step title="Create a GitHub App">

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**.

If you want the app to operate under an organization (recommended for team repos), go to your **org settings** instead: `https://github.com/organizations/<your-org>/settings/apps/new`.

Fill in:

| Field | Value |
|---|---|
| **GitHub App name** | Something like `FoxFang Bot` |
| **Homepage URL** | Any URL (e.g. `https://foxfang.ai`) |
| **Webhook** | Uncheck **Active** — FoxFang pulls, not listens |

Under **Repository permissions**, set:

| Permission | Level |
|---|---|
| Issues | **Read & Write** |
| Metadata | **Read-only** (required by GitHub) |

Leave everything else at **No access** unless you need it.

Scroll down and click **Create GitHub App**.

</Step>

<Step title="Note your App ID">

After creating the app, you land on the app's settings page.

At the top you will see **App ID** — a number like `1234567`. Copy it.

This is your `GITHUB_APP_ID`.

</Step>

<Step title="Generate a private key">

Still on the app settings page, scroll down to **Private keys** and click **Generate a private key**.

GitHub downloads a `.pem` file. Keep this safe — it acts as the app's password.

<Warning>
The private key cannot be retrieved again after closing the page. Store it securely (e.g. a password manager or secret manager). If lost, generate a new one and delete the old one from the app settings.
</Warning>

The file contents look like:

```
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
(many lines)
...
-----END RSA PRIVATE KEY-----
```

This is your `GITHUB_APP_PRIVATE_KEY`.

</Step>

<Step title="Install the app on your repository">

In the app settings sidebar, click **Install App**.

Choose the account or organization, then select **Only select repositories** and pick the repo(s) where FoxFang should create issues (e.g. `reply-marketing`).

Click **Install**.

</Step>

<Step title="Get the Installation ID">

After installing, GitHub redirects you to a URL like:

```
https://github.com/organizations/<org>/settings/installations/12345678
```

The number at the end (`12345678`) is your **Installation ID**.

You can also find it by calling the GitHub API:

```bash
# Replace <APP_ID> and <PEM_PATH> with your values
curl -s \
  -H "Authorization: Bearer $(node -e "
    const {createSign}=require('crypto');
    const fs=require('fs');
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
    const p=Buffer.from(JSON.stringify({iat:now-60,exp:now+540,iss:'<APP_ID>'})).toString('base64url');
    const s=createSign('RSA-SHA256');s.update(h+'.'+p);
    console.log(h+'.'+p+'.'+s.sign(fs.readFileSync('<PEM_PATH>'),'base64url'));
  ")" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/app/installations | jq '.[].id'
```

This is your `GITHUB_APP_INSTALLATION_ID`.

</Step>

<Step title="Configure the FoxFang plugin">

You can provide credentials via **environment variables** (recommended for servers) or via the **FoxFang config file** at `~/.foxfang/foxfang.json`.

### Option A — Environment variables

Add these to your shell profile (`~/.profile`, `~/.zshrc`, etc.) or your server's environment:

```bash
export GITHUB_APP_ID="1234567"
export GITHUB_APP_PRIVATE_KEY="$(cat /path/to/your-app.private-key.pem)"
export GITHUB_APP_INSTALLATION_ID="12345678"

# Optional: set defaults so agents don't need to specify repo on every call
export GITHUB_DEFAULT_OWNER="PotLock"
export GITHUB_DEFAULT_REPO="reply-marketing"
```

<Note>
`$(cat file)` preserves newlines in the PEM correctly. The plugin also handles escaped `\n` if that's what your secret manager stores.
</Note>

### Option B — FoxFang config file (`~/.foxfang/foxfang.json`)

FoxFang reads its main config from `~/.foxfang/foxfang.json` (JSON5 — comments and trailing commas allowed).

**Method 1: CLI one-liners (recommended — avoids editing the file manually)**

```bash
foxfang config set plugins.entries.github.config.appId "1234567"
foxfang config set plugins.entries.github.config.installationId "12345678"
foxfang config set plugins.entries.github.config.defaultOwner "PotLock"
foxfang config set plugins.entries.github.config.defaultRepo "reply-marketing"

# Private key — read from the .pem file to avoid shell escaping issues
foxfang config set plugins.entries.github.config.privateKey "$(cat /path/to/your-app.private-key.pem)"
```

**Method 2: Direct edit of `~/.foxfang/foxfang.json`**

Open `~/.foxfang/foxfang.json` in any editor and add the `plugins` block (merge with any existing content):

```json5
// ~/.foxfang/foxfang.json
{
  // ... your existing config ...

  plugins: {
    entries: {
      github: {
        config: {
          appId: "1234567",
          privateKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----",
          installationId: "12345678",
          defaultOwner: "PotLock",   // optional default org/user
          defaultRepo: "reply-marketing",  // optional default repo
        },
      },
    },
  },
}
```

<Note>
The Gateway watches `~/.foxfang/foxfang.json` and hot-reloads on save — no restart needed.
</Note>

<Warning>
FoxFang validates the config schema strictly. If you add unknown keys or wrong types, the Gateway will refuse to start. Run `foxfang doctor` to see validation errors.
</Warning>

**Method 3: Control UI**

Open [http://127.0.0.1:18789](http://127.0.0.1:18789) → **Config** tab → find the `plugins.entries.github` section and fill in the fields in the form.

</Step>

</Steps>

---

## Available tools

Once configured, the agent has access to three tools:

### `github_create_issue`

Creates a new issue. The agent uses this automatically when you ask it to log something as a GitHub issue — for example, forwarding a Signal message.

| Parameter | Required | Description |
|---|---|---|
| `title` | Yes | Issue title |
| `body` | No | Issue body (markdown) |
| `owner` | No | GitHub org/user (falls back to `defaultOwner`) |
| `repo` | No | Repo name (falls back to `defaultRepo`) |
| `assignees` | No | Comma-separated GitHub usernames |
| `labels` | No | Comma-separated label names |
| `milestone` | No | Milestone number |

### `github_list_issues`

Lists issues in a repository. Useful for the agent to check before creating a duplicate.

| Parameter | Required | Description |
|---|---|---|
| `state` | No | `open` (default), `closed`, or `all` |
| `assignee` | No | Filter by assignee |
| `labels` | No | Filter by labels |
| `limit` | No | Max results (1–100, default 20) |

### `github_add_comment`

Adds a comment to an existing issue.

| Parameter | Required | Description |
|---|---|---|
| `issue_number` | Yes | Issue number |
| `body` | Yes | Comment text (markdown) |

---

## Signal → GitHub issue workflow

With the GitHub plugin enabled alongside the Signal channel, the agent can receive a message on Signal and turn it into a GitHub issue.

**Example prompt to the agent:**

> "Create a GitHub issue from this Signal message: 'Need to add UTM tracking to the reply.cash landing page CTA buttons — assigned to @alice'"

The agent will:
1. Parse the title, body, and assignee from the message
2. Call `github_create_issue` with the extracted fields
3. Reply with the issue URL: `https://github.com/PotLock/reply-marketing/issues/42`

---

## Troubleshooting

**`GitHub App auth failed (401)`**
- Check that your App ID is correct (numeric, not the app slug)
- Verify the private key PEM is complete — must include the `-----BEGIN-----` and `-----END-----` lines
- Make sure the app is installed on the target repository

**`GitHub API error (404)` on issue creation**
- The app may not be installed on that specific repository
- Check `owner`/`repo` values match exactly (case-sensitive)

**`Resource not accessible by integration (403)`**
- The app's **Issues** permission is set to **No access** — go back to the app settings and set it to **Read & Write**, then reinstall

**Private key with `\n` in env var**
- The plugin automatically converts literal `\n` to real newlines, so both formats work

---

## Security notes

- The private key gives full access to every repo the app is installed on — treat it like a password
- Use **Only select repositories** during installation to limit scope
- Rotate the private key periodically from the GitHub App settings page
- Never commit the private key to source control — use env vars or a secret manager
