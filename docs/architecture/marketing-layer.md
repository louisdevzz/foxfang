# Marketing Layer Architecture (FoxFang)

> Status: **to-be design**, chưa có implementation first-class trong `src/` ở thời điểm hiện tại.
>
> Verified from codebase hiện tại: chưa có module/runtime entities tên `Marketing Layer`, `Campaign Planner`, `Brand Brain`, `MSS` trong `src/`.

Tài liệu này là thiết kế đích cho lớp nghiệp vụ marketing được đặt trên runtime hiện tại của FoxFang để tiến tới Personal AI Marketing Agent.

## 1) Code reality vs target

### As-is (đúng theo code hiện tại)

- Runtime hiện có tập trung vào gateway/session/agent/tools/plugins/channels.
- Chưa có bounded-context marketing riêng trong `src/`.
- Chưa có campaign lifecycle first-class ở runtime core.

### To-be (thiết kế đề xuất)

- Thêm Marketing Layer để điều phối workflow marketing end-to-end.

## 2) Vai trò của Marketing Layer

Marketing Layer là lớp orchestration nghiệp vụ nằm giữa:
- Runtime core hiện có (gateway/session/agent/tools/plugins),
- Và Marketing Data Plane (entities, analytics, scoring, experiments).

Mục tiêu của lớp này:
- chuẩn hóa quy trình từ brief đến campaign execution,
- giữ tính nhất quán brand voice/policy,
- đóng vòng lặp đo lường và cải tiến.

## 3) Core capabilities

- **Brand Brain**: brand policy, voice guardrails, do/don't messaging.
- **Campaign Planner**: biến brief thành plan đa kênh theo mục tiêu/KPI.
- **Content Factory**: tạo content variants theo channel + audience segments.
- **Distribution Orchestrator**: scheduling, send rules, retry/governance.
- **Feedback Loop**: nhận metrics, tính quality signals, trigger optimize.

## 4) Layer topology

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#F1F6FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#5A81D8','lineColor':'#6B7DA3','secondaryColor':'#EEFFF5','tertiaryColor':'#FFF7ED','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart LR
    U0["User/Operator Brief"] --> M0["Marketing Layer API"]
    M0 --> M1["Brand Brain"]
    M0 --> M2["Campaign Planner"]
    M0 --> M3["Content Factory"]
    M0 --> M4["Distribution Orchestrator"]
    M0 --> M5["Feedback Optimizer"]

    M2 --> D0["Marketing Data Plane"]
    M3 --> D0
    M4 --> D0
    M5 --> D0

    C0["FoxFang Runtime Core"] --> M0
    M0 --> C0
```

## 5) End-to-end campaign lifecycle

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#F1F6FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#5A81D8','lineColor':'#6B7DA3','secondaryColor':'#EEFFF5','tertiaryColor':'#FFF7ED','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    C1["Campaign Brief Ingest"] --> C2["Brand Policy Validation"]
    C2 --> C3["Audience + Channel Strategy"]
    C3 --> C4["Message Pillars + Offer Mapping"]
    C4 --> C5["Generate Content Variants"]
    C5 --> C6["Human/Policy Approval Gate"]
    C6 --> C7["Schedule + Distribute"]
    C7 --> C8["Collect Delivery & Engagement Metrics"]
    C8 --> C9["Evaluate KPIs + MSS Delta"]
    C9 --> C10{"Target hit?"}
    C10 -- "No" --> C11["Auto-iterate plan/content"]
    C11 --> C5
    C10 -- "Yes" --> C12["Close campaign + archive learnings"]
```

## 6) Decision engine for content-channel fit

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#F1F6FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#5A81D8','lineColor':'#6B7DA3','secondaryColor':'#EEFFF5','tertiaryColor':'#FFF7ED','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    F0["Draft content candidate"] --> F1["Brand Fit scoring"]
    F1 --> F2["Channel Fit scoring"]
    F2 --> F3["Audience Intent scoring"]
    F3 --> F4["Policy/Safety checks"]
    F4 --> F5{"Pass threshold?"}
    F5 -- "No" --> F6["Revise tone/structure/CTA"]
    F6 --> F1
    F5 -- "Yes" --> F7["Approve for distribution queue"]
```

## 7) Interfaces to existing runtime

- Session runtime cung cấp hội thoại state cho planning/approval loops.
- Agent loop runtime cung cấp tool-calling cho research/generation/review.
- Tool runtime cung cấp cả core tools và plugin tools cho marketing tasks.
- Plugin runtime mở rộng capability theo từng channel/provider.
- Channel runtime chịu trách nhiệm delivery/signal thu về từ các kênh.

## 8) Governance và guardrails

- Mọi campaign đều phải có objective, audience, KPI và owner rõ ràng.
- Brand policy là hard gate trước distribution.
- Có approval mode cho nội dung nhạy cảm hoặc high-impact channels.
- Có runbook rollback cho campaign khi quality/reputation signal xấu.
- Mọi optimization decision phải traceable qua metrics + reason.

## 9) Implementation phases (đề xuất)

- **Phase A**: Brand Brain + Campaign Planner MVP.
- **Phase B**: Content Factory + scoring gates.
- **Phase C**: Distribution Orchestrator + experiment loops.
- **Phase D**: Fully closed-loop optimizer with MSS tracking.

## 10) Acceptance criteria

- Có thể tạo campaign từ brief theo schema chuẩn, không cần prompt thủ công dài.
- Có thể generate và duyệt nhiều content variants theo từng channel.
- Có telemetry đầy đủ từ plan -> publish -> result -> optimization.
- MSS và marketing KPIs cải thiện ổn định qua nhiều campaign iterations.
