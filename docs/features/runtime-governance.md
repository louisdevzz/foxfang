# Runtime Governance

FoxFang now includes a stronger runtime governance layer aligned with OpenClaw-style operation patterns.

## What was added

- Prompt-level governance section (`Runtime Governance`) in agent system prompt:
  - Tool-loop budget reminder
  - Delegation budget reminder
  - Controlled `MESSAGE_AGENT` handoff format
  - Long-running shell execution guidance (`yield_ms`, background + polling)
  - Risky shell confirmation requirement

- Channel-session control tags:
  - `[[reply_to_current]]`
  - `[[reply_to:<message-id>]]`
  - Tags are parsed and stripped before delivery.

- Heartbeat/silent controls for channel sessions:
  - `HEARTBEAT_OK` suppresses outbound delivery
  - `[[silent_reply]]` suppresses outbound delivery

- Delegation governance enforcement:
  - Delegation depth is tracked through `RunRequest.delegationDepth`
  - Delegation is limited by per-agent budget (`maxDelegations`)
  - If delegation budget is exceeded, `MESSAGE_AGENT` lines are stripped from final user output

- Explicit sub-session tools (agent-callable):
  - `sessions_spawn`: create/run isolated sub-agent sessions
  - `sessions_send`: send follow-up messages into an existing session
  - `subagents`: list/inspect/close sub-agent sessions
  - Runtime wiring is done at startup so these tools can call orchestrator/session manager safely.

- Bash governance upgrades:
  - Risky commands now require explicit `confirm: true`
  - Added `yield_ms` to support start + wait + partial status/output snapshots for long-running commands

## Files

- `src/agents/runtime.ts`
- `src/agents/orchestrator.ts`
- `src/agents/types.ts`
- `src/agents/governance.ts`
- `src/auto-reply/index.ts`
- `src/tools/builtin/bash.ts`
- `src/tools/builtin/subagents.ts`
- `src/tools/index.ts`
