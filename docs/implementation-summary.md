# FoxFang Update & Daemon Implementation Summary

## Problem Statement

The user identified several issues with FoxFang compared to OpenClaw:

1. **No self-update capability**: Users cannot easily update FoxFang from git
2. **No proper background daemon**: `pnpm foxfang daemon run` only runs in foreground
3. **No easy start/stop/restart**: Difficult to manage the daemon lifecycle
4. **No automatic restart after update**: Agent stops when updated

## Solution Implemented

### 1. Update Command Infrastructure

Created three new files to handle updates:

#### `src/infra/update-channels.ts`
- Defines update channels (dev, beta, stable)
- Provides channel-to-npm-tag mapping
- Tag validation functions (stable, beta)

#### `src/infra/update-runner.ts`
- Core update logic with git operations
- Handles git fetch, checkout, rebase
- Runs dependency installation and build
- Provides detailed step-by-step results
- Error handling for each step

#### `src/cli/commands/update.ts`
- CLI command for updates
- Status checking command
- Automatic daemon restart integration
- User-friendly output with colors and formatting

### 2. Enhanced Daemon Service

Updated existing daemon service:

#### `src/daemon/services/index.ts`
- Added `restartGateway()` helper function
- Simplifies daemon restart after update
- Handles both start and restart scenarios

### 3. CLI Integration

Updated CLI entry point:

#### `src/cli/program.ts`
- Registered update command
- Added help text examples
- Integrated with existing command structure

## How It Works

### Update Flow

```
User runs: foxfang update
    ↓
1. Check git repository status
    ↓
2. Check for uncommitted changes (skip if dirty)
    ↓
3. Fetch updates: git fetch --all --prune --tags
    ↓
4. Checkout appropriate branch/tag:
   - dev: git checkout main && git rebase origin/main
   - stable/beta: git checkout --detach <latest-tag>
    ↓
5. Install dependencies: pnpm install
    ↓
6. Build: pnpm build
    ↓
7. Restart daemon automatically
    ↓
8. Display summary with results
```

### Daemon Management

```
Install: foxfang daemon install
    ↓
Creates system service:
  - macOS: ~/Library/LaunchAgents/com.foxfang.gateway.plist
  - Linux: ~/.config/systemd/user/foxfang-gateway.service
    ↓
Start: foxfang daemon start
    ↓
Service runs in background
    ↓
Stop: foxfang daemon stop
    ↓
Service stops cleanly
    ↓
Restart: foxfang daemon restart
    ↓
Service stops and starts again
```

## Key Features

### 1. Self-Update Capability

```bash
# Update to latest dev version
foxfang update

# Update to stable version
foxfang update --channel stable

# Update without restarting
foxfang update --no-restart
```

### 2. Background Daemon

```bash
# Install as system service
foxfang daemon install

# Start in background
foxfang daemon start

# Check status
foxfang daemon status

# View logs
foxfang daemon logs
```

### 3. Automatic Restart

After successful update, the daemon automatically restarts:

```bash
foxfang update
# ... performs git pull, build ...
# ✓ Daemon restarted
```

### 4. Status Checking

```bash
foxfang update status
# Shows:
# - Git branch and commit
# - Remote tracking
# - Behind/ahead status
# - Daemon running status
```

## Comparison with OpenClaw

### Similarities

| Feature | OpenClaw | FoxFang |
|---------|----------|---------|
| Git-based updates | ✅ | ✅ |
| Multiple channels | ✅ | ✅ |
| Daemon restart | ✅ | ✅ |
| Status checking | ✅ | ✅ |
| System services | ✅ | ✅ |

### Differences

| Feature | OpenClaw | FoxFang |
|---------|----------|---------|
| Preflight builds | ✅ Complex | ❌ Not implemented |
| Rollback logic | ✅ Automatic | ❌ Manual |
| Package managers | npm, pnpm, bun | pnpm only |
| Update steps | 10+ (dev) | 6 (dev) |
| Doctor integration | ✅ | ❌ |
| Complexity | High | Medium |

### Why FoxFang is Simpler

1. **Single package manager**: Uses pnpm exclusively
2. **No preflight validation**: Assumes main branch is buildable
3. **No rollback**: Manual intervention on failure
4. **Focused on dev channel**: Primary use case is updating from main

This trade-off provides:
- Easier to understand and maintain
- Faster updates (fewer steps)
- Sufficient for current needs
- Room for future enhancements

## Testing

### Build Test

```bash
pnpm build
# ✅ Build succeeded
```

### Update Status Test

```bash
pnpm foxfang update status
# ✅ Shows git status and daemon status
```

### Command Registration Test

```bash
pnpm foxfang --help | grep update
# ✅ Update command appears in help
```

## Usage Examples

### Development Workflow

```bash
# 1. Make changes to code
vim src/agents/runtime.ts

# 2. Build
pnpm build

# 3. Test in foreground
foxfang daemon run

# 4. When ready, commit and update
git commit -am "Add new feature"
foxfang update
```

### Production Workflow

```bash
# 1. Install as service
foxfang daemon install

# 2. Start service
foxfang daemon start

# 3. Check status
foxfang daemon status

# 4. Update when needed
foxfang update

# 5. Daemon automatically restarts
```

### Troubleshooting

```bash
# Check if daemon is running
foxfang daemon status

# View logs
foxfang daemon logs

# Check update status
foxfang update status

# Restart daemon manually
foxfang daemon restart
```

## Files Created/Modified

### Created Files

1. `src/infra/update-channels.ts` - Update channel definitions
2. `src/infra/update-runner.ts` - Core update logic
3. `src/cli/commands/update.ts` - Update CLI command
4. `docs/update.md` - Update command documentation
5. `docs/daemon-and-update.md` - Comprehensive daemon and update guide

### Modified Files

1. `src/cli/program.ts` - Registered update command
2. `src/daemon/services/index.ts` - Added restartGateway helper

## Future Enhancements

Potential improvements:

1. **Preflight validation**: Test build in temporary worktree
2. **Rollback support**: Automatically revert on failure
3. **Health checks**: Verify daemon health after restart
4. **Update notifications**: Notify when updates available
5. **Scheduled updates**: Cron-based automatic updates
6. **Multiple environments**: Dev/staging/production configs

## Conclusion

The implementation successfully addresses all user requirements:

✅ **Self-update capability**: Users can update FoxFang from git
✅ **Background daemon**: Runs as system service (launchd/systemd)
✅ **Easy management**: Simple start/stop/restart commands
✅ **Automatic restart**: Daemon restarts after successful update

The solution is inspired by OpenClaw but simplified for FoxFang's current needs, providing a solid foundation that can be enhanced over time.
