# Changelog

## 2026-03-21

### Added
- Thin-router orchestration flow (`user -> orchestrator -> primary specialist -> optional reviewer -> quality floor`).
- Route classification + handoff packet + output spec pipeline.
- Compact context builder (`recent messages`, `session summary`, `top memories`, `project facts`).
- Rolling session summary (`currentGoal`, `importantDecisions`, `activeConstraints`, `openLoops`).
- Runtime token budget module by agent role and reasoning mode.
- Tool result compaction pipeline with structured compact payloads.
- Cached raw expansion tools:
  - `expand_cached_result`
  - `get_cached_snippet`
- Persistent tool-result artifact cache with TTL.
- Request trace telemetry (`request-trace-YYYY-MM-DD.jsonl`).
- CLI dashboard command:
  - `foxfang dashboard --days <n> --top <n>`
  - Top agents/tools by token and compaction metrics.
- Wizard setting for tool cache TTL:
  - `agentRuntime.toolCacheTtlMs` in `foxfang.json`.

### Changed
- Reduced default tool scope per specialist in agent registry.
- System prompt construction split into clearer layers (core identity, tool section, skills section, task context).
- Brand context loading now uses compact brief instead of full long text.
- Reviewer path now uses structured critique and bounded rewrite pass.
- Quality floor added before final response to avoid overly generic/too-short output.
- `docs/commands.md` updated to include `dashboard` command.

### Removed
- Tool cache TTL dependency on environment variable (`FOXFANG_TOOL_CACHE_TTL_MS`).
- TTL control moved to config + wizard flow.

### Notes / Current Limitations
- Retrieval re-ranking (#13) is still limited because memory retrieval is not yet a full pipeline.
- Model tier mapping currently uses runtime heuristics; provider/model map config can be deepened further.
- Request-level global hard cap is not fully enforced end-to-end yet (per-agent budget is implemented).
