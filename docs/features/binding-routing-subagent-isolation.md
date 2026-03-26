# Binding Routing and Sub-Agent Isolation

## Goal

Move channel routing from hardcoded defaults to config-driven bindings, and isolate sub-agent state by binding/session scope.

## Core Components

- Auto-reply binding matcher and scoped session IDs:
  - `src/auto-reply/index.ts`
  - `src/auto-reply/types.ts`
- Channel metadata/account enrichment for binding match:
  - `src/channels/manager.ts`
  - `src/channels/adapters/signal.ts`
- Gateway config normalization and injection into ChannelManager:
  - `src/daemon/gateway-server.ts`
  - `src/config/index.ts`
  - `src/config/schema.ts`

## Binding Model

`autoReply.bindings` supports matching by:
- `channel`
- `chatType`
- `chatId`
- `threadId`
- `fromId`
- `accountId`
- `metadata` key/value filters

Route selection order:
1. highest `priority`
2. highest matcher specificity

Fallback behavior:
- uses `autoReply.defaultAgent` when no binding matches
- uses `autoReply.defaultSessionScope` when a binding does not set `sessionScope`

## Session Scope

Supported scopes:
- `from`
- `chat`
- `thread`
- `chat-thread`

Root auto-reply session is now binding-scoped (not agent-scoped), so the same binding/thread conversation can switch agents without losing continuity.

## Sub-Agent Isolation

Orchestrator now creates per-agent sub-sessions:
- `<rootSessionId>__agent__<agentId>`

For routed flow:
- specialist runs in specialist sub-session
- reviewer runs in reviewer sub-session
- each sub-session can keep its own rolling summary/history

Workspace isolation is also scoped by binding/session seed + agent, so specialist/reviewer do not share the same working folder state by default.

## Benefits

- deterministic channel/account/thread routing
- less cross-agent context contamination
- cleaner state separation for multi-agent runs
