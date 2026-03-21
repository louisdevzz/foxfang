# Telemetry and Dashboard CLI

## Request Trace

- File: `src/observability/request-trace.ts`
- Each request writes a JSONL record including:
  - agents invoked
  - input/output tokens
  - per-agent usage
  - tool raw/compact sizes
  - delegations
  - review passes
  - total latency

## Dashboard CLI

- File: `src/cli/commands/dashboard.ts`
- Command:
  - `foxfang dashboard`
  - `foxfang dashboard --days 3 --top 10`

## Metrics Displayed

- Total input/output tokens.
- Avg latency, delegations, review passes.
- Top agents by token usage.
- Top tools by raw size.
- Top tools by estimated token burn (`compactSize / 4`).
- Top compaction savings.

## Purpose

Identify which agents and tools are consuming the most tokens, so optimization decisions can be data-driven.
