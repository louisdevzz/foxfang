# CLAUDE.md - Implementation Guardrails

This document defines execution rules for coding agents working on FoxFang 🦊.

## Mission

Build FoxFang — a personal AI marketing assistant that runs locally and helps users create content, plan campaigns, and manage their marketing:

- CLI-first interface
- Local storage for privacy
- Multiple AI provider support (user brings their own keys)
- Optional channel integrations (Telegram, Discord, Slack, Signal)
- Optional web UI for visualization

## Product Invariants

1. **Privacy first**: All data stored locally by default
2. **User owns their keys**: Bring your own OpenAI/Anthropic/Kimi API keys
3. **Terminal-native**: Primary interface is CLI, not web dashboard
4. **Extensible**: Plugin system for custom tools
5. **Contextual memory**: Learns from past interactions

## Engineering Invariants

1. Keep architecture minimal — this is a personal tool, not a platform
2. All transport contracts typed and runtime-validated
3. Agent actions traceable through structured logs
4. Memory writes include provenance (`source`, `timestamp`)
5. No external database required — local JSON/SQLite only

## Code Standards

- TypeScript strict mode
- CommonJS for compatibility (no .js extensions in imports)
- CLI uses Commander.js
- Event naming: `domain.action`
- Never hardcode marketing voice; read from user preferences

## Architecture

```
foxfang.cjs           # Entry point
src/
  cli/                # CLI commands and interface
  agent/              # Orchestrator and specialists
  sessions/           # Chat session management
  memory/             # Local memory storage
  config/             # User configuration
  secrets/            # API key management
  providers/          # LLM adapters
  tools/              # Tool registry
  channels/           # Messaging integrations
  gateway/            # Optional HTTP API
gateway/
  index.ts            # Express server (optional)
ui/                   # Optional Next.js frontend
```

## Key Modules

- `cli/`: Commands (chat, run, daemon, channels, etc.)
- `agent/orchestrator.ts`: Routes tasks to specialists
- `memory/store.ts`: Local JSON-based memory
- `config/`: User settings and preferences
- `channels/`: Telegram, Discord, Slack, Signal bots

## Running FoxFang

```bash
pnpm foxfang              # Show help
pnpm foxfang chat         # Interactive chat
pnpm foxfang run "..."    # Single task
pnpm foxfang daemon start # Background mode
```

## Milestones

1. CLI foundation with chat and run commands
2. Agent orchestrator with specialist routing
3. Memory system for context retention
4. Channel integrations
5. Optional web UI
