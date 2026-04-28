# Agent Loop Runtime Logic (FoxFang)

Tài liệu này là bản deep-dive của vòng lặp agent runtime theo code hiện tại, tập trung vào:
- active-run queue policy,
- preflight compaction + memory flush,
- fallback loop (CLI/embedded),
- tool/event streaming và delivery semantics,
- post-run accounting + recovery paths.

## 1) Thành phần chính (code-backed)

- Agent run orchestration: `src/auto-reply/reply/agent-runner.ts`
- Fallback + execution internals: `src/auto-reply/reply/agent-runner-execution.ts`
- Fallback engine: `src/agents/model-fallback.ts`
- Pre-run memory/compaction: `src/auto-reply/reply/agent-runner-memory.ts`
- Queue/followup policies: `src/auto-reply/reply/queue-policy.ts`, `src/auto-reply/reply/queue.ts`

## 2) Runtime phases (single turn)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart LR
    P0["Ingress"] --> P1["Queue decision"]
    P1 --> P2["Typing start"]
    P2 --> P3["Preflight compaction"]
    P3 --> P4["Memory flush gate"]
    P4 --> P5["runAgentTurnWithFallback"]
    P5 --> P6["Payload assembly + thread/reply mode"]
    P6 --> P7["Usage/session accounting"]
    P7 --> P8["Finalize + followup scheduling"]
```

## 3) Active-run queue policy (chi tiết)

`runReplyAgent()` không luôn chạy model ngay. Nó resolve action qua `resolveActiveRunQueueAction(...)`:
- `drop`: bỏ turn mới, cleanup typing.
- `enqueue-followup`: đưa vào queue và trả về sớm.
- `run-now`: tiếp tục chạy turn hiện tại.

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    Q0["Incoming turn"] --> Q1{"Another run active?"}
    Q1 -- "No" --> Q2["run-now"]
    Q1 -- "Yes" --> Q3["Resolve queue mode + heartbeat/followup flags"]
    Q3 --> Q4{"Action"}
    Q4 -- "drop" --> Q5["Return undefined"]
    Q4 -- "enqueue-followup" --> Q6["enqueueFollowupRun(...)"]
    Q6 --> Q7{"Original run already ended?"}
    Q7 -- "Yes" --> Q8["finalizeWithFollowup(...) immediate trigger"]
    Q7 -- "No" --> Q9["Wait original run finish"]
    Q4 -- "run-now" --> Q2
```

## 4) Pre-run stage: compaction + memory flush

Trước khi vào model loop:
- `runPreflightCompactionIfNeeded(...)`
- `runMemoryFlushIfNeeded(...)`

Mục đích:
- giữ session không vượt context budget,
- flush memory đúng nhịp theo compaction counters,
- cập nhật session entry trước run chính.

## 5) Fallback execution (core loop)

`runAgentTurnWithFallback(...)` là phần nặng nhất của vòng lặp:
- tạo `runId`,
- đăng ký run context cho event stream,
- dựng callback pipeline cho partial/tool/lifecycle,
- gọi `runWithModelFallback(...)`,
- map lỗi sang recovery path phù hợp.

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    F0["runAgentTurnWithFallback start"] --> F1["Setup runId, typing+delivery normalizers"]
    F1 --> F2["Build blockReply handler + tool callbacks"]
    F2 --> F3["runWithModelFallback(...)"]
    F3 --> F4{"Candidate provider type"}
    F4 -- "CLI provider" --> F5["runCliAgent + lifecycle emission backstop"]
    F4 -- "Embedded provider" --> F6["runEmbeddedPiAgent with streaming callbacks"]
    F5 --> F7{"Attempt success?"}
    F6 --> F7
    F7 -- "No + candidate remains" --> F3
    F7 -- "No + exhausted" --> F8["Throw lastError or FallbackSummaryError"]
    F7 -- "Yes" --> F9["Return runResult + fallback attempts"]
