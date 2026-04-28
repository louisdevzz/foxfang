# Tool Runtime Logic (FoxFang)

Tài liệu này mô tả runtime của tools theo code hiện tại: từ catalog/resolve cho tới execution trong agent loop.

## 1) Thành phần chính

- Tool catalog API: `src/gateway/server-methods/tools-catalog.ts`
- Plugin tool resolve + conflict policy: `src/plugins/tools.ts`
- Agent turn execution + fallback loop: `src/auto-reply/reply/agent-runner-execution.ts`
- Embedded runtime entrypoint: `src/agents/pi-embedded.ts`

## 2) High-level flow

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    T0["Inbound request / message turn"] --> T1["Resolve active toolset (core + plugin)"]
    T1 --> T2["Build run context (agent/session/model/options)"]
    T2 --> T3["Run embedded agent with model fallback"]
    T3 --> T4{"Model emits tool calls?"}
    T4 -- "No" --> T5["Emit text/media response and usage accounting"]
    T4 -- "Yes" --> T6["Execute tool handler(s), stream tool events/results"]
    T6 --> T7["Feed tool outputs back to model loop"]
    T7 --> T4
```

## 3) Tool catalog runtime (`tools.catalog`)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    C0["tools.catalog request"] --> C1["Validate params + resolve agentId"]
    C1 --> C2["Build core tool groups/profiles"]
    C2 --> C3{"includePlugins?"}
    C3 -- "No" --> C4["Return core-only catalog"]
    C3 -- "Yes" --> C5["Resolve plugin tools for agent context"]
    C5 --> C6["Group tools by pluginId"]
    C6 --> C7["Summarize descriptions + metadata"]
    C7 --> C8["Return combined catalog"]
```

## 4) Plugin tool resolution policy

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    P0["Resolve plugin registry"] --> P1{"Plugins effectively enabled?"}
    P1 -- "No" --> P2["Return empty plugin tools"]
    P1 -- "Yes" --> P3["Iterate registry tool factories"]
    P3 --> P4["Invoke factory with tool context"]
    P4 --> P5{"Factory returned tool(s)?"}
    P5 -- "No" --> P3
    P5 -- "Yes" --> P6{"Optional tool + allowlist check"}
    P6 -- "Blocked" --> P3
    P6 -- "Allowed" --> P7{"Name conflicts (core/plugin/duplicate)?"}
    P7 -- "Yes" --> P8["Log diagnostic, skip conflicting tool/plugin"]
    P7 -- "No" --> P9["Attach plugin metadata and accept tool"]
    P8 --> P3
    P9 --> P3
```

## 5) Execution loop with model fallback

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    E0["Start runAgentTurnWithFallback"] --> E1["Register run context + callbacks"]
    E1 --> E2["runWithModelFallback(...)"]
    E2 --> E3{"Attempt succeeded?"}
    E3 -- "No (retryable/fallback)" --> E2
    E3 -- "No (terminal)" --> E4["Return final error payload"]
    E3 -- "Yes" --> E5["Process streamed partials/tool events"]
    E5 --> E6["Normalize text/media + silent token filtering"]
    E6 --> E7["Deliver block reply / typed delta / final payload"]
```

## 6) Runtime guardrails đáng chú ý

- Optional plugin tools chỉ xuất hiện khi allowlist cho phép.
- Plugin tool name conflict không được override core tool name.
- Tool execution nằm trong cùng run lifecycle nên fallback/usage accounting vẫn nhất quán.
- Streaming path lọc token điều khiển (`SILENT_REPLY_TOKEN`, heartbeat artifacts) trước khi gửi user.
- Tool result callbacks có thể stream ra control-ui và channel delivery path tùy runtime mode.

## 7) Khi sửa tool runtime, nên verify

- `tools.catalog` có giữ đúng agent scope + profile metadata không.
- Plugin tool conflicts có còn bị chặn đúng.
- Tool streaming có gây duplicate block replies không.
- Fallback retry path có preserve tool callbacks và run context không.
- Error sanitization có giữ message user-safe trong các lỗi tool/provider.
