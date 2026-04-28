---
summary: "Updating FoxFang safely (global install or source), plus rollback strategy"
read_when:
  - Updating FoxFang
  - Something breaks after an update
title: "Updating"
---

# Updating

Keep FoxFang up to date.

## Recommended: `foxfang update`

The fastest way to update. It detects your install type (npm or git), fetches the latest version, runs `foxfang doctor`, and restarts the gateway.

```bash
foxfang update
```

To switch channels or target a specific version:

```bash
foxfang update --channel beta
foxfang update --tag main
foxfang update --dry-run   # preview without applying
```

See [Development channels](/install/development-channels) for channel semantics.

## Alternative: re-run the installer

```bash
curl -fsSL https://foxfang.ai/install.sh | bash
```

Add `--no-onboard` to skip onboarding. For source installs, pass `--install-method git --no-onboard`.

## Alternative: manual npm or pnpm

```bash
npm i -g foxfang@latest
```

```bash
pnpm add -g foxfang@latest
```

## Auto-updater

The auto-updater is off by default. Enable it in `~/.foxfang/foxfang.json`:

```json5
{
  update: {
    channel: "stable",
    auto: {
      enabled: true,
      stableDelayHours: 6,
      stableJitterHours: 12,
      betaCheckIntervalHours: 1,
    },
  },
}
```

| Channel  | Behavior                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `stable` | Waits `stableDelayHours`, then applies with deterministic jitter across `stableJitterHours` (spread rollout). |
| `beta`   | Checks every `betaCheckIntervalHours` (default: hourly) and applies immediately.                              |
| `dev`    | No automatic apply. Use `foxfang update` manually.                                                           |

The gateway also logs an update hint on startup (disable with `update.checkOnStart: false`).

## After updating

<Steps>

### Run doctor

```bash
foxfang doctor
```

Migrates config, audits DM policies, and checks gateway health. Details: [Doctor](/gateway/doctor)

### Restart the gateway

```bash
foxfang gateway restart
```

### Verify

```bash
foxfang health
```

</Steps>

## Rollback

### Pin a version (npm)

```bash
npm i -g foxfang@<version>
foxfang doctor
foxfang gateway restart
```

Tip: `npm view foxfang version` shows the current published version.

### Pin a commit (source)

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before=\"2026-01-01\" origin/main)"
pnpm install && pnpm build
foxfang gateway restart
```

To return to latest: `git checkout main && git pull`.

## If you are stuck

- Run `foxfang doctor` again and read the output carefully.
- Check: [Troubleshooting](/gateway/troubleshooting)
- Ask in Discord: [https://discord.gg/clawd](https://discord.gg/clawd)