```

## 6) Model fallback engine semantics (`model-fallback.ts`)

- Dựng candidate list từ explicit model + allowlist + fallback candidates.
- De-dup theo `provider/model`.
- Với mỗi candidate:
  - chạy attempt,
  - normalize failover errors,
  - phân loại retryable vs terminal.
- Khi tất cả candidate fail:
  - 1 attempt duy nhất -> rethrow lỗi gốc,
  - nhiều attempts -> throw `FallbackSummaryError` với attempt history + cooldown hint.

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    M0["Resolve fallback candidates"] --> M1["Attempt N: run(provider, model)"]
    M1 --> M2{"Success?"}
    M2 -- "Yes" --> M3["Return success + attempts metadata"]
    M2 -- "No" --> M4{"AbortError non-timeout?"}
    M4 -- "Yes" --> M5["Rethrow immediately"]
    M4 -- "No" --> M6["Record attempt (reason/status/code)"]
    M6 --> M7{"Has next candidate?"}
    M7 -- "Yes" --> M1
    M7 -- "No" --> M8["Throw fallback failure summary"]
```

## 7) Streaming and tool event path

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    S0["Model stream event"] --> S1{"Type"}
    S1 -- "assistant partial" --> S2["sanitize + typing delta + optional block reply emit"]
    S1 -- "tool start/update" --> S3["tool progress callbacks"]
    S1 -- "tool result" --> S4["serialize output/result emit; avoid duplication"]
    S1 -- "compaction notice" --> S5["propagate compaction status and counters"]
    S1 -- "lifecycle" --> S6["emit lifecycle start/end/error for observers"]
    S2 --> S7["continue"]
    S3 --> S7
    S4 --> S7
    S5 --> S7
    S6 --> S7
```

Các điểm đặc biệt trong code:
- Lọc token điều khiển (`SILENT_REPLY_TOKEN`, `HEARTBEAT_TOKEN` artifacts).
- Cho phép payload media-only đi qua dù text rỗng.
- Giữ `directlySentBlockKeys` để tránh gửi trùng khi vừa pipeline vừa flush trực tiếp.
- CLI path có lifecycle-event backstop để tránh consumer treo.

## 8) Error and recovery matrix (chi tiết hơn)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    E0["Caught run error"] --> E1{"Classifier"}
    E1 -- "LiveSessionModelSwitchError" --> E2["patch session provider/model and retry loop"]
    E1 -- "Compaction failure / context overflow" --> E3{"already reset once?"}
    E3 -- "No" --> E4["reset session and retry"]
    E3 -- "Yes" --> E5["return final recovery payload"]
    E1 -- "Role ordering conflict" --> E6["reset session with transcript cleanup guidance"]
    E1 -- "Transient HTTP error" --> E7{"already retried?"}
    E7 -- "No" --> E8["sleep 2.5s then retry once"]
    E7 -- "Yes" --> E9["fall through final error payload"]
    E1 -- "Rate limit/overloaded summary" --> E10["cooldown message (with ETA if known)"]
    E1 -- "Billing error" --> E11["billing guidance message"]
    E1 -- "Other fatal" --> E12["generic failure payload + logs"]
```

## 9) Post-run accounting and persistence

- Persist usage tokens và metadata model/provider hiện dùng.
- Persist fallback transition (để UI/notice thể hiện model đã đổi).
- Cập nhật `compactionCount` + memory flush markers đồng bộ session entry.
- Refresh queued followup session mapping nếu sessionId/sessionFile đổi sau compaction/reset.
- Cleanup typing state luôn có backstop để tránh stuck typing indicator.

## 10) Observability points

- Agent event streams: `assistant`, `lifecycle`, tool-related streams.
- Fallback attempts metadata: provider/model/reason/status/code per attempt.
- Verbose diagnostics: token stripping, compaction notices, usage lines.
- Session-level updates: timestamps, usage counters, active model transitions.

## 11) Checklist khi sửa agent loop

- Queue policy vẫn giữ chuẩn `drop/enqueue-followup/run-now`.
- Pre-run compaction/memory flush không phá session consistency.
- Fallback loop không rethrow nhầm retryable failure, không nuốt terminal error.
- Tool/result streaming không duplicate hoặc out-of-order.
- Session reset paths có cleanup đúng phạm vi (không mất dữ liệu ngoài scope).
- Post-run accounting vẫn cập nhật đủ usage/fallback/compaction/followup mapping.
