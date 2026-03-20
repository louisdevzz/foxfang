# AGENTS.md - FoxFang 🦊 Agent Specification

This file defines the agent system for FoxFang — your personal AI marketing assistant.

## 1) Agent Architecture

FoxFang uses a coordinator + specialist pattern to help with marketing tasks:

- `OrchestratorAgent` (system)
  - Receives requests from chat/CLI
  - Loads your context (preferences, past work, current project)
  - Delegates to specialists and returns final output

- `Strategy Lead`
  - Campaign planning and brief writing
  - Research synthesis and positioning

- `Content Specialist`
  - Draft generation and variant production
  - Enforces your tone and style preferences

- `Growth Analyst`
  - Quality review and optimization suggestions
  - Channel-specific recommendations

## 2) Memory System

FoxFang maintains three types of memory:

- `UserPreferences`: Your style, tone, favorite formats
- `WorkingMemory`: Context for the current session/task
- `LongTermMemory`: Past work and feedback patterns

All data is stored locally on your machine.

## 3) Learning Loop

1. You review and provide feedback on outputs
2. FoxFang extracts improvement signals
3. Memory updates with confidence weighting
4. Future outputs incorporate learned patterns

## 4) Tone Enforcement

Your `ToneProfile` includes:

- Do/Don't guidance
- Preferred vocabulary
- Style rhythm constraints
- CTA patterns
- Forbidden words

## 5) Events

- `session.started`
- `message.received`
- `content.generated`
- `feedback.submitted`
- `memory.updated`

## 6) Agent Communication

Agents can delegate work:

```
MESSAGE_AGENT: Content Specialist | Draft a LinkedIn post about: ...
```

The orchestrator routes to the appropriate specialist.

## 7) CLI Command Reference

Before suggesting or running CLI commands, agents should consult `docs/commands.md`.

- Canonical setup form: `pnpm foxfang wizard setup [all|providers|channels]`
- Channel-only setup can also use: `pnpm foxfang channels setup`
