# Tool Compaction, Raw Artifact Cache, TTL

## Problem

Long tool outputs were previously injected directly into the model loop context, causing high token usage.

## Solution

- Runtime compaction:
  - `src/agents/runtime.ts`
- Cache module:
  - `src/tools/tool-result-cache.ts`
- Expand tools:
  - `src/tools/builtin/cached_results.ts`

## New Flow

1. A tool returns raw data.
2. Runtime builds a `CompactToolResult` with:
   - summary
   - key points
   - relevance
   - optional `rawRef`
3. If raw content exceeds the threshold, cache it as a file artifact.
4. The default loop only sees compact results.
5. When detail is needed:
   - `expand_cached_result(rawRef)`
   - `get_cached_snippet(rawRef, start, length)`

## TTL and Configuration

- TTL is read from `foxfang.json`:
  - `agentRuntime.toolCacheTtlMs`
- Configure via wizard:
  - `pnpm foxfang wizard setup`
  - Prompt: `Tool result cache TTL (hours)`
- `FOXFANG_TOOL_CACHE_TTL_MS` is no longer used.

## Fallback path

Both cache artifacts and trace logs use fallback directories to avoid runtime failures when the primary path is not writable.
