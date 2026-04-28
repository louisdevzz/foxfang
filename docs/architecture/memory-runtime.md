# Memory Runtime Logic (FoxFang)

Tài liệu này mô tả luồng memory theo runtime hiện tại:
- memory search config resolution,
- preflight compaction,
- memory flush gating,
- plugin memory integration.

## 1) Thành phần chính

- Memory search config merge/normalize: `src/agents/memory-search.ts`
- Flush/compaction gating + transcript usage extraction: `src/auto-reply/reply/agent-runner-memory.ts`
- Gating helpers và dedupe hash: `src/auto-reply/reply/memory-flush.ts`
- Memory plugin contract và flush plan resolver: `src/plugins/memory-state.ts`
- Memory config type surface: `src/config/types.memory.ts`

## 2) Luồng resolve cấu hình memory search

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    C0["Load global defaults + per-agent overrides"] --> C1["Merge config fields"]
    C1 --> C2["Normalize provider/remote/local/store/chunking/query/cache"]
    C2 --> C3["Resolve store path (supports token replacement)"]
    C3 --> C4["Clamp and normalize numeric thresholds"]
    C4 --> C5["Validate multimodal compatibility"]
    C5 --> C6{"Enabled?"}
    C6 -- "No" --> C7["Return null (memory search disabled)"]
    C6 -- "Yes" --> C8["Return ResolvedMemorySearchConfig"]
```

## 3) Preflight compaction trước agent turn

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    P0["Before run"] --> P1{"Has session key + session entry?"}
    P1 -- "No" --> P9["Skip preflight compaction"]
    P1 -- "Yes" --> P2{"Heartbeat or CLI provider?"}
    P2 -- "Yes" --> P9
    P2 -- "No" --> P3["Resolve context window + flush plan thresholds"]
    P3 --> P4["Estimate prompt tokens for current command"]
    P4 --> P5["Use fresh token totals or transcript fallback snapshot"]
    P5 --> P6["Compute projected token count and threshold"]
    P6 --> P7{"Should compact now?"}
    P7 -- "No" --> P9
    P7 -- "Yes" --> P8["Run compact session, increment compaction count,\nappend post-compaction context refresh prompt"]
```

## 4) Memory flush gating và execution

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    F0["Resolve memory flush plan from plugin state"] --> F1{"Flush plan exists?"}
    F1 -- "No" --> F9["Skip flush"]
    F1 -- "Yes" --> F2{"Writable runtime + not heartbeat + not CLI?"}
    F2 -- "No" --> F9
    F2 -- "Yes" --> F3["Compute context window and thresholds"]
    F3 --> F4["Read persisted token snapshot"]
    F4 --> F5["Optionally read transcript tail usage + transcript byte size"]
    F5 --> F6["Project next token count\n(prompt + last output + estimate)"]
    F6 --> F7{"Trigger condition met?\n(token threshold OR forced flush by transcript size)"}
    F7 -- "No" --> F9
    F7 -- "Yes" --> F8["Run dedicated memory flush agent turn"]
    F8 --> F10["Persist memoryFlushAt + memoryFlushCompactionCount"]
    F10 --> F11["Refresh session/queue sessionId if compaction happened during flush"]
```

## 5) Memory plugin runtime contract

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart LR
    M0["Core runtime"] --> M1["Memory plugin state registry"]
    M1 --> M2["Prompt section builder"]
    M1 --> M3["Flush plan resolver"]
    M1 --> M4["Memory runtime backend"]
    M4 --> M5["Manager status/probe/sync"]
```

## 6) Quy tắc chống flush lặp

Core rule đang được dùng trong `src/auto-reply/reply/memory-flush.ts`:
- Không flush lại nếu `memoryFlushCompactionCount` đã bằng `compactionCount` hiện tại.

Ghi chú:
- `computeContextHash()` hiện là helper sẵn có cho dedupe theo nội dung context, nhưng chưa được đưa vào nhánh gating runtime mặc định.

## 7) Error/safety behavior đáng chú ý

- Nếu flush run lỗi: không crash whole reply path, chỉ log verbose và tiếp tục.
- Nếu transcript usage không đọc được: fallback về snapshot hiện có.
- Multimodal memory bị chặn nếu provider/model không hỗ trợ embedding multimodal.
- Khi sandbox workspace không writable, memory flush bị tắt để tránh write failures.

## 8) Checklist khi chỉnh memory logic

- Thay đổi threshold có làm tăng compaction/flush quá mức không.
- Session token snapshot có được cập nhật `fresh` đúng điều kiện không.
- Forced flush theo transcript size có gây loop không.
- Sau flush/compaction, queue session mapping có được refresh đúng không.
- Plugin flush plan resolver có tồn tại trong runtime path cần dùng không.
