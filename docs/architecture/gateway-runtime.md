# Gateway Runtime Logic (FoxFang)

Tài liệu này mô tả control-plane runtime của Gateway theo code hiện tại:
- startup/bootstrap,
- HTTP + WebSocket request path,
- method dispatch/authz/rate-limit,
- config reload strategy,
- channel/runtime sidecars.

## 1) Thành phần chính

- Gateway orchestration: `src/gateway/server.impl.ts`
- HTTP transport + route handling: `src/gateway/server-http.ts`
- WS handler attachment: `src/gateway/server-ws-runtime.ts`
- Method dispatcher và authz: `src/gateway/server-methods.ts`
- Config watcher/reloader: `src/gateway/config-reload.ts`

## 2) Startup orchestration

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    S0["Gateway start request"] --> S1["Load and validate config snapshot"]
    S1 --> S2["Apply startup auth/tailscale overrides"]
    S2 --> S3["Prepare and activate secrets runtime snapshot"]
    S3 --> S4["Initialize plugin registry/runtime services"]
    S4 --> S5["Create channel manager + runtime state"]
    S5 --> S6["Start HTTP/WS transport"]
    S6 --> S7["Attach gateway methods and subscribers"]
    S7 --> S8["Start channel accounts"]
    S8 --> S9["Start cron/heartbeat/maintenance sidecars"]
    S9 --> S10["Gateway ready and serving"]
```

## 3) HTTP request lifecycle

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    H0["Incoming HTTP request"] --> H1["Apply security headers + parse path"]
    H1 --> H2{"Probe endpoint (health/ready)?"}
    H2 -- "Yes" --> H3["Handle probe response and optional readiness details"]
    H2 -- "No" --> H4{"Control UI / avatar / canvas path?"}
    H4 -- "Yes" --> H5["Serve control-ui/canvas assets with auth checks"]
    H4 -- "No" --> H6{"OpenAI-compatible APIs?"}
    H6 -- "Yes" --> H7["Handle models/chat/responses/embeddings routes"]
    H6 -- "No" --> H8{"Hooks/plugin/tool/session endpoints?"}
    H8 -- "Yes" --> H9["Auth + idempotency + dispatch handlers"]
    H8 -- "No" --> H10["Return not found / unsupported"]
```

## 4) WebSocket lifecycle

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    W0["WS connection attempt"] --> W1["Preauth connection budget gate"]
    W1 --> W2["Authenticate gateway connect params"]
    W2 --> W3{"Authorized?"}
    W3 -- "No" --> W4["Reject with auth error / throttling"]
    W3 -- "Yes" --> W5["Register client + capabilities"]
    W5 --> W6["Handle method requests over WS"]
    W6 --> W7["Dispatch to gateway method handlers"]
    W7 --> W8["Respond + emit events to subscribers"]
```

## 5) Method dispatch: authz + scope + handler execution

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    M0["Gateway request method"] --> M1["Authorize role and scopes for method"]
    M1 --> M2{"Authorized?"}
    M2 -- "No" --> M3["Return INVALID_REQUEST unauthorized role/scope"]
    M2 -- "Yes" --> M4{"Control-plane write method?"}
    M4 -- "Yes" --> M5["Consume write budget rate-limit token"]
    M5 --> M6{"Budget available?"}
    M6 -- "No" --> M7["Return UNAVAILABLE retryable with retryAfterMs"]
    M6 -- "Yes" --> M8["Resolve handler from core + extra handlers"]
    M4 -- "No" --> M8
    M8 --> M9{"Handler exists?"}
    M9 -- "No" --> M10["Return unknown method error"]
    M9 -- "Yes" --> M11["Execute handler in gateway request scope"]
    M11 --> M12["Return payload/error response"]
```

## 6) Config reload (hot vs restart vs off)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    R0["File watcher event (add/change/unlink)"] --> R1["Debounce timer"]
    R1 --> R2["Read config snapshot"]
    R2 --> R3{"Exists + valid?"}
    R3 -- "No" --> R4["Retry briefly or skip with warning"]
    R3 -- "Yes" --> R5["Diff changed paths"]
    R5 --> R6["Build reload plan"]
    R6 --> R7{"Reload mode"}
    R7 -- "off" --> R8["Log reload disabled"]
    R7 -- "restart" --> R9["Queue gateway restart callback"]
    R7 -- "hot/hybrid" --> R10{"Plan requires restart?"}
    R10 -- "Yes + hybrid" --> R9
    R10 -- "Yes + hot" --> R11["Warn and ignore restart-required change"]
    R10 -- "No" --> R12["Run onHotReload plan"]
```

## 7) Channel/runtime sidecars

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart LR
    X0["Gateway core runtime"] --> X1["Channel manager + health monitor"]
    X0 --> X2["Cron service + isolated agent jobs"]
    X0 --> X3["Heartbeat runner"]
    X0 --> X4["Discovery, tailscale, maintenance timers"]
    X0 --> X5["Model pricing refresh + diagnostics heartbeat"]
```

## 8) Runtime safety behaviors đáng chú ý

- Auth mode và bind mode được kiểm tra trước startup để tránh exposed unauth gateway.
- Control-plane write methods có rate-limit riêng để giảm rủi ro burst writes.
- Request handler luôn chạy trong scoped runtime context để plugin/subagent calls có context đúng.
- Config watcher có debounce, retry khi file tạm mất, và queue restart an toàn (tránh loop restart).
- WS path có preauth budget + auth gate để giảm abuse trước khi fully authenticated.

## 9) Checklist khi sửa gateway runtime

- Có phá vỡ startup order (auth/secrets/plugins/transport/channels) không.
- HTTP probe/readiness behavior có giữ backward compatibility không.
- Method authz có giữ đúng role/scope matrix không.
- Config reload plan có làm restart quá nhiều khi chỉ cần hot reload không.
- Sidecars (cron/heartbeat/channel monitor) có lifecycle cleanup đầy đủ khi shutdown/restart không.
