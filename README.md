# 🦊 FoxFang — Personal AI Marketing Assistant

<p align="center">
  <strong>Your sharp marketing partner, right in the terminal.</strong>
</p>

**FoxFang** is a _personal AI marketing assistant_ you run on your own devices.
It helps you create content, plan campaigns, manage outreach, and coordinate marketing across the channels you already use (Signal, Telegram, Discord, Slack). The Gateway is the control plane — the product is a marketing teammate that learns your style.

If you want a local, privacy-first marketing assistant that feels fast and always-on, this is it.

## Install (recommended)

Runtime: **Node 18+**.

```bash
# Clone the repository
git clone https://github.com/potlock/foxfang.git
cd foxfang

# Install dependencies
pnpm install

# Build the project
pnpm run build

# Run the setup wizard
pnpm foxfang onboard
```

FoxFang Onboard guides you step by step through setting up providers, workspace, channels, and skills.

## Quick start (TL;DR)

```bash
pnpm foxfang onboard

# Start interactive chat
pnpm foxfang chat

# Run a single task
pnpm foxfang run "Write a Twitter thread about AI trends"

# Start the gateway (background mode with channels)
pnpm foxfang gateway run

# Check system status
pnpm foxfang status
```

## Models (selection + auth)

FoxFang supports multiple AI providers — you bring your own API keys:

- **OpenAI** (GPT-4, GPT-4o, etc.)
- **Anthropic** (Claude Sonnet, Claude Opus)
- **Kimi** (Moonshot)
- **GitHub Copilot** (via device-code OAuth)
- **Groq**, **Gemini**, **Ollama**, **OpenRouter**, **BytePlus**, **Alibaba Cloud**
- **Custom OpenAI-compatible** endpoints

Configure providers via the setup wizard or directly in `~/.foxfang/foxfang.json`.

## Highlights

- **Local-first** — All data stays on your machine. No cloud dependency.
- **CLI-native** — Primary interface is your terminal. No browser tabs needed.
- **Multi-agent routing** — Orchestrator delegates to Content Specialist, Strategy Lead, and Growth Analyst.
- **Multi-channel inbox** — Signal, Telegram, Discord, Slack with auto-reply bindings.
- **Memory system** — SQLite FTS + JSON store that learns your style and preferences.
- **30+ built-in tools** — Web search, tweet fetching, brand/project management, task tracking, bash execution, cron scheduling, GitHub integration.
- **Outreach CRM** — Contacts, campaigns, and multi-step sequences.
- **Observability** — Request tracing with per-agent token usage, tool call stats, and latency metrics.
- **Optional Web UI** — Next.js dashboard for visual management.
- **Deployable** — Railway template included for cloud deployment.

## How it works

```
Signal / Telegram / Discord / Slack / CLI
               │
               ▼
┌───────────────────────────────┐
│        FoxFang Gateway        │
│       (control plane)         │
│      Express HTTP server      │
└──────────────┬────────────────┘
               │
               ├─ Agent Orchestrator
               ├─ CLI (foxfang …)
               ├─ Channel Adapters
               └─ Web UI (optional)
```

## Key subsystems

- **Agent Orchestrator** — Routes tasks to specialist agents with token budgets and delegation limits.
- **Memory Store** — Dual-layer storage: JSON for fast access, SQLite with BM25 full-text search for deep recall.
- **Tool Registry** — 30+ tools spanning research, content, brand management, task tracking, shell execution, and scheduling.
- **Channel Manager** — Auto-reply routing with configurable bindings per channel/chat/user.
- **Session Manager** — Rolling session summaries with goal tracking and decision logging.
- **Cron Scheduler** — SQLite-backed recurring jobs that fire through the orchestrator.
- **Workspace Files** — SOUL.md (personality), BRAND.md (identity), USER.md (preferences) shape every response.

## Agent system

FoxFang uses a coordinator + specialist pattern:

| Agent | Role | Strength |
|-------|------|----------|
| **Orchestrator** | Routes tasks, manages brands/projects | Coordination |
| **Content Specialist** | Writes marketing content, enforces tone | Creative writing |
| **Strategy Lead** | Plans campaigns, researches competitors | Strategic thinking |
| **Growth Analyst** | Reviews content, tracks performance | Analysis |

