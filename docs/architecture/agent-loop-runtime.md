# Agent Loop Runtime Logic (FoxFang)

Tài liệu này mô tả chi tiết vòng lặp agent runtime:
- session/model preparation,
- fallback orchestration,
- tool streaming/events,
- delivery/persistence/update session usage.

## 1) Thành phần chính

- Agent command entrypoint và preparation: `src/agents/agent-command.ts`
- Reply agent main loop: `src/auto-reply/reply/agent-runner.ts`
- Model fallback + embedded/CLI run execution: `src/auto-reply/reply/agent-runner-execution.ts`
- Memory/compaction hooks trước run: `src/auto-reply/reply/agent-runner-memory.ts`

## 2) Agent command prepare -> execute flow

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    A0["agent command request"] --> A1["Validate message and target selector"]
    A1 --> A2["Load config + resolve secret refs + set runtime snapshot"]
    A2 --> A3["Resolve session info and session store paths"]
    A3 --> A4["Resolve agent/workspace and ensure workspace files"]
    A4 --> A5["Resolve model defaults + overrides + allowlist"]
    A5 --> A6["Resolve timeout, thinking, verbose levels"]
    A6 --> A7["Resolve transcript file"]
    A7 --> A8["Execute run with model fallback"]
    A8 --> A9["Persist usage/session updates + deliver result"]
```

## 3) Main agent loop (reply path)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    R0["runReplyAgent() start"] --> R1["Resolve queue mode and active-run policy"]
    R1 --> R2{"Drop / enqueue / run now?"}
    R2 -- "drop" --> R3["End quickly, no payload"]
    R2 -- "enqueue" --> R4["Queue followup run and return"]
    R2 -- "run now" --> R5["Signal typing start"]
    R5 --> R6["Preflight compaction if needed"]
    R6 --> R7["Memory flush if needed"]
    R7 --> R8["Execute runAgentTurnWithFallback"]
    R8 --> R9{"Final short-circuit payload?"}
    R9 -- "Yes" --> R10["Finalize with followup"]
    R9 -- "No" --> R11["Build reply payloads + dedupe/filter"]
    R11 --> R12["Apply reminder safeguards + reply threading mode"]
    R12 --> R13["Persist usage/metrics + verbose notices"]
    R13 --> R14["Finalize payload(s) and schedule followup run"]
```

## 4) Model fallback execution (embedded + CLI)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    F0["Start runWithModelFallback"] --> F1["Try selected provider/model"]
    F1 --> F2{"Provider type"}
    F2 -- "CLI backend" --> F3["Run CLI agent and emit lifecycle events"]
    F2 -- "Embedded runtime" --> F4["Run embedded agent with tool/event callbacks"]
    F3 --> F5{"Run success?"}
    F4 --> F5
    F5 -- "Yes" --> F6["Return result + fallback attempts summary"]
    F5 -- "No" --> F7{"Fallback candidates remain?"}
    F7 -- "Yes" --> F8["Try next model/provider"]
    F8 --> F2
    F7 -- "No" --> F9["Raise summarized fallback error"]
```

## 5) Tool/event streaming path inside embedded run

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    T0["Embedded run emits events"] --> T1{"Event stream type"}
    T1 -- "assistant partial" --> T2["Sanitize text + typing delta + partial delivery"]
    T1 -- "tool start/update" --> T3["Typing tool signal + tool-start callback"]
    T1 -- "tool result" --> T4["Serialize tool-result delivery to preserve order"]
    T1 -- "compaction start/end" --> T5["Send compaction notice + update counters"]
    T1 -- "lifecycle start/end/error" --> T6["Emit lifecycle stream to observers"]
    T2 --> T7["Continue run loop"]
    T3 --> T7
    T4 --> T7
    T5 --> T7
    T6 --> T7
```

## 6) Error recovery matrix trong agent loop

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    E0["Run error captured"] --> E1{"Error class"}
    E1 -- "Live model switch" --> E2["Update active model/provider and retry"]
    E1 -- "Compaction failure / overflow" --> E3["Reset session and return recovery message"]
    E1 -- "Role ordering conflict" --> E4["Reset session + cleanup transcript, ask retry"]
    E1 -- "Session corruption pattern" --> E5["Delete corrupt session artifacts, start fresh"]
    E1 -- "Transient HTTP provider error" --> E6["Single delayed retry"]
    E1 -- "Rate limit / overload summary" --> E7["Return cooldown message"]
    E1 -- "Billing" --> E8["Return billing guidance message"]
    E1 -- "Other fatal" --> E9["Return generic failure + logs hint"]
```

## 7) Post-run accounting và session update

- Session store được cập nhật usage/model sau mỗi run.
- Fallback transition được persist để hiển thị notice khi model active khác model selected.
- `compactionCount` và các trường memory-flush metadata được tăng đồng bộ với session.
- Queue followup session mapping được refresh nếu sessionId/sessionFile đổi sau compaction.
- Typing cleanup có backstop để tránh stuck indicator khi dispatcher không callback đủ.

## 8) Checklist khi sửa agent loop

- Có giữ đúng semantics của queue mode (`drop`, `enqueue`, `run now`) không.
- Fallback có giữ đúng order và không nuốt lỗi quan trọng không.
- Tool-result delivery có còn ordered khi concurrent tools chạy không.
- Recovery path có reset session/store/transcript nhất quán không.
- Accounting sau run có cập nhật đủ usage/model/fallback/compaction fields không.
