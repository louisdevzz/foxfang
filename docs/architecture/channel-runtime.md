# Channel Runtime Logic (FoxFang)

Tài liệu này mô tả channel runtime theo code hiện tại: channel registry, account lifecycle, auto-restart, health monitoring, và routing liên quan session.

## 1) Thành phần chính

- Channel manager lifecycle: `src/gateway/server-channels.ts`
- Channel plugin index/registry: `src/channels/plugins/index.ts`, `src/channels/registry.ts`
- Health monitor loop: `src/gateway/channel-health-monitor.ts`
- Inbound route/session binding: `src/routing/resolve-route.ts`

## 2) Kiến trúc tổng thể

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    A0["Gateway startup"] --> A1["Load active channel plugins from registry"]
    A1 --> A2["Create channel manager runtime stores"]
    A2 --> A3["Start channel accounts per plugin config"]
    A3 --> A4["Maintain runtime snapshot (running/configured/error)"]
    A4 --> A5["Health monitor evaluates channels periodically"]
    A5 --> A6["Restart unhealthy accounts with policy gates"]
```

## 3) Channel account startup flow

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    S0["startChannel(channel, account?)"] --> S1["Resolve plugin + account list"]
    S1 --> S2["Guard against duplicate start (starting/tasks maps)"]
    S2 --> S3["Resolve account config"]
    S3 --> S4{"Account enabled?"}
    S4 -- "No" --> S5["Set runtime status disabled + lastError"]
    S4 -- "Yes" --> S6{"Account configured?"}
    S6 -- "No" --> S7["Set runtime status unconfigured + reason"]
    S6 -- "Yes" --> S8["Set running=true, reset errors/attempts"]
    S8 --> S9["Call plugin.gateway.startAccount(...)"]
    S9 --> S10["Track task lifecycle and status updates"]
```

## 4) Stop flow và manual-stop semantics

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    X0["stopChannel(channel, account?)"] --> X1["Collect known account ids from runtime + config"]
    X1 --> X2["Mark account as manually stopped"]
    X2 --> X3["Abort active run controller"]
    X3 --> X4{"Plugin stopAccount exists?"}
    X4 -- "Yes" --> X5["Invoke plugin.gateway.stopAccount(...)"]
    X4 -- "No" --> X6["Skip explicit plugin shutdown hook"]
    X5 --> X7["Await in-flight task completion safely"]
    X6 --> X7
    X7 --> X8["Clear runtime task/abort handles + set running=false"]
```

## 5) Auto-restart/backoff flow (after unexpected exit)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    R0["Channel task exits"] --> R1{"Account manually stopped?"}
    R1 -- "Yes" --> R2["Do not restart"]
    R1 -- "No" --> R3["Increment reconnect attempt counter"]
    R3 --> R4{"Attempt > max attempts?"}
    R4 -- "Yes" --> R5["Give up and keep restartPending=false"]
    R4 -- "No" --> R6["Compute exponential backoff delay"]
    R6 --> R7["Set restartPending=true"]
    R7 --> R8["Sleep with abort signal"]
    R8 --> R9{"Still eligible for restart?"}
    R9 -- "No" --> R2
    R9 -- "Yes" --> R10["Restart via startChannelInternal(preserve attempts)"]
```

## 6) Health monitor loop

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    H0["Periodic monitor tick"] --> H1{"Past monitor startup grace?"}
    H1 -- "No" --> H2["Skip this cycle"]
    H1 -- "Yes" --> H3["Read channel runtime snapshot"]
    H3 --> H4["Evaluate each channel:account health"]
    H4 --> H5{"Healthy?"}
    H5 -- "Yes" --> H6["Continue"]
    H5 -- "No" --> H7{"Monitor enabled + not manually stopped?"}
    H7 -- "No" --> H6
    H7 -- "Yes" --> H8{"Cooldown and hourly restart budget pass?"}
    H8 -- "No" --> H6
    H8 -- "Yes" --> H9["Stop account if running"]
    H9 --> H10["Reset restart attempts and start account again"]
```

## 7) Runtime snapshot semantics

`getRuntimeSnapshot()` trả về:
- `channels`: trạng thái account mặc định cho mỗi channel (view tiện cho UI/status nhanh).
- `channelAccounts`: trạng thái đầy đủ theo từng account.

Các field quan trọng thường thấy:
- `running`, `restartPending`, `connected`
- `enabled`, `configured`
- `lastStartAt`, `lastStopAt`, `lastError`
- `reconnectAttempts`

## 8) Inbound routing liên quan channel runtime

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart LR
    I0["Inbound event from channel account"] --> I1["Resolve route by binding priority"]
    I1 --> I2["Resolve agentId + sessionKey + lastRoutePolicy"]
    I2 --> I3["Dispatch to agent/session runtime"]
    I3 --> I4["Outbound reply uses channel/account context"]
```

## 9) Guardrails quan trọng

- Manual stop có ưu tiên cao: account đã manual-stop sẽ không auto-restart.
- Restart policy có cap attempts + exponential backoff + jitter.
- Health monitor có startup grace, cooldown, và max restarts/hour để tránh restart storm.
- Runtime snapshot luôn phản ánh disabled/unconfigured reason khi account không chạy.
- Channel registry lookup dựa active plugin registry, tránh eager-loading channel implementations nặng.

## 10) Checklist khi sửa channel runtime

- Có tạo race condition giữa `starting`, `tasks`, `aborts` maps không.
- Stop path có cleanup đầy đủ để không leak task/abort controller không.
- Backoff + max attempts có giữ behavior an toàn khi channel crash liên tục không.
- Health monitor có tôn trọng per-account/per-channel override không.
- Route/session key derivation có giữ đúng DM/group/thread semantics không.
