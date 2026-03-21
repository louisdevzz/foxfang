# FoxFang CLI Commands Reference

Complete reference for the current FoxFang CLI surface.

---

## Quick Start

```bash
# First-time setup (recommended)
pnpm foxfang onboard

# Start chatting with the AI agent
pnpm foxfang chat

# Run a single task
pnpm foxfang run "Create a marketing campaign for my coffee shop"

# Check system status
pnpm foxfang status

# Run gateway in foreground (for testing)
pnpm foxfang gateway run
```

---

## Agent Notes (Command Routing)

Reference this section when tools/agents need deterministic CLI invocations.

- Prefer canonical command forms (single command per line, no extra trailing args).
- Use `pnpm foxfang wizard setup [target]` for setup flows:
  - `target=all` (default) for full onboarding
  - `target=providers` for provider-only setup
  - `target=channels` for channel-only setup
- `pnpm foxfang channels setup` remains valid for direct channel configuration.

---

## Global Options

- `-v, --version` - Print version
- `-d, --debug` - Enable debug logging
- `--config <path>` - Use a custom config file

---

## Command Tree

```text
foxfang [--debug] [--config <path>] <command>
  onboard (alias: wizard)
  wizard
    setup [all|providers|channels]
    providers
    channels
  chat
  run
  dashboard
  status
  config
    get
    set
    list
    path
    edit
    reset
  gateway (alias: daemon)
    install
    uninstall
    start
    stop
    restart
    status
    logs
    run
  channels
    list
    setup
    enable
    disable
    telegram send|test
    discord send
    slack send
    signal send|edit|delete|stream
  sessions
    list
    show
    delete
    clear
    export
  memory
    search
    add
    get
    delete
    list
    stats
  github
    status
    login
    logout
    issue create|list
    pr create|list
  outreach
    contacts add|list|tags
    lists create|list
    campaigns create|list|launch|pause|resume|cancel|stats
    sequences create|list|enroll|exit
    bulk-import
    test-send
```

---

## Onboarding & Configuration

### `onboard`
Run the full interactive setup wizard (alias for `wizard`, defaults to `wizard setup`).

```bash
pnpm foxfang onboard
```

### `wizard`
Interactive wizards for setup and maintenance.

```bash
pnpm foxfang wizard setup
pnpm foxfang wizard setup all
pnpm foxfang wizard setup providers
pnpm foxfang wizard setup channels
pnpm foxfang wizard providers
pnpm foxfang wizard channels
```

### `config`
Manage config values and files.

```bash
pnpm foxfang config list
pnpm foxfang config get defaultProvider
pnpm foxfang config set defaultProvider kimi-coding
pnpm foxfang config path
pnpm foxfang config edit
pnpm foxfang config reset
```

---

## Core Usage

### `chat`
Start an interactive chat session.

```bash
pnpm foxfang chat
pnpm foxfang chat -a orchestrator
pnpm foxfang chat -p my-project
pnpm foxfang chat --system "You are my brand voice editor"
```

Options:
- `-a, --agent <agent>` - Agent ID to use (default: `orchestrator`)
- `-p, --project <project>` - Project ID for context
- `-s, --session <session>` - Session ID (creates new if not provided)
- `-m, --model <model>` - Model to use
- `--provider <provider>` - Provider to use
- `--system <prompt>` - System prompt override

### `run`
Run a single task (non-interactive).

```bash
pnpm foxfang run "Draft 3 LinkedIn posts about AI"
pnpm foxfang run --no-stream "Quick task without streaming"
```

Options:
- `-a, --agent <agent>` - Agent ID to use
- `-p, --project <project>` - Project ID for context
- `-s, --session <session>` - Session ID
- `--stream` - Stream output (default: true)
- `--no-stream` - Disable streaming
- `-m, --model <model>` - Model to use
- `--provider <provider>` - Provider to use

### `status`
Show system status (gateway, providers, channels).

```bash
pnpm foxfang status
```

### `dashboard`
Show token/tool usage hotspots from request traces (`request-trace-*.jsonl`).

```bash
pnpm foxfang dashboard
pnpm foxfang dashboard --days 3 --top 5
```

