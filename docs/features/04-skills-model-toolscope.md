# Skills, Model Tier, Tool Scope

## Skills Runtime Pattern

- Runtime injects available skills into prompts from:
  - `src/agents/runtime.ts`
  - `src/skill-system/*`
- Prompt-side skill behavior:
  - scan `<available_skills>`
  - select the most relevant skill
  - add/install skills via `skills_add` when requested

## Role-based Models

- Each agent has an `executionProfile`:
  - `modelTier`
  - `verbosity`
  - `reasoningDepth`
- Defined in:
  - `src/agents/types.ts`
  - `src/agents/registry.ts`
- Runtime applies heuristics to select smaller models for `small` tier when provider/model patterns match.

## Per-agent Tool Scope

- `src/agents/registry.ts` narrows tool lists by role, instead of giving every agent full bash/github/cron access.
- Orchestrator still keeps required setup/workflow tools (brand/project/github/skills), rather than forcing a zero-tool orchestrator.

## Status

- Tool scope tightening: done.
- Detailed tier-to-model config mapping by provider/model family: partial (runtime is still mostly heuristic).