Agents can delegate work to each other via `MESSAGE_AGENT:` directives, up to a configurable delegation depth.

## Channel integration

Connect FoxFang to messaging platforms for always-on marketing assistance:

| Channel | Service Required | Status |
|---------|------------------|--------|
| Signal | signal-cli daemon | Available |
| Telegram | Bot API token | Available |
| Discord | Bot token | Available |
| Slack | Slack app | Available |

```bash
# Setup channels (interactive wizard)
pnpm foxfang channels setup

# Run gateway with channels
pnpm foxfang gateway run --channels signal,telegram
```

Auto-reply bindings let you route specific chats/users to specific agents with isolated sessions.

## Commands

| Command | Description |
|---------|-------------|
| `foxfang chat` | Start interactive chat session |
| `foxfang run <message>` | Execute a single marketing task |
| `foxfang gateway run` | Start gateway in foreground |
| `foxfang gateway install` | Install gateway as system service |
| `foxfang gateway start/stop` | Manage gateway service |
| `foxfang gateway status` | Check gateway status |
| `foxfang gateway logs` | View gateway logs |
| `foxfang channels setup` | Configure messaging channels |
| `foxfang channels list` | Show configured channels |
| `foxfang memory list` | Show stored memories |
| `foxfang memory search <q>` | Search memories |
| `foxfang outreach` | Manage contacts and campaigns |
| `foxfang dashboard` | View usage analytics |
| `foxfang sessions list` | List chat sessions |
| `foxfang status` | Show system status |
| `foxfang config edit` | Edit configuration |
| `foxfang onboard` | Run setup wizard |
| `foxfang github connect` | Connect GitHub account |

## Configuration

All configuration is stored locally in `~/.foxfang/`:

```
~/.foxfang/
├── foxfang.json         # Main config (providers, channels, agents)
├── credentials/         # API keys (keychain store)
├── memory/              # Memory storage
│   └── memories.json
├── sessions/            # Chat session history
├── workspace/           # Workspace files (SOUL.md, BRAND.md, etc.)
├── logs/                # Request trace logs (JSONL)
└── foxfang.db           # SQLite (memory FTS, cron jobs)
```

```bash
# Run the wizard to setup everything
pnpm foxfang onboard
```

No `.env` files needed — the wizard handles all configuration.

## Development (from source)

```bash
git clone https://github.com/potlock/foxfang.git
cd foxfang

pnpm install
pnpm run build

# Dev loop (TypeScript directly)
pnpm foxfang chat

# Build production output
pnpm run build
```

## Deploy on Railway

FoxFang includes a Railway template (`railway.toml` + `Dockerfile`).

1. Create a Railway project from this repository.
2. Attach a Volume mounted at `/data`.
3. Set `SETUP_USERNAME` and `SETUP_PASSWORD` environment variables.
4. Open `https://<your-domain>/setup` and configure providers/channels.
5. Verify health: `https://<your-domain>/healthz`.

Optional: set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `KIMI_API_KEY` to bootstrap without manual setup.

See full guide: [`docs/RAILWAY.md`](./docs/RAILWAY.md)

## Architecture

```
foxfang.cjs           # Entry point
src/
  cli/                # CLI commands (chat, run, gateway, channels, etc.)
  agents/             # Orchestrator, registry, runtime, budget
  providers/          # LLM adapters (OpenAI, Anthropic, Kimi, Copilot, etc.)
  tools/              # Tool registry + 30+ built-in tools
  channels/           # Signal, Telegram, Discord, Slack adapters
  sessions/           # Chat session management
  memory/             # JSON + SQLite memory stores
  config/             # Configuration management
  credentials/        # Keychain / credential store
  workspace/          # Workspace file manager
  outreach/           # CRM: contacts, campaigns, sequences
  cron/               # Recurring job scheduler
  gateway/            # Express HTTP API
  daemon/             # Background service management
  observability/      # Request tracing (JSONL logs)
  auto-reply/         # Auto-reply routing
  wizard/             # Setup wizard helpers
  skill-system/       # Skills loading
  database/           # SQLite client
ui/                   # Optional Next.js web dashboard
```

## License

MIT
