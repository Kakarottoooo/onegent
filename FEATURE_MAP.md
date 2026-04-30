# Onegent · 重要功能 + 按钮速查表

> 给用户的"这个按钮干什么"参考手册。出现行为不符时，比对这份文档判断是 bug 还是预期。
> 上次更新：2026-04-30

---

## 1. 首页 `/` —— 主对话入口

### 1.1 大输入框
- **打字 / 语音**：发对话给 Claude，触发 `/api/chat/parse` → NLU v2 抽 intent state → `/api/chat/commit` 落库
- **Enter / 圆形发送按钮（金色渐变）**：提交消息
- **🎤 麦克风**：浏览器原生 SpeechRecognition；点一下进入"听"状态（gradient 边框），再点一下停
- **@ 符号 / @-mention picker**：从联系人选人，自动加 pill 进 input
  - 选了人 = "和这个人一起决定" → 创建 Decision Room
  - 在文字里写名字（"和 ziweiC 找..."）= 走联系人模糊匹配 4 层链
  - 模糊匹配不出唯一结果 → 阻塞，把候选人列成 quick_picks 让你点

### 1.2 对话流里的卡片
- **ConfirmCard**（"准备好开始了吗"）：底部金色 `Start booking` / `Plan with someone`
  - 单人场景：直接进 booking_jobs → 跳 `/tasks`
  - 多人场景：创建 Decision Room → 留在首页，URL 带 `?room_id=`
  - `Edit details` 灰按钮：返回对话改约束
- **RecommendationCard / HotelCard / FlightCard / ActivityCard**：
  - 卡上 `Book` / `Reserve` / `Map` 金色 CTA：走该平台预订
  - ❤️ 收藏：写 `recommendations_favorites` 表
  - "Why" / "Watchout" tabs：展开 LLM 给的理由 / 风险

### 1.3 Sidebar
- **+ New chat**：清空 ref + URL，开新 session
- **Drafts 区**：还在聊的 session（无 upgraded_plan / upgraded_trip）
- **Completed 区**：已经创建 plan 或 trip 的 session（带 ✓ + scenario emoji）
- **点 session 行**：URL replace `?session_id=`，回放历史 + NLU state hydrate
- **Rooms 区**：Decision Room 单独列出（room-upgraded session 不重复在 Drafts/Completed）

### 1.4 顶部 GlobalNav
| 链接 | 进哪 | 干什么 |
|---|---|---|
| Tasks | `/tasks` | 看所有 booking_jobs 状态 + 重试 + 手动 handoff |
| Calendar | `/calendar` | 时间轴看预订 / Google Calendar 同步 |
| Rooms | `/rooms` | 所有 Decision Room 列表 |
| Contacts | `/contacts` | 联系人 + 双向 add/remove |
| Memory | `/memory` | 个人 + 关系记忆查看 |
| Pricing | `/pricing` | Free / Pro 套餐 + Stripe Checkout |

---

## 2. Tasks `/tasks` —— booking job 控制台

### 2.1 单条 task 卡
- **Status pill**：`Waiting` / `Running` / `Done` / `Failed` / `Needs verification` / `Fare changed or disappeared`
- **`Open live view`**（出现 CAPTCHA / 登录拦截时）：跳 Browserbase live-view URL，人工解锁
- **`Tap to complete manually`** + 平台链接：自动失败时给手动 handoff URL
- **`Confirm payment`**（`paused_payment` 状态）：跳到内置支付确认页输 CVV
- **`Retry`**：重置 step 到 pending，worker 自然 claim
- **`Replan`**：让 LLM 重新规划该 step 的 fallback 链
- **`Diagnose`**：展开 decision log + LLM 解释失败原因 + 给 chat prompt

### 2.2 顶部 filter
- 按 status / scenario / date 过滤，纯前端

---

## 3. Decision Room `/?room_id=<id>` —— 多人决策

### 3.1 阶段图
```
Waiting (你说约束)
    ↓ 全员 contributed
Synthesis（agent 跑 server-side 搜索，4 类场景统一）
    ↓ 落 proposal
Voting（每张卡显示 vote count）
    ↓ 多数 → finalize
Decided（顶部 consensus banner + Reserve now 给 payer）
```

