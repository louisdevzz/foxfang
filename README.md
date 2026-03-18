# FoxFang 🦊

**Your personal AI marketing assistant.**

FoxFang is a local AI assistant that helps you with marketing tasks — from content creation and campaign planning to social media management. It runs entirely on your machine, keeps your data private, and learns your style over time.

Think of it as having a brilliant marketing teammate in your terminal, ready to help 24/7.

---

## What is FoxFang?

Unlike complex marketing platforms, FoxFang is a **personal AI assistant** that:

- **Runs locally** — Your data stays on your machine
- **Works in your terminal** — No browser tabs, no context switching
- **Learns your style** — The more you use it, the better it gets
- **Integrates with your tools** — Slack, Discord, Telegram, Signal
- **Uses your API keys** — You control which AI models (OpenAI, Anthropic, Kimi)

---

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/potlock/foxfang.git
cd foxfang

# Install dependencies
pnpm install

# Build the project
npm run build

# Run the setup wizard
pnpm foxfang wizard setup
```

The wizard will guide you through:
1. Setting up your AI provider API keys
2. Configuring channels (optional)
3. Creating your first project

### Usage

```bash
# Start interactive chat
pnpm foxfang chat

# Run a single task
pnpm foxfang run "Create a LinkedIn post about AI trends"

# Start the daemon for background processing
pnpm foxfang daemon start

# Check system status
pnpm foxfang status
```

---

## Features

### 🎯 Content Creation

Generate content that matches your voice:

```bash
$ pnpm foxfang run "Write a Twitter thread about productivity"

🦊 FoxFang:
Here's a 5-tweet thread on productivity...
```

### 💬 Interactive Chat

Have a conversation to refine ideas:

```bash
$ pnpm foxfang chat

🦊 FoxFang: Ready! What are we working on today?

> I need ideas for a blog post about remote work
🦊 FoxFang: Here are 5 angles you could take...

> Make it more focused on async communication
🦊 FoxFang: Got it. Here are refined ideas...
```

### 📱 Channel Integration

Connect to your communication tools:

```bash
# Enable Telegram bot
pnpm foxfang channels enable telegram

# Enable Discord webhook
pnpm foxfang channels enable discord

# Send a message
pnpm foxfang channels telegram send "Hello from FoxFang!"
```

### 🧠 Memory

FoxFang remembers your preferences and past work:

```bash
# Store important information
pnpm foxfang memory store "Brand voice: casual, helpful, no jargon"

# Recall when needed
pnpm foxfang memory search "brand voice"
```

---

## Architecture

FoxFang follows a modular agent architecture:

```
┌─────────────────────────────────────┐
│           FoxFang CLI               │
│  (chat | run | daemon | channels)   │
└─────────────┬───────────────────────┘
              │
┌─────────────▼───────────────────────┐
│        Agent Orchestrator           │
│   (routes tasks to specialists)     │
└─────────────┬───────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐
│Content│ │Strategy│ │Growth │
│Agent  │ │ Agent  │ │Agent  │
└───┬───┘ └───┬───┘ └───┬───┘
    │         │         │
    └─────────┼─────────┘
              ▼
┌─────────────────────────────────────┐
│         Tool Registry               │
│  (search | memory | channels | ...) │
└─────────────────────────────────────┘
```

---

## Configuration

All configuration is stored locally in `~/.foxfang/`:

```
~/.foxfang/
├── foxfang.json         # Main configuration (API keys, settings)
├── memory/              # Local memory storage
│   └── memories.json
├── sessions/            # Chat session history
└── workspace/           # Project files
    └── projects/
```

### Setup

FoxFang uses a setup wizard to configure everything. No `.env` files needed!

```bash
# Run the wizard to setup API keys and preferences
pnpm foxfang wizard setup
```

The wizard will:
1. Ask for your AI provider API key (OpenAI, Anthropic, or Kimi)
2. Configure optional channels (Telegram, Discord, etc.)
3. Set your preferences

All data is stored in `~/.foxfang/foxfang.json` — no environment variables needed.

---

## Commands

| Command | Description |
|---------|-------------|
| `pnpm foxfang chat` | Start interactive chat session |
| `pnpm foxfang run <message>` | Execute a single task |
| `pnpm foxfang daemon start` | Start background daemon |
| `pnpm foxfang daemon stop` | Stop background daemon |
| `pnpm foxfang channels list` | Show configured channels |
| `pnpm foxfang channels enable <name>` | Enable a channel |
| `pnpm foxfang memory list` | Show stored memories |
| `pnpm foxfang memory search <query>` | Search memories |
| `pnpm foxfang wizard setup` | Run setup wizard |
| `pnpm foxfang status` | Show system status |
| `pnpm foxfang config edit` | Edit configuration |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18+ |
| Language | TypeScript |
| CLI Framework | Commander.js |
| AI Providers | OpenAI, Anthropic, Kimi |
| Storage | Local JSON files |
| Gateway | Express (optional) |

---

## Why FoxFang?

**Fox** 🦊 — Clever, adaptable, learns quickly  
**Fang** 🦷 — Sharp, precise, makes an impact

FoxFang is your personal marketing companion — not a complex platform to manage, but a helpful assistant that works the way you do.

---

## License

MIT
