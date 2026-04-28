---
title: "TOOLS.md Template"
summary: "Workspace template for TOOLS.md"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

## Screenshots & Browser Files

Screenshots are saved to `/tmp/foxfang/` (or the path returned by `resolvePreferredFoxFangTmpDir()`).

**Important — Snap Chromium issue on Ubuntu servers:**
- Snap Chromium virtualizes `/tmp` — files written appear to succeed but are NOT accessible by FoxFang
- Fix: use Google Chrome (non-Snap) with `browser.executablePath=/usr/bin/google-chrome-stable` and `browser.noSandbox=true`
- After taking a screenshot, verify the file exists before trying to send it

## Web Tools

Two separate tools available:

- **`web_fetch`** — HTTP fetch (static pages, APIs, llms.txt). Always available.
- **`browser`** — Full Playwright browser control (SPAs, interactive pages, screenshots). Requires `browser.enabled=true` in foxfang.json.

For Reply.cash: use `web_fetch` on `https://reply.cash/llms.txt` (static, AI-readable). The main site `https://reply.cash` is a SPA — use `browser` if available, otherwise use `https://marketing.reply.cash/narrative` via `web_fetch`.

Do NOT pre-explain tool limitations. Try the tool first, report failure only if it actually fails.

## GitHub

GitHub access is via the **GitHub App plugin** — NOT the `gh` CLI.

Available tools (already authenticated):
- `github_create_issue` — create issues in a repo
- `github_list_issues` — list/search issues
- `github_add_comment` — add a comment to an issue

Do NOT run `gh auth status` or suggest `gh` CLI setup. The plugin handles auth automatically via App ID + private key.

When asked about GitHub access, use the tools above directly.