### 3.2 主要按钮
- **下方对话框**：你的约束（"我吃辣"、"$100 以下"、"7点"）→ 抽进 IntentState → 推 `room_member_intent_state` 表
- **"Submit constraints" 按钮**（已废弃路径），现在是聊出来的
- **Scenario chip set**（餐厅 / 酒店 / 机票 / 活动）：早期歧义时让你点
- **Vote button（每张候选卡）**：投票 → 写 room_proposal_votes，达多数自动 finalize
- **Reserve now**（Decided 屏，仅 payer 可见）：跳 booking_jobs 流程，其他成员看到 "Waiting for X to confirm"
- **Leave room** / **Dismiss room**（owner only）：删 room → 其他成员 4s 内被 router.replace("/") 踢回首页 + toast

### 3.3 成员区
- Avatar 实线金边 = submitted constraints
- Avatar 虚线灰边 = 还没 contribute

---

## 4. Profile `/u/<handle>` —— 公开主页

### 4.1 区域
- **Header**：头像 + display_name + tagline + handle
- **Trips（主区）**：kind=trip 的 SharedArtifact，列表卡，点进 `/s/<slug>`
- **Recent shares（次区）**：kind=booking + dr_outcome 的，eyebrow 副标题 "RECENT SHARES"
- **CTA "Plan your own trip on Onegent →"**：拉访客回首页

### 4.2 ShareTripModal（生成可分享链接的弹窗）
- **Public / Private toggle**：写 shared_artifacts.visibility
- **`Copy link` 按钮**：复制 absolute URL（已修过 host）
- **`iMessage / SMS` 按钮**：移动平台才显示，桌面 Apple = iMessage，桌面非 Apple 隐藏
- **WhatsApp / X 按钮**：浏览器新窗口打开
- **`Add to itinerary`**（trip kind 时）：把这个 booking/dr_outcome 挂进某个 trip itinerary，写快照三列（title/subtitle/emoji）保证子项被删后仍显示原标题

---

## 5. Decide `/decide/<sessionId>` —— 餐厅 DR 老路径

### 5.1 状态屏
- **Waiting for your group**：还没全员 submit constraints；底部"X of N submitted"
- **Decided**：winning card + Reserve CTA

### 5.2 按钮
- **`Back to home`**：返回 `/`（仍在 group 等待时不丢约束，session 留着）
- **Avatar 区**：点头像看成员状态

---

## 6. Account `/account` —— 个人设置

| Tab | 功能 |
|---|---|
| Profile | 改 display_name / username / tagline / avatar |
| Identity | 验证 / Persona / 这是公开 profile 入口 |
| Billing | Free → Upgrade / Pro → Manage subscription（跳 Stripe Portal）/ Cancel 状态 |
| Memory | 个人 + 关系记忆 |
| Preferences | 默认航司 / 酒店 / 餐厅风格 |

---

## 7. Pricing `/pricing` —— 付费

- **Free 卡**：3 bookings/月 + 1 DR/月（跨 surface 共享）
- **Pro 卡**：$9/月 或 $79/年（年付省 27%）
- **Upgrade 按钮**：POST `/api/billing/checkout` → 跳 Stripe Checkout → 回跳 `/account?tab=billing`
- 超限自动返 HTTP 402 + upgrade_url（agent 端会把这个 message 转给用户）

---

## 8. Booking 自动化关键设计（背后行为）

### 8.1 三层执行架构（每个 provider 必须遵守）
- **Layer 1 - 程序化导航**：已知按钮序列、弹窗 dismiss、页面等待 — 不消耗 AI 额度
- **Layer 2 - AI 表单填充**：name / email / phone / 地址 / 旅行证件 — 仅在需要"理解字段"时
- **Layer 3 - AI 验证**：每次填表后必跑 auditAndRefillEmptyFields 扫漏

