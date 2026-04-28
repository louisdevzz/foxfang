# Session Runtime Logic (FoxFang)

Tài liệu này mô tả logic session theo behavior runtime thực tế trong code, tập trung vào:
- cách chọn `sessionKey`/`sessionId`,
- reset/fork/archive,
- persistence và session resolution từ gateway.

## 1) Thành phần chính

- Session initialization và reset policy: `src/auto-reply/reply/session.ts`
- Session key/store/transcript helpers: `src/config/sessions/*`
- Gateway session resolve API: `src/gateway/sessions-resolve.ts`
- Session lifecycle hooks/archive: `src/auto-reply/reply/session.ts`, `src/gateway/session-archive.runtime.ts`

## 2) Luồng khởi tạo session (inbound message)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    A0["Inbound message context"] --> A1["Resolve conversation binding target"]
    A1 --> A2["Decide effective session context"]
    A2 --> A3["Resolve agent from session key"]
    A3 --> A4["Load session store (fresh snapshot)"]
    A4 --> A5["Detect reset triggers (/new, /reset, prefix forms)"]
    A5 --> A6{"Reset authorized?"}
    A6 -- "No" --> A7["Ignore reset command and continue"]
    A6 -- "Yes" --> A8["Mark new session + optional stripped body"]
    A7 --> A9["Resolve final session key by scope"]
    A8 --> A9
    A9 --> A10["Load existing entry and freshness check"]
    A10 --> A11{"Existing fresh entry?"}
    A11 -- "Yes" --> A12["Reuse sessionId and persisted overrides"]
    A11 -- "No" --> A13["Create new sessionId and seed entry"]
    A12 --> A14["Normalize delivery context and metadata"]
    A13 --> A14
    A14 --> A15["Resolve/persist session transcript file"]
    A15 --> A16["Write session store atomically"]
    A16 --> A17["Archive previous transcript when rollover/reset"]
    A17 --> A18["Emit session_start/session_end hooks"]
    A18 --> A19["Return SessionInitResult"]
```

## 3) Session reset, rollover, fork, archive

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    R0["Session entry loaded"] --> R1{"Reset trigger or stale by policy?"}
    R1 -- "No" --> R2["Keep active session"]
    R1 -- "Yes" --> R3["Capture previousSessionEntry"]
    R3 --> R4["Create new sessionId"]
    R4 --> R5["Carry selected overrides (thinking/verbose/model/auth)"]
    R5 --> R6["Reset compaction and usage counters"]
    R6 --> R7["Persist new entry + transcript path"]
    R7 --> R8["Archive old transcript with reason=reset"]
    R8 --> R9["Emit hook events (end old/start new)"]

    R2 --> F0{"Parent session fork allowed?"}
    F0 -- "No" --> F1["No fork"]
    F0 -- "Yes" --> F2{"Parent token count under max?"}
    F2 -- "No" --> F3["Skip fork, mark forkedFromParent=true"]
    F2 -- "Yes" --> F4["Fork from parent transcript to new session"]
```

## 4) Session resolution from gateway API (`key`/`sessionId`/`label`)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    G0["Gateway sessions.resolve request"] --> G1{"Exactly one selector provided?"}
    G1 -- "No" --> G2["INVALID_REQUEST"]
    G1 -- "Yes" --> G3{"Selector type"}
    G3 -- "key" --> G4["Resolve canonical store target + migrate legacy key if needed"]
    G3 -- "sessionId" --> G5["List sessions and find unique sessionId match"]
    G3 -- "label" --> G6["Parse label and find unique label match"]
    G4 --> G7{"Visible under filter constraints?"}
    G5 --> G7
    G6 --> G7
    G7 -- "No" --> G8["No session found / ambiguous"]
    G7 -- "Yes" --> G9["Return canonical session key"]
```

## 5) Dữ liệu session quan trọng cần theo dõi

- Session identity: `sessionId`, `sessionKey`, `sessionFile`
- Delivery routing: `lastChannel`, `lastTo`, `lastAccountId`, `lastThreadId`
- Runtime state: `updatedAt`, `abortedLastRun`, `systemSent`
- Agent behavior overrides: `thinkingLevel`, `verboseLevel`, `reasoningLevel`, `modelOverride`, `providerOverride`
- Maintenance state: `compactionCount`, `memoryFlushCompactionCount`, `totalTokens`, `totalTokensFresh`

## 6) Hành vi an toàn/chống lỗi đáng chú ý

- Bỏ qua reset trigger nếu sender không đủ quyền hoặc scope không phù hợp.
- Với session cũ không còn fresh, tạo session mới thay vì tái sử dụng transcript cũ.
- Transcript path được chuẩn hóa và persist trước khi run để tránh orphan state.
- Session resolve theo `label`/`sessionId` fail fast khi nhiều kết quả (tránh chọn nhầm).
- Legacy key migration được thực hiện tại gateway resolve để giữ tương thích cũ.

## 7) Checklist khi sửa logic session

- Session key có đổi theo scope mong muốn không.
- Reset trigger có làm mất override người dùng không.
- Rollover có archive transcript cũ không.
- Gateway resolve có trả nhầm session khi filter theo `spawnedBy`/`agentId` không.
- `sessionFile` có luôn được resolve/persist nhất quán sau reset/fork không.
