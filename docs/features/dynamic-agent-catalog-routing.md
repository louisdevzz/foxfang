# Dynamic Agent Catalog and Runtime Registration

## Goal

Remove hardcoded assumptions around a fixed 4-agent set and support a configurable multi-agent catalog.

## What Changed

- Agent role and route typing are no longer locked to fixed specialist unions.
  - `src/agents/types.ts`
- Agent routing config now accepts dynamic string agent IDs.
  - `src/config/index.ts`
  - `src/config/schema.ts`

## Config-Driven Agent Catalog

FoxFang now supports dynamic agents in `foxfang.json`:

- `agents[]` entries can define:
  - `id`, `name`, `role`, `description`, `systemPrompt`
  - `tools`, `model`, `provider`
  - `executionProfile`

Registry behavior:
- hydrate agents from `foxfang.json` at runtime
- keep built-in defaults, then overlay config-defined agents

Source:
- `src/agents/registry.ts`

## Runtime Safety for Unknown Agent IDs

`runAgent` and `runAgentStream` now call `ensureAgentRegistered(agentId)` first.

This prevents crashes when:
- bindings reference a custom agent ID
- routing returns an agent ID not pre-registered in static defaults

Fallback behavior:
- auto-create a minimal agent entry when ID is unknown
- default to empty tool list and safe generic system prompt

Sources:
- `src/agents/runtime.ts`
- `src/agents/registry.ts`

## Router Integration

Router/model classification now uses the current registry list (after hydration), not a hardcoded 3-specialist list.

Source:
- `src/agents/routing.ts`

## Impact

- bindings and routing can target custom agents safely
- agent topology can evolve via config without code edits