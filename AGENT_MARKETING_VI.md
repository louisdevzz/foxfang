# Agent Marketing — Hệ thống Agent Tự chủ chuyên về Marketing

**Agent Marketing** là một **hệ thống agent tự chủ (autonomous AI agent)** chuyên về marketing, chạy trực tiếp trên máy chủ hoặc thiết bị của bạn. Khác với chatbot chờ lệnh từng câu, agent này hoạt động dựa trên **mục tiêu** (goal-driven): bạn giao phó một chiến dịch, agent sẽ tự lập kế hoạch, phân rã thành các bước cụ thể, thực thi qua nhiều kênh, và báo cáo kết quả — có thể hoạt động 24/7 mà không cần giám sát liên tục.

Agent học style, giọng điệu và preferences của bạn qua hệ thống memory dài hạn, đồng thời có thể chạy tự động theo **standing orders** (quy tắc vận hành định sẵn). Các kênh messaging (WhatsApp, Telegram, Discord, Signal, Slack, LINE, Zalo...) chỉ là giao diện tương tác — nơi bạn giao việc, phê duyệt, và nhận báo cáo. Bản chất của hệ thống nằm ở **bộ não điều phối** (orchestrator) phân phối task cho các specialist agent và **kho công cụ** 30+ tool để thực thi marketing operations end-to-end.

---

## 🏗️ Kiến trúc hệ thống

```
┌─────────────────────────────────────────────┐
│           Agent Brain (Core)                │
│  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Orchestrator│  │ Specialist Agents   │  │
│  │             │  │ • Content           │  │
│  │ Goal Parse  │  │ • Strategy          │  │
│  │ Task Split  │  │ • Growth / Analysis │  │
│  │ Delegate    │  └─────────────────────┘  │
│  └─────────────┘                             │
├─────────────────────────────────────────────┤
│  Memory Store (SQLite + JSON)               │
│  Tool Registry (30+ tools)                  │
│  Session Manager (isolated workspaces)      │
├─────────────────────────────────────────────┤
│  Gateway (Runtime Control Plane)            │
│  WebSocket + HTTP server                    │
├─────────────────────────────────────────────┤
│  Channel Interfaces                         │
│  WhatsApp / Telegram / Discord / Slack ...  │
└─────────────────────────────────────────────┘
```

| Thành phần | Mô tả |
|-----------|-------|
| **Agent Brain** | Trung tâm ra quyết định: phân tích mục tiêu, lập kế hoạch, điều phối specialist agents, quản lý trạng thái chiến dịch |
| **Orchestrator** | Nhận mục tiêu marketing, phân rã thành task, gán cho đúng specialist agent, giám sát tiến độ |
| **Specialist Agents** | Content Specialist (viết nội dung), Strategy Lead (lập kế hoạch, research), Growth Analyst (metrics, tối ưu) |
| **Memory Store** | Lưu style, preferences, brand voice, lịch sử chiến dịch; học từ feedback để cải thiện theo thời gian |
| **Tool Registry** | 30+ công cụ: research, browser automation, content generation, scheduling, CRM, shell execution |
| **Gateway** | Runtime infrastructure: duy trì kết nối kênh, xác thực, routing tin nhắn, scheduling |
| **Channel Adapters** | Cầu nối đến 20+ nền tảng messaging; chỉ là giao diện, không phải lõi hệ thống |

---

## ✨ Tính năng chính về Marketing

### 1. Autonomous Campaign Execution
- Nhận mục tiêu dạng tự nhiên: *"Ra mắt sản phẩm tuần sau"*
- Tự phân rã thành timeline: research → content → scheduling → outreach → báo cáo
- Thực thi liên tục qua nhiều giờ/ngày mà không cần prompt lại
- Tự động xử lý lỗi, retry, và điều chỉnh approach khi gặp blocker

### 2. Multi-Agent Delegation
- **Orchestrator** điều phối toàn bộ chiến dịch
- **Content Specialist** viết social posts, blog, email sequences, đảm bảo brand voice qua `SOUL.md` / `IDENTITY.md`
- **Strategy Lead** research đối thủ, phân tích thị trường, đề xuất positioning
- **Growth Analyst** theo dõi metrics, đánh giá hiệu quả, đề xuất tối ưu
- Các agent delegate qua lại qua `MESSAGE_AGENT:` directive, có giới hạn độ sâu và token budget

