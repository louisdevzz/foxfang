# FoxFang Daemon & Update System

## Overview

FoxFang now includes a comprehensive daemon management and update system inspired by OpenClaw, allowing you to:

1. **Run FoxFang as a background service** - No more foreground processes that stop when you close the terminal
2. **Easy start/stop/restart** - Simple commands to manage the daemon
3. **Self-updates** - Update FoxFang from git with automatic daemon restart
4. **Multiple update channels** - Support for dev, beta, and stable channels

## Daemon Management

### Installation

Install FoxFang as a system service:

```bash
# Install gateway service (macOS: launchd, Linux: systemd)
foxfang daemon install

# Install with custom port and channels
foxfang daemon install --port 8787 --channels signal,telegram
```

### Basic Commands

```bash
# Start the daemon
foxfang daemon start

# Stop the daemon
foxfang daemon stop

# Restart the daemon
foxfang daemon restart

# Check status
foxfang daemon status

# View logs
foxfang daemon logs

# Uninstall the service
foxfang daemon uninstall
```

### Foreground Mode

For development or debugging, you can run the gateway in foreground mode:

```bash
# Run in foreground (stops when you press Ctrl+C)
foxfang daemon run

# Run with specific port and channels
foxfang daemon run --port 8787 --channels signal,telegram

# Run with all configured channels
foxfang daemon run --all-channels
```

## Update System

### Basic Usage

```bash
# Update from git (default: dev channel)
foxfang update

# Update from specific channel
foxfang update --channel dev
foxfang update --channel beta
foxfang update --channel stable

# Update without restarting daemon
foxfang update --no-restart

# Check update status
foxfang update status
```

### Update Flow

The update command performs these steps automatically:

1. **Check git status** - Verifies you're in a git repository
2. **Check for uncommitted changes** - Skips if there are uncommitted changes
3. **Fetch updates** - `git fetch --all --prune --tags`
4. **Checkout appropriate branch/tag**:
   - `dev`: Checkout `main` and rebase from `origin/main`
   - `stable`/`beta`: Checkout latest stable/beta tag
5. **Install dependencies** - `pnpm install`
6. **Build** - `pnpm build`
7. **Restart daemon** - Automatically restarts the service

### Update Channels

- **dev**: Updates from the `main` branch (latest development)
- **beta**: Updates from the latest beta tag
- **stable**: Updates from the latest stable tag

## Comparison with OpenClaw

### Similarities

- **Daemon management**: Both use system services (launchd/systemd)
- **Update channels**: Support for dev, beta, and stable channels
- **Automatic restart**: Daemon restarts after successful update
- **Git-based updates**: Pull from git and rebuild
- **Status checking**: Commands to check update and daemon status

### Differences

| Feature | OpenClaw | FoxFang |
|---------|----------|---------|
| Preflight builds | ✅ Complex worktree validation | ❌ Not implemented |
| Rollback logic | ✅ Automatic rollback on failure | ❌ Not implemented |
| Package manager support | npm, pnpm, bun | pnpm only |
| Update complexity | High (10+ steps for dev) | Medium (6 steps for dev) |
| Doctor integration | ✅ Runs doctor after update | ❌ Not implemented |
| UI assets | ✅ Builds and verifies UI | ✅ Builds UI |

### Why FoxFang is Simpler

FoxFang's update system is intentionally simpler than OpenClaw's:

1. **Single package manager**: Uses pnpm exclusively (simpler dependency management)
2. **No preflight validation**: Assumes main branch is always buildable
3. **No rollback**: If update fails, manual intervention is required
4. **Focused on dev channel**: Primary use case is updating from main branch

This simplicity makes the code easier to maintain and understand while still providing the core functionality needed.

## Platform Support

### macOS (launchd)

- Service files: `~/Library/LaunchAgents/com.foxfang.gateway.plist`
- Logs: `~/Library/Logs/com.foxfang.gateway.log`
- Management: `launchctl` commands

### Linux (systemd)

- Service files: `~/.config/systemd/user/foxfang-gateway.service`
- Logs: `journalctl --user -u foxfang-gateway`
- Management: `systemctl --user` commands

## Troubleshooting

### Daemon won't start

```bash
# Check status
foxfang daemon status

# View logs
foxfang daemon logs

# Check if service is installed
launchctl list | grep foxfang  # macOS
systemctl --user list-units | grep foxfang  # Linux
```

### Update fails with "uncommitted changes"

```bash
# Commit your changes
git commit -am "Save changes"

# Or stash them
git stash

# Then run update again
foxfang update
```

### Update fails during build

```bash
# Check build logs
foxfang update

# Look for the failed step in the output

# Try building manually
pnpm install
pnpm build
```

### Daemon restart fails after update

```bash
# Manually restart daemon
foxfang daemon restart

# Or start it
foxfang daemon start

# Check status
foxfang daemon status
```

## Development Workflow

For development, use the foreground mode:

```bash
# Run in foreground for development
foxfang daemon run

# Make changes to code
# ...

# Build
pnpm build

# Restart foreground process (Ctrl+C, then run again)
foxfang daemon run
```

For production, use the daemon service:

```bash
# Install as service
foxfang daemon install

# Start service
foxfang daemon start

# Make changes and update
foxfang update

# Daemon automatically restarts with new version
```

## Security Considerations

- All data stored locally by default
- API keys stored via credentials/keychain store
- Service runs with user permissions (no root required)
- Git updates require clean working directory
- Build failures prevent broken deployments

## Future Enhancements

Potential improvements to consider:

1. **Preflight validation**: Test build in temporary worktree before applying
2. **Rollback support**: Automatically revert on update failure
3. **Health checks**: Verify daemon is healthy after restart
4. **Update notifications**: Notify when updates are available
5. **Scheduled updates**: Cron-based automatic updates
6. **Multiple environments**: Support dev/staging/production configs
