# AGENTS.md — FoxFang 🦊 Agent System

This file defines the agent architecture, tools, memory, and runtime behavior for FoxFang.

## Project Structure & Module Organization

- Source code: `src/` (CLI in `src/cli`, commands in `src/cli/commands`, agents in `src/agents`, tools in `src/tools`).
- Tests: `tests/` directory.
- Docs: `docs/` (features, commands reference, Railway guide). Built output lives in `dist/`.
- Config: `~/.foxfang/foxfang.json` (all settings). Credentials in `~/.foxfang/credentials/`.
- Workspace files: `~/.foxfang/workspace/` (SOUL.md, BRAND.md, AGENTS.md, USER.md).

## Agent Architecture

FoxFang uses a coordinator + specialist pattern. The orchestrator receives all requests and delegates to specialists.

### Agents

| Agent | Role | Model Tier | Key Tools |
|-------|------|------------|-----------|
| `orchestrator` | Routes tasks, manages brands/projects, coordinates specialists | medium | brand tools, memory, GitHub, subagents |
| `content-specialist` | Writes marketing content, enforces tone and style | large / deep | web_search, fetch_tweet, memory, tasks |
| `strategy-lead` | Plans campaigns, researches competitors, synthesizes briefs | large / deep | web_search, firecrawl, memory, projects |
| `growth-analyst` | Reviews content quality, tracks performance, optimizes | small / normal | web_search, memory, tasks |

Additional agents can be defined in `foxfang.json` under the `agents` array.

### Agent Communication

Agents delegate work via `MESSAGE_AGENT:` directives in their responses:

```
MESSAGE_AGENT: Content Specialist | Draft a LinkedIn post about: ...
```

The orchestrator intercepts these directives and routes to the target specialist, up to `maxDelegations` depth.

### Token Budget & Governance

Each agent run is governed by a `TokenBudget`:

- Input/output token caps per request
- `maxToolIterations` — max tool call loops before forcing a response
- `maxDelegations` — max inter-agent delegation depth
- Reasoning mode (`normal`, `deep`) per agent profile

## Tools (30+ built-in)

Tools are registered in `src/tools/` and available to agents based on their tool allowlist.

### Research
- `web_search` — Search the web via configured search provider
- `brave_search` — Brave Search API
- `firecrawl_search` / `firecrawl_scrape` — Firecrawl web crawling
- `fetch_url` — Fetch and extract content from URLs
- `fetch_tweet` / `fetch_user_tweets` — Fetch Twitter/X content

### Memory
- `memory_store` — Save a memory with category, importance, and provenance
- `memory_recall` — Recall memories by keyword relevance
- `memory_search` — Full-text search across all memories (BM25)
- `memory_get` — Retrieve a specific memory by ID

### Brand & Project
- `create_brand` / `list_brands` / `get_brand` — Manage brand profiles
- `create_project` / `list_projects` / `get_project` — Manage marketing projects

### Task Tracking
- `create_task` / `list_tasks` / `get_task` / `update_task_status` — Track marketing tasks

### Shell Execution
- `bash_exec` — Execute shell commands
- `bash_list` / `bash_log` / `bash_poll` / `bash_kill` / `bash_remove` — Manage background processes

### Scheduling
- `cron` — Create, list, update, delete recurring jobs (SQLite-backed)

### GitHub
- `github_connect` — Connect GitHub account via OAuth
- `github_create_issue` / `github_create_pr` — Create issues and PRs
- `github_list_issues` / `github_list_prs` — List issues and PRs

### Skills & Agents
- `skills_list` / `skills_add` — Manage workspace skills
- `sessions_spawn` / `sessions_send` — Spawn and message sub-agent sessions
- `subagents` — List available sub-agents

### Utility
- `expand_cached_result` / `get_cached_snippet` — Handle compacted tool results

Tool results over 1500 characters are automatically compacted to structured summaries to preserve context window.

## Memory System

### Dual-Layer Storage

1. **JSON Store** (`~/.foxfang/memory/memories.json`) — Fast keyword-based search with relevance scoring.
2. **SQLite Store** (`~/.foxfang/foxfang.db`) — Full-text search using BM25 ranking.

### Memory Categories

