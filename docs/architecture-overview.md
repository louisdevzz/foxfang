# Personal AI Marketing Agent — Architecture Overview

> This document describes the full architecture, flow logic, and key components of the **Personal AI Marketing Agent** — a locally-run, privacy-first AI assistant purpose-built for marketing workflows across multiple messaging channels.

---

## 1. Origin: Forked from OpenClaw

**FoxFang** is a fork of [OpenClaw](https://github.com/openclaw/openclaw) — an open-source, self-hosted personal AI assistant gateway. The fork was taken at an early version of OpenClaw and customized specifically toward **marketing use cases**.

Since forking, OpenClaw has evolved significantly (companion macOS/iOS/Android apps, Live Canvas, Voice Wake, real-time voice, music/video generation, trajectory system, memory SDK, etc.) while FoxFang has been redirected toward a narrower, more focused goal: **a personal AI marketing agent**.

### 1.1 OpenClaw vs FoxFang — Side-by-side Comparison

```mermaid
flowchart LR
    subgraph OC["OpenClaw (upstream)"]
        direction TB
        OC1["General-purpose AI assistant"]
        OC2["Supports 20+ channels\n(WhatsApp, Telegram, iMessage,\nBlueBubbles, Matrix, Feishu,\nZalo, LINE, Tlon, Twitch, IRC...)"]
        OC3["macOS / iOS / Android\ncompanion apps"]
        OC4["Live Canvas + A2UI\n(agent-driven visual workspace)"]
        OC5["Voice Wake + real-time\ntranscription + TTS"]
        OC6["Music / Video generation\n(media-generation, video-generation)"]
        OC7["Trajectory system\n(task planning & execution)"]
        OC8["Memory SDK\n(pluggable memory backends)"]
        OC9["Crestodian security layer"]
        OC10["Proxy capture / web-fetch"]
        OC11["Realtime voice pipeline"]
        OC12["General agent — no marketing\nspecialization"]
    end

    subgraph FF["FoxFang (this fork)"]
        direction TB
        FF1["Marketing-focused AI assistant"]
        FF2["Supports 7 channels\n(Telegram, Discord, Slack,\nSignal, WhatsApp, iMessage, CLI)"]
        FF3["No companion apps\n(CLI + Web UI only)"]
        FF4["No Live Canvas"]
        FF5["Basic TTS via ElevenLabs\n/ Deepgram (no voice wake)"]
        FF6["Image generation only\n(no music/video)"]
        FF7["No trajectory system"]
        FF8["SQLite FTS + JSON memory\n(simplified)"]
        FF9["Standard auth/security\n(no Crestodian)"]
        FF10["No proxy capture"]
        FF11["No realtime voice"]
        FF12["Multi-agent: Orchestrator +\nContent + Strategy + Growth"]
    end

    OC1 --> FF1
    OC2 --> FF2
```

### 1.2 Key Differences Table

| Feature | OpenClaw (upstream) | FoxFang (this fork) |
|---|---|---|
| **Purpose** | General personal AI assistant | Marketing-focused AI assistant |
| **Channels** | 20+ (WhatsApp, iMessage, BlueBubbles, Matrix, Feishu, Zalo, LINE, IRC, Tlon, Twitch...) | 7 (Telegram, Discord, Slack, Signal, WhatsApp, iMessage, CLI) |
| **Companion Apps** | macOS app, iOS node, Android node | None (CLI-first) |
| **Live Canvas** | Yes (agent-driven visual workspace + A2UI) | No |
| **Voice** | Voice Wake, real-time transcription, push-to-talk | Basic TTS only (ElevenLabs/Deepgram) |
| **Media Generation** | Image + Music + Video generation | Image generation only |
| **Agent System** | Single general-purpose Pi agent | Multi-agent: Orchestrator + Content + Strategy + Growth |
| **Memory** | Pluggable memory SDK (LanceDB, etc.) | SQLite FTS + JSON (simplified) |
| **Trajectory** | Yes (task planning + execution tracking) | No |
| **Security Layer** | Crestodian (advanced) | Standard auth + allowlists |
| **Outreach CRM** | No | Yes (contacts, campaigns, sequences) |
| **Cron Scheduler** | Yes | Yes (kept) |
| **Web UI** | Yes (Control UI) | Yes (Next.js dashboard) |
| **Branding** | Space lobster 🦞 (Molty) | Fox 🦊 (marketing focus) |
| **Config dir** | `~/.openclaw/` | `~/.foxfang/` |
| **Binary name** | `openclaw` | `foxfang` |

---

## 2. System Architecture Overview

```mermaid
flowchart TB
    subgraph Inputs["Input Channels"]
        direction LR
        CLI["CLI\nchat / run"]
        TG["Telegram"]
        DC["Discord"]
        SL["Slack"]
        SG["Signal"]
        WA["WhatsApp"]
        WEB["Web Control UI"]
    end

    subgraph Gateway["Gateway — Control Plane"]
        direction TB
        HTTP["Express HTTP Server\nport 18789"]
        Router["Message Router\nresolve-route.ts"]
        AutoReply["Auto-Reply Engine"]
        SessionMgr["Session Manager"]
        CronSched["Cron Scheduler"]
    end

    subgraph AgentSystem["Multi-Agent System"]
        direction LR
        Orchestrator["Orchestrator Agent\ndefault — routes tasks"]
        Content["Content Specialist\nwriting & tone"]
        Strategy["Strategy Lead\ncampaigns & research"]
        Growth["Growth Analyst\nperformance & review"]
    end

    subgraph ContextLayer["Context Layer"]
        direction TB
        Memory["Memory Store\nJSON + SQLite FTS"]
        Workspace["Workspace Files\nSOUL.md / BRAND.md / USER.md"]
        Skills["Skills System"]
        MCP["MCP Bridge\nmcporter"]
    end

    subgraph Tools["Tool Registry — 30+ tools"]
        direction LR
        WebSearch["Web Search\nBrave / DDG / Tavily"]
        GitHub["GitHub\nIntegration"]
        BashExec["Shell / Bash\nExecution"]
        Media["Media\nProcessing"]
        Outreach["Outreach CRM\ncontacts / campaigns"]
    end

    subgraph Providers["LLM Providers"]
        direction LR
        OAI["OpenAI"]
        ANT["Anthropic"]
        GEM["Gemini / Groq\n/ Ollama"]
        Other["30+ providers"]
    end

    subgraph Storage["Storage"]
        direction LR
        SQLite["SQLite DB\nmemory FTS + cron"]
        JSON_Store["JSON Store\nmemories / sessions"]
        Logs["JSONL Logs\nobservability"]
    end

    Inputs --> Gateway
    Gateway --> AgentSystem
    AgentSystem --> ContextLayer
    AgentSystem --> Tools
    AgentSystem --> Providers
    ContextLayer --> Storage
    Tools --> Storage
```

---

## 3. Message Processing Flow

```mermaid
sequenceDiagram
    participant User
    participant Channel as Channel Adapter
    participant Gateway as Gateway Server
    participant Router as Message Router
    participant AutoReply as Auto-Reply Engine
    participant Session as Session Manager
    participant Orchestrator as Orchestrator Agent
    participant LLM as LLM Provider
    participant Tools as Tool Registry
    participant Memory as Memory Store

    User->>Channel: Send message
    Channel->>Gateway: Inbound event (webhook / polling)
    Gateway->>Router: resolve-route → identify agent & session
    Router->>AutoReply: Check auto-reply binding
    AutoReply->>Session: Load or create session
    Session->>Memory: Fetch context from memory store
    Session->>Orchestrator: Hand off task with context
    Orchestrator->>LLM: Send prompt (system + history + memory)
    LLM-->>Orchestrator: Streaming response
    Orchestrator->>Tools: Call tool if needed
    Tools-->>Orchestrator: Tool result
    Orchestrator->>Memory: Store new memories
    Orchestrator-->>Gateway: Final response
    Gateway-->>Channel: Send reply
    Channel-->>User: Response message
```

---

## 4. Multi-Agent System

```mermaid
flowchart LR
    Input["Incoming Request"] --> Orchestrator

    subgraph Agents["Agent System"]
        Orchestrator["Orchestrator\ndefault agent\nRoutes & delegates"]
        Content["Content Specialist\nWrites marketing content\nEnforces brand tone"]
        Strategy["Strategy Lead\nPlans campaigns\nResearches competitors"]
        Growth["Growth Analyst\nReviews content\nTracks performance"]
    end

    Orchestrator -->|"MESSAGE_AGENT: content"| Content
    Orchestrator -->|"MESSAGE_AGENT: strategy"| Strategy
    Orchestrator -->|"MESSAGE_AGENT: growth"| Growth
    Content -->|Result| Orchestrator
    Strategy -->|Result| Orchestrator
    Growth -->|Result| Orchestrator

    Orchestrator --> Output["Response to user"]

    style Orchestrator fill:#4A90D9,color:#fff
    style Content fill:#50C878,color:#fff
    style Strategy fill:#FFB347,color:#fff
    style Growth fill:#DDA0DD,color:#fff
```

| Agent | Role | Strength |
|---|---|---|
| **Orchestrator** | Routes tasks, manages brands/projects | Coordination & delegation |
| **Content Specialist** | Writes content, enforces tone | Creative writing |
| **Strategy Lead** | Plans campaigns, researches market | Strategic thinking |
| **Growth Analyst** | Reviews content, analyzes performance | Analysis & optimization |

---

## 5. Channel Integration

```mermaid
flowchart LR
    subgraph Core["Core Channels (built-in)"]
        TG["Telegram\nBot API"]
        DC["Discord\nBot Token"]
        SL["Slack\nSlack App"]
        SG["Signal\nsignal-cli daemon"]
        WA["WhatsApp Web\nsrc/web"]
        IM["iMessage\nmacOS only"]
    end

    subgraph Ext["Extension Channels (plugins)"]
        MS["Microsoft Teams"]
        MX["Matrix"]
        ZL["Zalo"]
        GT["Google Chat"]
        NC["Nextcloud Talk"]
        IRC["IRC"]
    end

    subgraph GW["Gateway"]
        CM["Channel Manager\nserver-channels.ts"]
        AR["Auto-Reply Bindings"]
        RR["Message Router\nresolve-route.ts"]
    end

    Core --> CM
    Ext --> CM
    CM --> AR
    CM --> RR
    RR --> AgentSystem["Agent System"]
```

---

## 6. Memory & Context System

```mermaid
flowchart TB
    Input["Incoming message / request"] --> MemSearch["Memory Search\nBM25 FTS + JSON"]

    subgraph MemoryLayer["Memory Layer"]
        direction LR
        FastJSON["Fast Store\nmemories.json\nquick access"]
        SQLiteFTS["SQLite FTS\nfoxfang.db\nBM25 full-text search"]
    end

    subgraph WorkspaceFiles["Workspace Context Files"]
        direction LR
        SOUL["SOUL.md\npersonality & style"]
        BRAND["BRAND.md\nbrand identity"]
        USER["USER.md\nuser preferences"]
        BOOT["BOOTSTRAP.md\nagent init info"]
    end

    MemSearch --> FastJSON
    MemSearch --> SQLiteFTS
    FastJSON --> ContextBuilder["Context Builder\nsystem-prompt.ts"]
    SQLiteFTS --> ContextBuilder
    WorkspaceFiles --> ContextBuilder
    ContextBuilder --> LLM["LLM Prompt"]
```

---

## 7. Tool Registry

```mermaid
mindmap
  root((Tool Registry))
    Research
      Web Search
        Brave
        DuckDuckGo
        Tavily
        Exa
        Perplexity
      Link Understanding
      Media Understanding
    Content
      Image Generation
        FAL
      Text-to-Speech
        ElevenLabs
        Deepgram
    Development
      Bash / Shell Execution
      GitHub Integration
      File Read / Write
      Diff and Patch
    Scheduling
      Cron Jobs SQLite
      Recurring Tasks
    Communication
      Channel Tools
        Send to Telegram
        Send to Discord
      Outreach CRM
        Contacts
        Campaigns
        Sequences
    Agent Ops
      Memory Search
      Memory Store
      Sub-agent Spawn
      Session Management
```

---

## 8. Gateway Server

```mermaid
flowchart TB
    subgraph GatewayServer["Gateway Server — Express HTTP"]
        direction TB
        REST["REST API Endpoints\n/api/* /healthz"]
        WS["WebSocket\nreal-time chat & events"]
        ControlUI["Web Control UI\nNext.js dashboard"]
        subgraph Services["Internal Services"]
            SessService["Session Service"]
            CronService["Cron Scheduler"]
            ChannelService["Channel Manager"]
            PluginService["Plugin Runtime"]
            ModelService["Model Catalog"]
        end
    end

    subgraph Auth["Auth & Security"]
        TokenAuth["Gateway Token\nBearer"]
        RateLimit["Rate Limiting"]
        Allowlist["IP / User Allowlist"]
        SandboxPolicy["Sandbox Policy\nDocker / Node"]
    end

    REST --> Auth
    WS --> Auth
    Auth --> Services
    Services --> AgentSystem["Agent System"]
```

---

## 9. Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Idle: Session initialized
    Idle --> Active: First message received
    Active --> Processing: Agent starts processing
    Processing --> ToolCall: Agent invokes a tool
    ToolCall --> Processing: Tool result returned
    Processing --> Responding: Generating response
    Responding --> Active: Reply sent — waiting for next message
    Active --> Idle: Timeout (inactivity)
    Idle --> Compacted: Context window limit reached
    Compacted --> Active: Rolling summary created
    Active --> [*]: Session deleted / reset
```

---

## 10. Boot Flow

```mermaid
flowchart TD
    Start["foxfang gateway run"] --> ParseArgs["Parse CLI args + profile env"]
    ParseArgs --> NormalizeEnv["Normalize ENV + compile cache"]
    NormalizeEnv --> LoadConfig["Load foxfang.json"]
    LoadConfig --> InitDB["Init SQLite DB\nmemory FTS + cron"]
    InitDB --> LoadPlugins["Load & init plugins"]
    LoadPlugins --> RegisterChannels["Register channels"]
    RegisterChannels --> StartHTTP["Start Express HTTP server"]
    StartHTTP --> StartCron["Start cron scheduler"]
    StartCron --> Ready["Gateway ready\nlocalhost:18789"]
    Ready --> Listen["Listening:\nWebSocket / channel webhooks / CLI"]
```

---

## 11. Configuration & Data Layout

```
~/.foxfang/
├── foxfang.json          # Main config (providers, channels, agents, bindings)
├── credentials/          # API keys (keychain store)
├── memory/
│   └── memories.json     # JSON memory store (fast access)
├── sessions/             # Chat history per agent
│   └── <agentId>/sessions.json
├── workspace/            # Workspace files that shape agent behavior
│   ├── SOUL.md           # Personality & writing style
│   ├── BRAND.md          # Brand identity
│   └── USER.md           # User preferences
├── agents/<agentId>/agent/  # Per-agent workspace dir
├── logs/                 # JSONL request traces (observability)
└── foxfang.db            # SQLite: memory FTS + cron jobs
```

---

## 12. What Has Been Customized (FoxFang vs OpenClaw)

### ✅ Already Customized

| Area | Change |
|---|---|
| **Branding** | Renamed all `openclaw` → `foxfang`, changed binary/config/paths |
| **README** | Rewritten as marketing agent, added multi-agent table, updated commands |
| **Agent system** | Added 3 specialist agents: Content, Strategy, Growth |
| **Outreach CRM** | Added contacts/campaigns/sequences (not in OpenClaw) |
| **Workspace files** | SOUL.md/BRAND.md/USER.md oriented for marketing context |
| **Channels** | Reduced to 7 focused channels (removed obscure ones) |
| **LLM providers** | Kept broad provider support (OpenAI, Anthropic, Kimi, Groq, etc.) |
| **Tool registry** | Kept web search, GitHub, bash, cron, image gen |
| **Memory** | Simplified to SQLite FTS + JSON (removed LanceDB dependency) |
| **Observability** | JSONL request traces kept |
| **Deploy** | Railway + Docker templates updated |

---

## 13. What Still Needs to Be Built / Improved

### 🔴 Critical gaps (must-have for a true marketing agent)

| Gap | Why It Matters | Suggested Approach |
|---|---|---|
| **No marketing system prompt** | SOUL.md/BRAND.md are empty stubs — no actual marketing personality baked in | Fill SOUL.md with marketing copywriter persona, BRAND.md with your brand info |
| **Agent delegation is not wired** | `MESSAGE_AGENT:` directive exists but specialist agents (content/strategy/growth) are not set up in config | Add agent entries to `foxfang.json` with proper workspace dirs |
| **Outreach CRM has no UI** | Contacts/campaigns exist in code but no CLI or Web UI surface | Build `foxfang outreach` CLI commands + Web UI section |
| **No social media posting tools** | Cannot post to Twitter/X, LinkedIn, Instagram directly | Add tool extensions for social APIs |
| **No content calendar / scheduling** | Cron exists but no marketing-specific scheduling templates | Build campaign cron workflows |
| **No analytics ingestion** | Growth Analyst has no data to analyze without real metrics input | Integrate Google Analytics / Twitter analytics tool |

### 🟡 Important improvements (significantly better UX)

| Gap | Why It Matters | Suggested Approach |
|---|---|---|
| **Web UI has no marketing dashboard** | Control UI is generic (from OpenClaw) — shows sessions/config but not marketing KPIs | Add campaign view, content calendar, contact list to Web UI |
| **Memory is not marketing-aware** | Generic memory store — doesn't categorize by brand/project/campaign | Add structured memory schema for marketing context |
| **No brand voice guardrails** | Content Specialist can drift from brand tone | Add tone validation step in content pipeline |
| **Workspace SOUL.md not filled** | Agent has no personality — responds generically | Write a detailed marketing copywriter SOUL.md |
| **No A/B content variants** | Can't generate and compare multiple content versions | Build variant generation flow in Content Specialist |
| **No competitor tracking** | Strategy Lead has web search but no structured competitor monitoring | Add recurring cron job for competitor research |

### 🟢 Nice-to-have (advanced features)

| Feature | Description |
|---|---|
| **Campaign performance dashboard** | Real-time metrics pulled via tool calls + visualized in Web UI |
| **Multi-brand support** | Multiple BRAND.md files switchable per session |
| **Content approval flow** | Human-in-the-loop step before posting (approval via messaging channel) |
| **SEO keyword tracking** | Scheduled keyword research reports |
| **Influencer outreach tracking** | Extend Outreach CRM with influencer-specific fields |
| **AI image generation for posts** | FAL integration already exists — wire it to content workflow |
| **OpenClaw features to backport** | Trajectory system (task planning), Memory SDK, real-time voice (optional) |

---

## 14. Summary

| Component | Technology | Role |
|---|---|---|
| **Runtime** | Node 22+ / TypeScript ESM | Full core runtime |
| **Gateway** | Express HTTP + WebSocket | Control plane, API server |
| **Agent System** | Custom orchestrator + specialists | Task processing & delegation |
| **LLM Providers** | 30+ adapters (OpenAI, Anthropic...) | Model inference |
| **Channel Adapters** | Telegram, Discord, Slack, Signal... | Communication channels |
| **Memory** | SQLite BM25 FTS + JSON | Long-term context |
| **Tools** | 30+ built-in + extensible | Task execution |
| **Plugin System** | npm packages + ClawHub | Feature extensibility |
| **Storage** | SQLite + JSONL | Sessions, cron, logs |
| **Web UI** | Next.js dashboard | Visual management |
| **Build** | tsdown (ESM bundle) | Production build |
| **Tests** | Vitest + V8 coverage | Quality assurance |

> **Core design principles:**
> - **Local-first**: All data processed on your device
> - **Privacy by default**: No mandatory cloud dependency
> - **Plugin-first**: Lean core, optional features as plugins
> - **Multi-channel**: One Gateway serves all channels simultaneously
> - **Marketing-native**: Agents and tools shaped for marketing workflows