Options:
- `--days <days>` - Number of recent days to aggregate (default: `7`)
- `--top <n>` - Top rows per table (default: `10`)

---

## Gateway / Daemon

### `gateway` (alias: `daemon`)
Manage the local gateway service.

```bash
pnpm foxfang gateway install --port 8787
pnpm foxfang gateway start
pnpm foxfang gateway stop
pnpm foxfang gateway restart
pnpm foxfang gateway status
pnpm foxfang gateway logs -n 200
pnpm foxfang gateway run --channels signal,telegram
pnpm foxfang gateway uninstall
```

---

## Channels

### `channels`
Manage and operate messaging channels.

```bash
pnpm foxfang channels list
pnpm foxfang channels setup
pnpm foxfang channels enable telegram
pnpm foxfang channels disable slack
```

`channels setup` now asks **Group Reply Mode per channel**:
- `always` = reply to all group/channel messages on that channel
- `mention` = reply only when bot is mentioned on that channel

Policy is saved per channel in `foxfang.json` under:
- `channels.telegram.groupActivation`
- `channels.discord.groupActivation`
- `channels.slack.groupActivation`
- `channels.signal.groupActivation`

### Channel send/test

```bash
pnpm foxfang channels telegram send -c @username -m "Hello"
pnpm foxfang channels telegram test
pnpm foxfang channels discord send -c CHANNEL_ID -m "Hello"
pnpm foxfang channels slack send -c CHANNEL_ID -m "Hello"
pnpm foxfang channels signal send -n +1234567890 -m "Hello"
```

### Signal message controls

```bash
pnpm foxfang channels signal edit -n +1234567890 -t <timestamp> -m "New text"
pnpm foxfang channels signal delete -n +1234567890 -t <timestamp>
pnpm foxfang channels signal stream -n +1234567890 -m "Initial draft"
```

---

## Sessions

### `sessions`
Manage saved sessions.

```bash
pnpm foxfang sessions list
pnpm foxfang sessions show session-id
pnpm foxfang sessions show session-id --full
pnpm foxfang sessions delete session-id
pnpm foxfang sessions clear
pnpm foxfang sessions export session-id -o session.md
```

---

## Memory

### `memory`
Manage long-term memory entries.

```bash
pnpm foxfang memory search "pricing"
pnpm foxfang memory add --content "Our ICP prefers monthly plans" --type note
pnpm foxfang memory get MEMORY_ID
pnpm foxfang memory delete MEMORY_ID
pnpm foxfang memory list --type note
pnpm foxfang memory stats
```

---

## GitHub

### `github`
Manage GitHub integration and basic issue/PR actions.

```bash
pnpm foxfang github status
pnpm foxfang github login
pnpm foxfang github logout

pnpm foxfang github issue create --repo owner/repo --title "[Bug]: Something is broken"
pnpm foxfang github issue list --repo owner/repo --limit 10

pnpm foxfang github pr create --repo owner/repo --title "feat: Add new feature" --head feature-branch
pnpm foxfang github pr list --repo owner/repo --state open
```

---

## Outreach (Marketing Automation)

### `outreach`
Manage contacts, lists, campaigns, and sequences.

```bash
pnpm foxfang outreach contacts add --channel signal --identifier +1234567890 --name "Jane"
pnpm foxfang outreach contacts list --limit 50
pnpm foxfang outreach lists create --name "VIP Leads" --tags vip,hot --dynamic

pnpm foxfang outreach campaigns create \
  --name "Product Launch" \
  --type broadcast \
  --list LIST_ID \
  --message "Hello from FoxFang"

pnpm foxfang outreach campaigns launch CAMPAIGN_ID
pnpm foxfang outreach campaigns stats

pnpm foxfang outreach sequences create --name "Welcome Drip"
pnpm foxfang outreach sequences enroll SEQUENCE_ID CONTACT_ID
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FOXFANG_HOME` | Custom config directory (default: `~/.foxfang`) |
| `FOXFANG_DEBUG` | Enable debug logging |
| `FOXFANG_LOG_LEVEL` | Log level (debug, info, warn, error) |

---

## Help

```bash
pnpm foxfang --help
pnpm foxfang chat --help
pnpm foxfang gateway --help
pnpm foxfang channels --help
```