### 8.2 支付安全
- **永远止步 CVV**：所有 provider 程序化填卡号 / 持卡人 / 过期，但 CVV 必须用户手动输
- 状态变 `paused_payment` 后 task 卡显示 "Confirm payment" 按钮跳支付页

### 8.3 餐厅 fallback 链（当前）
```
OpenTable → Resy → Google Places (找官网) → website handoff
```
（Yelp 之前试过当 primary，反检测过不了，rollback 到 fallback 池）

### 8.4 酒店 fallback 链
```
Booking.com → Expedia → Hotels.com (复用 Expedia)
```

### 8.5 机票（Expedia 唯一 provider，三层级联匹配）
- Tier 1 同航司 + 完全匹配（航班号 / 价格 / 时刻一致）
- Tier 2 同航司 fallback（容差 ±2h / ±$60）
- Tier 3 跨航司 fallback（容差 ±3h / ±$100）
- 漂移失败时 task 显示 "Fare changed or disappeared"

### 8.6 CAPTCHA / 验证
- 检测两路：英文关键字 OR AI assessment.stage === "blocked"
- 命中 → status=error + label "Needs verification — open live view"
- Browserbase live-view URL 让用户人工过验证后 retry

---

## 9. MCP / OAuth 集成（开发者面）

- **`/api/mcp`**：Streamable HTTP MCP endpoint，双轨 auth
  - `Authorization: Bearer ogk_live_*` （手动 API key）
  - `Authorization: Bearer <opaque OAuth>` （走 OAuth bridge key）
- **`/oauth/authorize`**：consent 页（Clerk gated）
- **`/oauth/token`**：发 access + refresh token
- **`/oauth/register`**：RFC 7591 DCR（claude.ai / ChatGPT 自动注册）
- **6 工具**：book_{restaurant,hotel,flight,activity} + get_job_{status,audit}
- **`/developers/connected-apps`**：用户看自己授权过的 OAuth client + 一键 revoke

---

## 10. 通知

| Kind | 触发 | 行为 |
|---|---|---|
| `dr_invite` | 被邀进 DR | dedupe key `dr_invite:<roomId>:<userId>` |
| `dr_decided` | DR finalize | 通知所有非操作者 |
| `booking_done` / `booking_failed` / `booking_needs_login` | booking_jobs 状态变 | (现有) |
| `room_dismissed`（toast）| 被踢回 / | 不进通知中心，只 toast 一次 |

---

## 11. 当前已知的"故意行为"（不要当 bug 修）

- **`/account` 的 Identity tab 才是公开 profile 入口** — 因为 profile 还是身份验证为主，feed 上线后会迁到顶 nav
- **DR 里 single-member 不触发 synthesis** — 故意守护，避免一个人独自看到 4 张卡
- **Yelp provider 文件还在但不在 chain** — 留备用，等 Browserbase Pro 后可能再启用
- **`session_id` URL 用 replace 不是 push** — 不污染浏览器返回栈
- **`.claude/settings.local.json` 在 git 状态总显示 modified** — 历史遗留，gitignored 但 tracked，commit 时跳过
- **lib/booking-autopilot 和 worker/src/booking-autopilot 双份代码** — 故意 fork，删除条件未到（详见 CLAUDE.md）

---

## 12. 测试遇 bug 时的快速分诊

| 现象 | 第一反应 |
|---|---|
| 主页跳转白屏 | loading.tsx 缺骨架屏（已有 7 个，少的话补） |
| DR 两人看到不同推荐 | proposal 没落库 → 查 room_proposals 表 |
| 联系人匹配不到 | 看 dev.log "auto-resolved N member name(s) → M contact(s)" |
| Booking job 卡 running | tail dev.log + worker Railway logs |
| Stripe 显示 free 但实际 pro | webhook 没收到 → Stripe Dashboard resend |
| OAuth 报 bridge_key_failed | 缺 OAUTH_BRIDGE_HMAC_SECRET env |
| CAPTCHA 不到 live-view | InlineJobCard 没识别 captcha 关键字，去 status mapping 加词 |

---

> 这份文档随产品演进更新。你测试时遇到行为存疑，比对这里 → 不一致 = bug，一致 = 预期。
