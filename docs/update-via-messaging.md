# Update FoxFang via Messaging Channels

## Overview

FoxFang now supports updating via messaging channels (Signal, Telegram, Discord, etc.). This allows you to trigger updates and check status without needing to access the command line directly.

## Available Tools

### 1. `foxfang_update`

Update FoxFang from git and optionally restart the daemon.

**Parameters:**
- `channel` (string, optional): Update channel - `dev` (main branch), `beta` (latest beta tag), or `stable` (latest stable tag). Default: `dev`
- `no_restart` (boolean, optional): Skip restarting the daemon after update. Default: `false`
- `timeout` (number, optional): Timeout for each step in seconds. Default: `1200`

**Example Usage:**

Via Signal/Telegram/Discord message:
```
Update FoxFang to the latest dev version
```

The agent will call the tool and respond with:
```
Update successful!

Mode: git
Duration: 45.2s
Version: 1.0.0 -> 1.0.1
Commit: abc1234 -> def5678

Daemon restarted successfully

Steps executed:
[OK] git fetch (2.1s)
[OK] git rebase (3.5s)
[OK] pnpm install (25.3s)
[OK] pnpm build (12.8s)
```

### 2. `foxfang_update_status`

Check the current update status of FoxFang, including git status and daemon status.

**Parameters:** None

**Example Usage:**

Via Signal/Telegram/Discord message:
```
Check FoxFang update status
```

The agent will respond with:
```
FoxFang Update Status

Git Status:
- Branch: main
- Commit: abc1234
- Remote: origin/main
- Status: Up to date

Daemon Status:
- Status: Running
- Platform: launchd
```

## How It Works

### Message Flow

1. **User sends message** via messaging channel (Signal, Telegram, Discord, etc.)
2. **Agent receives message** and determines if update is needed
3. **Agent calls tool** `foxfang_update` or `foxfang_update_status`
4. **Tool executes** the update or status check
5. **Agent responds** with the results

### Update Process

When you request an update via messaging:

1. **Check git status** - Verifies you're in a git repository
2. **Check for uncommitted changes** - Skips update if there are uncommitted changes
3. **Fetch updates** - Runs `git fetch --all --prune --tags`
4. **Checkout appropriate branch/tag**:
   - `dev`: Checkout `main` and rebase from `origin/main`
   - `stable`/`beta`: Checkout latest stable/beta tag
5. **Install dependencies** - Runs `pnpm install`
6. **Build** - Runs `pnpm build`
7. **Restart daemon** - Automatically restarts the service

## Example Conversations

### Example 1: Simple Update

**User:** Update FoxFang

**Agent:** I'll update FoxFang to the latest version from the dev channel.

[Agent calls `foxfang_update` tool]

**Agent:** Update successful!

Mode: git
Duration: 42.8s
Version: 1.0.0 -> 1.0.1
Commit: abc1234 -> def5678

Daemon restarted successfully

Steps executed:
[OK] git fetch (2.1s)
[OK] git rebase (3.5s)
[OK] pnpm install (25.3s)
[OK] pnpm build (12.8s)

### Example 2: Update to Stable Channel

**User:** Update FoxFang to the stable version

**Agent:** I'll update FoxFang to the latest stable release.

[Agent calls `foxfang_update` with channel="stable"]

**Agent:** Update successful!

Mode: git
Duration: 38.5s
Version: 1.0.0 -> 1.0.2
Commit: abc1234 -> xyz7890

Daemon restarted successfully

Steps executed:
[OK] git fetch (2.0s)
[OK] git checkout v1.0.2 (1.2s)
[OK] pnpm install (24.5s)
[OK] pnpm build (10.8s)

### Example 3: Check Status

**User:** What's the current status of FoxFang?

**Agent:** Let me check the current update status.

[Agent calls `foxfang_update_status` tool]

**Agent:** FoxFang Update Status

Git Status:
- Branch: main
- Commit: abc1234
- Remote: origin/main
- Behind: 3 commits
- Status: Updates available

Daemon Status:
- Status: Running
- Platform: launchd

There are 3 new commits available. Would you like me to update FoxFang?

### Example 4: Update Without Restart

**User:** Update FoxFang but don't restart the daemon yet

**Agent:** I'll update FoxFang but skip the daemon restart.

[Agent calls `foxfang_update` with no_restart=true]