| Category | Purpose |
|----------|---------|
| `fact` | Verified information about brands, markets, competitors |
| `preference` | User style, tone, format preferences |
| `pattern` | Learned patterns from feedback and past work |
| `feedback` | Direct user feedback on outputs |
| `idea` | Creative ideas and suggestions for future use |

### Memory Properties

Each memory includes:
- `content` — The memory text
- `category` — One of the categories above
- `importance` — Score 1-10
- `source` — Provenance (which agent/session created it)
- `timestamp` — When it was created
- `project` / `session` — Optional association

## Session Management

Sessions are stored as JSON files at `~/.foxfang/sessions/`.

Each session maintains a rolling summary:
- `currentGoal` — What the session is working toward
- `importantDecisions` — Key choices made during the session
- `activeConstraints` — Active rules or limitations
- `openLoops` — Unresolved threads to follow up on

Last 20 messages are loaded as context for each agent run.

## Workspace Files

Workspace files at `~/.foxfang/workspace/` shape agent behavior:

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent personality and voice |
| `BRAND.md` | Brand identity and guidelines |
| `AGENTS.md` | Agent documentation |
| `USER.md` | User preferences |
| `MEMORY.md` | Persistent memory notes |
| `TOOLS.md` | Tool documentation |
| `HEARTBEAT.md` | Status and health notes |

These files are cached per-session to minimize I/O.

## Channel Routing

### Auto-Reply Bindings

Configure in `foxfang.json` under `autoReply.bindings`:

```json
{
  "channel": "signal",
  "chatId": "+1234567890",
  "agentId": "content-specialist",
  "sessionScope": "per-chat"
}
```

Bindings match by: `channel`, `chatId`, `fromId`, `chatType`. Each binding can route to a different agent with its own session scope.

### Typing Indicators

Channels support typing indicators and human-delay simulation for natural conversation flow.

## Observability

Every request generates a `RequestTrace` appended to `~/.foxfang/logs/request-trace-YYYY-MM-DD.jsonl`:

- Agents invoked and their input/output token counts
- Tool calls with raw/compact sizes
- Delegation count
- Total latency

View with `foxfang dashboard`.

## Events

| Event | When |
|-------|------|
| `session.started` | New chat session begins |
| `message.received` | Inbound message from user or channel |
| `content.generated` | Agent produces content output |
| `feedback.submitted` | User provides feedback |
| `memory.updated` | Memory store is modified |
| `tool.called` | Agent invokes a tool |
| `agent.delegated` | Orchestrator delegates to specialist |

## Build, Test, and Development

- Runtime: Node **18+**
- Install deps: `pnpm install`
- Build: `pnpm run build`
- Run CLI (dev): `pnpm foxfang <command>`
- Tests: `pnpm test`
- Entry point: `foxfang.cjs` (checks for `dist/cli/entry.js` or `src/cli/entry.ts`)

## Coding Style

- Language: TypeScript (CommonJS for compatibility).
- Strict mode enabled.
- CLI uses Commander.js.
- Event naming: `domain.action`.
- Keep files under ~800 LOC; split when beneficial.
- Never hardcode marketing voice; read from user workspace preferences.

## CLI Command Reference

Before suggesting or running CLI commands, consult `docs/commands.md`.

- Canonical setup: `pnpm foxfang onboard`
- Channel setup: `pnpm foxfang channels setup`
- Interactive chat: `pnpm foxfang chat`
- Single task: `pnpm foxfang run "<message>"`
- Background gateway: `pnpm foxfang gateway run`
- System service: `pnpm foxfang gateway install/start/stop/status/logs`

## Security

- All data stored locally by default.
- API keys stored via credentials/keychain store, not in plain config.
- Channel DM handling is configurable per binding.
- Never commit real phone numbers or API keys.
- Gateway setup page protected by HTTP Basic Auth when deployed.

## Configuration

Central config at `~/.foxfang/foxfang.json` covers:

- `providers` — LLM provider configs and API keys
- `tools` — Tool enablement and settings
- `sessions` — Session behavior
- `memory` — Memory store settings
- `channels` — Channel adapter configs
- `autoReply` — Auto-reply binding rules
- `agents` — Custom agent definitions
- `daemon` — Background service settings
- `gateway` — HTTP API settings
- `cron` — Cron scheduler settings
- `github` — GitHub integration
- `security` — Security policies
