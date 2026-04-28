# Runtime Dependency Map (FoxFang)

Tài liệu này là bản đồ phụ thuộc runtime tổng hợp để onboarding nhanh: nhìn một chỗ là thấy luồng điều phối chính và ranh giới module.

## 1) Layer map (high-level)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#E8F0FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#4B74C9','lineColor':'#6B7DA3','secondaryColor':'#E9FFF4','tertiaryColor':'#FFF4E6','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TB
    L0["Transports: HTTP / WS / Channel Accounts"]
    L1["Gateway Control Plane"]
    L2["Routing + Session Resolution"]
    L3["Agent Loop Runtime"]
    L4["Tools Runtime (Core + Plugin)"]
    L5["Plugin Runtime + Registry"]
    L6["Memory Runtime"]
    L7["Persistence + Config + State"]
    L8["Sidecars (Cron/Heartbeat/Health Monitor)"]

    L0 --> L1
    L1 --> L2
    L2 --> L3
    L3 --> L4
    L4 --> L5
    L3 --> L6
    L1 --> L8
    L1 --> L7
    L2 --> L7
    L3 --> L7
    L6 --> L7
    L5 --> L7
```

## 2) Unified dependency graph (runtime-level)

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#F6F8FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#5B7FCF','lineColor':'#6B7DA3','secondaryColor':'#EEFFF6','tertiaryColor':'#FFF6EC','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart LR
    U0["Inbound Sources<br/>HTTP, WS, Channel Events"] --> U1["Gateway Runtime"]
    U1 --> U2["Method Dispatch<br/>Authz + Scopes + Rate Limits"]
    U1 --> U3["Channel Manager"]
    U1 --> U4["Config Reload + Runtime State"]
    U1 --> U5["Gateway Sidecars"]

    U3 --> U6["Channel Plugins"]
    U6 --> U7["Route Resolver"]
    U2 --> U7
    U7 --> U8["Session Resolver/Store"]
    U8 --> U9["Agent Runner"]

    U9 --> U10["Model Fallback Loop"]
    U10 --> U11["Core Tools"]
    U10 --> U12["Plugin Tools"]
    U12 --> U13["Plugin Registry + Runtime Facade"]
    U13 --> U2

    U9 --> U14["Memory Pipeline"]
    U14 --> U15["Memory Store/Search"]
    U14 --> U8

    U9 --> U16["Outbound Delivery"]
    U16 --> U6
    U16 --> U0

    U4 --> U13
    U4 --> U3
    U5 --> U9
    U5 --> U3

    U17["Config + Paths"] --> U1
    U17 --> U8
    U17 --> U13
    U18["Transcripts + Usage + Artifacts"] --> U8
    U18 --> U9
    U18 --> U14
```

## 3) Dependency rules of thumb

- Gateway là entrypoint điều phối; không nên embed business logic nặng của tools/channels trực tiếp vào transport layer.
- Routing/session là seam ổn định giữa ingress và agent loop; giữ key semantics nhất quán để tránh session drift.
- Agent loop phụ thuộc tools + memory theo runtime contracts, không phụ thuộc implementation chi tiết của từng plugin.
- Plugin runtime có thể gọi ngược gateway methods qua scoped bridge, nhưng phải qua auth/policy gates.
- Sidecars (cron/heartbeat/health monitor) là producer/observer runtime events, không phá lifecycle chính.

## 4) Critical coupling points cần cẩn thận khi refactor

- `Gateway ↔ Plugin runtime`: subagent binding, fallback context, policy model override.
- `Channel manager ↔ Route resolver`: account/channel identifiers phải normalize đồng nhất.
- `Agent runner ↔ Tool callbacks`: streaming/event hooks dễ gây duplicate hoặc out-of-order nếu thay đổi sai.
- `Session runtime ↔ Memory flush`: compaction/flush gating phải dùng cùng signal counters.
- `Config reload ↔ Channel/plugin runtime`: hot reload vs restart decision ảnh hưởng tính ổn định runtime.

## 5) Suggested reading order cho người mới

1. `/architecture/gateway-runtime`
2. `/architecture/channel-runtime`
3. `/architecture/session-runtime`
4. `/architecture/agent-loop-runtime`
5. `/architecture/tool-runtime`
6. `/architecture/plugin-runtime`
7. `/architecture/memory-runtime`
8. `/architecture/runtime-glossary`
