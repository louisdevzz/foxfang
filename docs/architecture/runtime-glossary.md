# Runtime Glossary (FoxFang)

Glossary thống nhất thuật ngữ runtime để đọc tài liệu session/memory/agent-loop/gateway không bị lệch nghĩa.

## A

- **ACP runtime**: Runtime chuyên cho harness/session điều khiển qua control plane.
- **Active session**: Session hiện được dùng để xử lý inbound turn.
- **Agent attempt**: Một lần chạy model/tool trong một run, có thể thuộc chuỗi fallback.

## B

- **Binding**: Rule map inbound context (channel/account/peer/guild/team) sang agent/session.
- **Bootstrap context**: Tập context files và runtime metadata chèn vào prompt đầu vào.

## C

- **Compaction**: Tóm tắt/cắt bớt context history để giữ token budget.
- **Control plane**: Lớp gateway điều phối transport, methods, authz, config reload, sidecars.

## D

- **Delivery context**: Thông tin routing outbound (`lastChannel`, `lastTo`, `lastAccountId`, `lastThreadId`).
- **Dispatcher queue**: Hàng đợi followup run/reply theo queue mode của session.

## E

- **Embedded runtime**: Đường chạy agent/tool nội bộ (khác CLI backend).

## F

- **Fallback**: Cơ chế thử model/provider thay thế khi attempt hiện tại lỗi.
- **Fresh token snapshot**: Session token usage đáng tin cậy cho gating decisions.

## G

- **Gateway method**: RPC-like action callable qua WS/HTTP, map vào `server-methods`.
- **Group resolution**: Suy luận group key/scope từ inbound context.

## H

- **Heartbeat run**: Run định kỳ dùng cron/heartbeat policy, có behavior delivery riêng.
- **Hot reload**: Áp dụng config change không restart toàn gateway.

## I

- **Ingress**: Luồng vào từ network/channel/gateway client.
- **Isolated run**: Run dùng session tách biệt (thường cho cron/subagent/background task).

## L

- **Lifecycle stream**: Event stream theo pha `start/end/error/fallback`.

## M

- **Memory flush**: Agent turn chuyên để ghi state quan trọng vào memory backend.
- **Model override**: Ghi đè model/provider theo session/run, subject to policy.
- **MSS**: Marketing Superiority Score trong benchmark FoxFang vs OpenClaw.

## P

- **Preflight compaction**: Compaction chạy trước agent turn khi gần ngưỡng context.
- **Prompt estimate**: Ước lượng token của prompt mới để quyết định compaction/flush.

## Q

- **Queue mode**: Chính sách xử lý inbound khi run đang active (`drop`, `enqueue`, `run now` behavior qua resolver).

## R

- **Reset trigger**: Command trigger tạo session mới (`/new`, `/reset`, prefix forms).
- **Resolved route**: Kết quả route gồm `agentId`, `sessionKey`, `matchedBy`, policy fields.

## S

- **Session entry**: Bản ghi metadata session trong store (`sessionId`, usage, overrides, delivery fields, ...).
- **Session key**: Khóa định danh logic của cuộc hội thoại theo scope/binding.
- **Sidecar**: Runtime service chạy kèm gateway (cron, heartbeat runner, health monitor, pricing refresh...).
- **Store path**: File path tới session store hoặc memory store đã resolve theo agent/state dir.

## T

- **Thread session**: Session gắn với thread/topic context.
- **Tool result stream**: Event/payload phát ra từ tool execution trong run.

## U

- **Usage accounting**: Ghi nhận input/output/cache tokens, model/provider active, cost estimate.

## W

- **Watcher debounce**: Delay gom nhiều config file events trước khi reload logic chạy.
- **Write budget**: Rate-limit guard cho control-plane write methods.

## Cross-doc map

- Session deep dive: `/architecture/session-runtime`
- Memory deep dive: `/architecture/memory-runtime`
- Agent loop deep dive: `/architecture/agent-loop-runtime`
- Gateway deep dive: `/architecture/gateway-runtime`
