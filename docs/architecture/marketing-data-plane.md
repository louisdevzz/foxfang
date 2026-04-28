# Marketing Data Plane Architecture (FoxFang)

> Status: **to-be design**, chưa có implementation data plane marketing first-class trong `src/` ở thời điểm hiện tại.
>
> Verified from codebase hiện tại: chưa có entity/runtime modules tên `Campaign`, `BrandProfile`, `ContentAsset`, `DistributionRun`, `PerformanceSnapshot`, `MSS` trong `src/`.

Tài liệu này là thiết kế đích cho lớp dữ liệu marketing: entities, event streams, metrics computation, và vòng lặp học từ dữ liệu.

## 1) Code reality vs target

### As-is (đúng theo code hiện tại)

- Có data/state runtime cho session, transcript, config, plugin/channel status.
- Chưa có data plane chuyên biệt cho campaign marketing lifecycle.
- Chưa có scoring pipeline marketing first-class (MSS/KPI engine) trong runtime core.

### To-be (thiết kế đề xuất)

- Thêm Marketing Data Plane để lưu campaign entities, event log và scoring outputs.

## 2) Vai trò của Marketing Data Plane

Marketing Data Plane là nền dữ liệu vận hành cho Marketing Layer:
- lưu entities marketing chuẩn hóa,
- thu nhận events delivery/engagement/conversion,
- tính score và metrics phục vụ quyết định tự động.

## 3) Entity model (minimum viable)

- **BrandProfile**: voice, positioning, prohibited claims, style constraints.
- **Campaign**: objective, audience, channels, schedule, lifecycle status.
- **ContentAsset**: message variants, media references, CTA metadata.
- **DistributionRun**: publish attempts theo channel/account/time window.
- **AudienceSegment**: targeting rules + metadata.
- **PerformanceSnapshot**: KPI aggregates theo campaign/channel/variant.
- **Experiment**: A/B hoặc multivariate configs + hypothesis.

## 4) Data plane topology

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#F5F8FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#587ED4','lineColor':'#6B7DA3','secondaryColor':'#EEFFF5','tertiaryColor':'#FFF8ED','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart LR
    S0["Marketing Layer"] --> D0["Command/API Ingest"]
    D0 --> D1["Entity Store"]
    D0 --> D2["Event Log"]
    D2 --> D3["Metrics & Scoring Engine"]
    D3 --> D4["Decision Features Store"]
    D4 --> S0
    D1 --> D3
    E0["Channel/Tool Signals"] --> D2
```

## 5) Event lifecycle

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#F5F8FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#587ED4','lineColor':'#6B7DA3','secondaryColor':'#EEFFF5','tertiaryColor':'#FFF8ED','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    E1["Event produced (send/open/click/reply/convert)"] --> E2["Normalize schema + identity keys"]
    E2 --> E3["Deduplicate/idempotency check"]
    E3 --> E4{"Valid?"}
    E4 -- "No" --> E5["Dead-letter + audit"]
    E4 -- "Yes" --> E6["Append immutable event log"]
    E6 --> E7["Update real-time aggregates"]
    E7 --> E8["Recompute campaign/channel/variant scores"]
    E8 --> E9["Emit optimization signal to Marketing Layer"]
```

## 6) KPI and scoring pipeline

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#F5F8FF','primaryTextColor':'#0B1F3A','primaryBorderColor':'#587ED4','lineColor':'#6B7DA3','secondaryColor':'#EEFFF5','tertiaryColor':'#FFF8ED','fontFamily':'Inter, system-ui, sans-serif'}}}%%
flowchart TD
    K0["Raw events + campaign metadata"] --> K1["Compute funnel metrics"]
    K1 --> K2["Compute quality dimensions"]
    K2 --> K3["Compute MSS and deltas vs baseline"]
    K3 --> K4["Store snapshots by time window"]
    K4 --> K5["Serve dashboards + optimization decisions"]
```

## 7) Data contracts (recommended)

- Event envelope chuẩn: `eventId`, `occurredAt`, `source`, `campaignId`, `channelId`, `accountId`, `variantId`, `payload`.
- Idempotency key chuẩn cho delivery/conversion events.
- Snapshot windows: hourly, daily, campaign-lifecycle cumulative.
- Version hóa schema để tránh break historical analytics.

## 8) Integration with FoxFang runtime

- Gateway runtime: ingress APIs + control-plane operations.
- Channel runtime: nguồn delivery/health/retry events.
- Tool runtime: research/content generation/tool-result events.
- Session + agent loop: context logs và decision traces.
- Plugin runtime: nguồn events từ extension channels/providers.

## 9) Reliability guardrails

- Event log append-only để audit và replay.
- Dedupe/idempotency bắt buộc cho upstream retries.
- Backfill/recompute pipeline cho trường hợp schema update.
- Dead-letter queue cho events lỗi parse/validation.
- Data retention policy theo loại dữ liệu (raw, aggregate, debug).

## 10) Security and privacy

- Phân tách dữ liệu theo workspace/tenant/agent scope.
- Masking/redaction cho fields nhạy cảm trước analytics export.
- Access policy rõ cho read raw events vs read aggregates.
- Audit trail cho mọi write vào campaign và scoring tables.

## 11) Delivery roadmap (practical)

- **Step 1**: Ship entity schemas + event envelope spec.
- **Step 2**: Build ingest + append-only event log + snapshots MVP.
- **Step 3**: Add KPI/MSS compute service and dashboards.
- **Step 4**: Turn on optimization signals feeding Marketing Layer.

## 12) Done criteria

- Campaign lifecycle dữ liệu có thể query end-to-end.
- Metrics theo campaign/channel/variant cập nhật ổn định.
- Có thể replay events để recompute score khi đổi rubric.
- Optimization loop dùng data-plane outputs thay vì heuristic thuần prompt.
