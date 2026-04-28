# Plugin Runtime Logic (FoxFang)

Tài liệu này mô tả plugin runtime theo code hiện tại: discovery/load/cache/runtime binding và gateway bootstrap integration.

## 1) Thành phần chính

- Plugin load orchestration: `src/plugins/loader.ts`
- Plugin runtime facade: `src/plugins/runtime/index.ts`
- Gateway plugin bootstrap: `src/gateway/server-plugin-bootstrap.ts`
- Gateway plugin integration + subagent runtime bridge: `src/gateway/server-plugins.ts`

## 2) End-to-end plugin lifecycle

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    L0["Gateway/runtime needs plugins"] --> L1["Normalize plugins config + auto-enable"]
    L1 --> L2["Resolve roots/load paths and cache key"]
    L2 --> L3{"Registry cache hit?"}
    L3 -- "Yes" --> L4["Restore cached registry/memory state"]
    L3 -- "No" --> L5["Discover plugin candidates + manifests"]
    L5 --> L6["Load modules via jiti/runtime alias rules"]
    L6 --> L7["Register tools/channels/hooks/gateway handlers"]
    L7 --> L8["Persist registry into cache"]
    L4 --> L9["Activate runtime registry for process"]
    L8 --> L9
```

## 3) Gateway bootstrap path

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    G0["Gateway startup"] --> G1["Install plugin subagent override policies"]
    G1 --> G2["Set process-global gateway subagent runtime"]
    G2 --> G3["Load gateway plugins (core handlers + base methods)"]
    G3 --> G4["Prime configured binding registry"]
    G4 --> G5["Emit plugin diagnostics (error/info)"]
    G5 --> G6["Gateway continues with active plugin registry"]
```

## 4) Runtime facade exposed to plugins

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart LR
    R0["createPluginRuntime()"] --> R1["config / agent / system / media"]
    R0 --> R2["channel / events / logging / state"]
    R0 --> R3["webSearch / imageGeneration"]
    R0 --> R4["subagent late-binding runtime"]
    R0 --> R5["lazy modules: tts, stt, mediaUnderstanding, modelAuth"]
```

## 5) Subagent runtime binding model

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    S0["Plugin asks runtime.subagent.*"] --> S1{"Explicit subagent provided?"}
    S1 -- "Yes" --> S2["Use explicit runtime subagent"]
    S1 -- "No" --> S3{"Gateway binding allowed?"}
    S3 -- "No" --> S4["Unavailable runtime throws clear error"]
    S3 -- "Yes" --> S5["Resolve process-global gateway subagent"]
    S5 --> S6{"Gateway runtime available?"}
    S6 -- "No" --> S4
    S6 -- "Yes" --> S7["Dispatch to gateway method path"]
```

## 6) Gateway dispatch bridge for plugin runtime

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    D0["Plugin runtime calls subagent run/getSession/..."] --> D1["Resolve request scope from AsyncLocalStorage"]
    D1 --> D2{"Scope context exists?"}
    D2 -- "No" --> D3["Fallback to gateway startup context resolver"]
    D2 -- "Yes" --> D4["Use scoped client/context"]
    D3 --> D4
    D4 --> D5["Dispatch synthetic gateway request"]
    D5 --> D6["Handle role/scope/model-override policy"]
    D6 --> D7["Run handler via handleGatewayRequest"]
    D7 --> D8["Return payload or mapped error"]
```

## 7) Runtime guardrails đáng chú ý

- Plugin registry có cache + eviction cap để tránh reload tốn chi phí.
- Gateway-bindable subagent runtime là opt-in, không phải default.
- Model override qua plugin subagent bị policy-gate theo plugin config.
- Plugin diagnostics giữ visibility cho load conflicts/failures thay vì fail silent.
- Runtime modules nặng (`tts`, `mediaUnderstanding`, `modelAuth`) load lazy để giảm startup cost.

## 8) Khi sửa plugin runtime, nên verify

- Cache key có phản ánh đủ các biến ảnh hưởng behavior không.
- Gateway startup có set đúng subagent runtime trước khi plugin dùng.
- Plugin tool/channel/gateway handlers có được đăng ký đúng trong registry mới.
- Fallback gateway context có còn hoạt động cho non-WS channel paths.
- Policy `subagent.allowModelOverride` + allowlist hoạt động đúng khi plugin yêu cầu model override.
