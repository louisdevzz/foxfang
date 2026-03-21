# FoxFang Documentation

Welcome to the FoxFang documentation!

## Quick Links

- [Commands Reference](./commands.md) - Complete CLI command reference
- [Deploy on Railway](./RAILWAY.md) - Railway template setup for FoxFang
- [Feature Docs](./features/README.md) - Multi-agent architecture, compaction, cache, telemetry
- [Changelog](../CHANGELOG.md) - Release-level change history

## Getting Started

1. **Installation**: Clone the repo and run `pnpm install`
2. **Build the project**: `pnpm run build`
2. **Setup**: Run `pnpm foxfang wizard setup`
3. **Chat**: Start with `pnpm foxfang chat`

## What is FoxFang?

FoxFang is a personal AI marketing agent CLI that helps you:

- 🤖 Chat with AI agents for marketing tasks
- 📝 Create content for social media
- 📊 Plan marketing campaigns
- 🔧 Execute shell commands and scheduled tasks
- 💬 Integrate with messaging channels (Telegram, Discord, Signal, Slack)
- 🔗 Connect to GitHub for issue/PR management

## Architecture

```
┌─────────────────┐
│   CLI / Chat    │
└────────┬────────┘
         │
┌────────▼────────┐
│  Orchestrator   │
│    Agent        │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐  ┌──▼────┐
│Content│  │Growth │
│Special│  │Analyst│
└───┬───┘  └──┬────┘
    │         │
    └────┬────┘
         │
┌────────▼────────┐
│  Tools (31)     │
│ • GitHub        │
│ • Bash          │
│ • Cron          │
│ • Web Search    │
└─────────────────┘
```

## Project Structure

```
foxfang/
├── app/              # Web UI (Future)
├── backend/          # Server-side code
├── docs/             # Documentation (you are here)
├── src/              # Source code
│   ├── agents/       # Agent system
│   ├── channels/     # Messaging channels
│   ├── cli/          # CLI commands
│   ├── cron/         # Scheduled tasks
│   ├── integrations/ # External services (GitHub)
│   ├── providers/    # AI providers
│   └── tools/        # Agent tools
└── README.md         # Main README
```

## Contributing

See the main [README.md](../README.md) for contribution guidelines.