### 3. Standing Orders (Autonomous Programs)
- Định nghĩa quyền hạn vận hành thường trực trong `AGENTS.md`
- Ví dụ: *"Mỗi thứ Sáu 4PM, compile weekly marketing brief từ data tuần và gửi team"*
- Kết hợp với cron jobs để thực thi đúng lịch
- Có approval gates: agent tự chạy nhưng escalate khi gặp anomaly hoặc vượt ngưỡng rủi ro

### 4. Long-Term Memory & Learning
- Nhớ brand voice, tone, style guide của bạn qua nhiều session
- Ghi nhận feedback từng chiến dịch để cải thiện lần sau
- SQLite FTS + JSON store cho deep recall: *"Tháng trước chúng ta chạy campaign gì cho segment này?"*

### 5. Multi-Channel Outreach (Execution Layer)
- Đẩy nội dung và nhận phản hồi qua 20+ kênh: WhatsApp, Telegram, Discord, Signal, Slack, LINE, Zalo, iMessage...
- Auto-reply routing: từng kênh/chat/user có thể bind với agent khác nhau
- Group chat với mention-based activation
- Gửi/nhận media: hình ảnh, audio, video, documents

### 6. Outreach CRM
- Quản lý contacts, leads, segments
- Multi-step sequences (drip campaigns) với trigger và delay
- Campaign tracking và engagement scoring
- Tích hợp với tool registry để scrape, enrich, và qualify leads tự động

### 7. Research & Intelligence
- Web search (Brave, Perplexity, Gemini, Grok, Firecrawl, Tavily)
- Browser automation: navigate, click, screenshot, extract data
- Social media monitoring và competitor tracking
- Trend analysis và keyword research

### 8. Automation & Scheduling
- Cron jobs cho recurring marketing tasks
- Heartbeat scheduling: agent tự kiểm tra và báo cáo định kỳ
- Webhook triggers: phản hồi sự kiện từ bên ngoài (form submit, new lead, v.v.)
- Event-driven workflows qua gateway hooks

### 9. Observability
- Request tracing với per-agent token usage, tool call stats, latency metrics
- Decision logging: agent chọn làm gì, tại sao, kết quả ra sao
- Audit trail đầy đủ cho mọi campaign execution

---

## 🛠️ Công cụ tích hợp (Built-in Tools)

| Nhóm | Công cụ | Mục đích trong Marketing |
|------|---------|-------------------------|
| **Research** | Web search, web fetch, browser automation, tweet fetching | Market research, competitor analysis, trend spotting |
| **Content** | Image generation, TTS, media understanding | Tạo creative assets, voiceovers, phân tích visual content |
| **Execution** | Shell commands, file I/O, patch application | Tự động hóa workflow, generate reports, deploy landing pages |
| **Messaging** | Cross-channel message send | Phân phối content, nurture leads, broadcast campaigns |
| **Scheduling** | Cron jobs, gateway management | Lên lịch chiến dịch, auto-pilot mode |
| **Integration** | GitHub, various APIs | Kết nối với martech stack hiện có |
| **Agents** | Sub-agents spawning, session management | Scale execution qua nhiều agent chuyên biệt |

---

## 🔒 Đặc điểm nổi bật

- **Autonomous-first** — Không cần prompt từng bước; giao mục tiêu, agent tự chạy
- **Local-first** — Dữ liệu chiến dịch, memory, session giữ trên máy bạn
- **Self-hosted** — Chạy trên phần cứng của bạn, không phụ thuộc SaaS marketing automation
- **Privacy-focused** — API keys là thứ duy nhất ra ngoài; data và memory ở local
- **Agent-native** — Built từ đầu cho agent loop: plan → tool use → verify → report → learn
- **Extensible** — Plugin system cho channels, model providers, tools, và skills
- **Open source** — MIT licensed, inspectable, hackable

---

## 💡 Ai nên dùng?

- **Solo marketers** muốn một teammate AI thực thi campaign end-to-end mà không cần thuê thêm người
- **Growth hackers** cần tự động hóa research, content, và outreach qua nhiều kênh
- **Founders** muốn chạy marketing lean với agent tự chủ xử lý repetitive tasks
- **Marketing teams** cần scale execution mà vẫn giữ control hoàn toàn data và brand voice
- **Anyone** muốn một AI marketing partner học hỏi và cải thiện theo thời gian — không phải một chatbot quên mọi thứ sau mỗi session