**Agent:** Update successful!

Mode: git
Duration: 40.2s
Version: 1.0.0 -> 1.0.1
Commit: abc1234 -> def5678

Note: Daemon was not restarted. You can restart it manually with:
foxfang daemon restart

### Example 5: Update Failed

**User:** Update FoxFang

**Agent:** I'll update FoxFang to the latest version.

[Agent calls `foxfang_update` tool]

**Agent:** Update failed

Reason: uncommitted-changes

Please commit or stash your changes first:
- git commit -am "Save changes"
- or git stash

## Security Considerations

### Access Control

The update tools are available to all agents by default. To restrict access:

1. **Configure tool allowlist** in `foxfang.json`:
```json
{
  "tools": {
    "allowlist": ["foxfang_update", "foxfang_update_status"]
  }
}
```

2. **Use agent-specific permissions** to control which agents can call update tools

### Best Practices

1. **Test updates in dev channel first** before using stable channel
2. **Monitor update logs** to ensure updates complete successfully
3. **Have a rollback plan** in case updates fail
4. **Schedule updates during low-traffic periods** to minimize disruption
5. **Keep backups** of important data before updating

## Troubleshooting

### Update Skipped Due to Uncommitted Changes

**Problem:** Update fails with "uncommitted-changes"

**Solution:** Commit or stash your changes first:
```bash
git commit -am "Save changes"
# or
git stash
```

Then request the update again.

### Update Failed During Build

**Problem:** Update fails during build step

**Solution:** Check the build logs and fix any errors:
```bash
pnpm install
pnpm build
```

Then request the update again.

### Daemon Restart Failed

**Problem:** Update succeeds but daemon restart fails

**Solution:** Restart daemon manually:
```bash
foxfang daemon restart
```

Or check daemon status:
```bash
foxfang daemon status
foxfang daemon logs
```

### Update Takes Too Long

**Problem:** Update is taking longer than expected

**Solution:** Increase timeout:
```
Update FoxFang with a timeout of 1800 seconds
```

Or check for network issues and try again.

## Integration with Messaging Channels

### Signal

Configure Signal channel in FoxFang:
```bash
foxfang channels setup signal
```

Then send messages to update FoxFang.

### Telegram

Configure Telegram channel in FoxFang:
```bash
foxfang channels setup telegram
```

Then send messages to update FoxFang.

### Discord

Configure Discord channel in FoxFang:
```bash
foxfang channels setup discord
```

Then send messages to update FoxFang.

## Advanced Usage

### Scheduled Updates

Use the cron tool to schedule automatic updates:
```
Schedule a daily update at 2 AM
```

The agent will call `foxfang_update` automatically at the scheduled time.

### Conditional Updates

Create conditional update logic:
```
Check if there are updates available, and if so, update FoxFang
```

The agent will first call `foxfang_update_status`, then call `foxfang_update` if updates are available.

### Update Notifications

Set up notifications for successful updates:
```
Update FoxFang and notify me when complete
```

The agent will update and then send you a notification via your configured messaging channel.

## Comparison with CLI Update

| Feature | CLI Update | Messaging Update |
|---------|------------|------------------|
| Requires terminal | ✅ Yes | ❌ No |
| Real-time progress | ✅ Yes | ✅ Yes |
| Automatic restart | ✅ Yes | ✅ Yes |
| Status checking | ✅ Yes | ✅ Yes |
| Channel selection | ✅ Yes | ✅ Yes |
| Remote execution | ❌ No | ✅ Yes |
| Scheduling | ❌ No | ✅ Yes |

## Future Enhancements

Potential improvements:

1. **Rollback support**: Automatically revert on failure
2. **Update notifications**: Proactively notify when updates available
3. **Update history**: Track update history and versions
4. **Update validation**: Verify update integrity before applying
5. **Update scheduling**: Built-in scheduling without cron
6. **Update preview**: Show what will change before updating
7. **Update rollback**: Easy rollback to previous version
8. **Update testing**: Test updates in staging environment first

## Conclusion

The messaging-based update system provides a convenient way to update FoxFang without needing terminal access. It's especially useful for:

- Remote management
- Automated updates
- Scheduled maintenance
- Team collaboration
- Monitoring and alerting

Combined with the CLI update command, you have flexible options for managing FoxFang updates in any scenario.
