================================================================
Onegent · Travel Execution Layer for AI Agents · v0.2.63.0
================================================================

【一句话定位（2026-04-26 锁定）】
**Onegent is the travel execution layer for AI agents and groups.**
**Onegent 是给 AI agent 和多人用户使用的旅行预订执行层。**

不是 "AI 帮你做任何事"（horizontal 跑腿被 OpenAI Computer Use /
Browserbase 吃）。
不是 "AI 帮你规划行程"（Booking AI Trip Planner 已经在做）。
而是 **agent 真正把行程订下来 — 跨 OTA fallback、payment safety、
multi-person Decision Room** 的执行能力本身。

Wedge：travel vertical（餐厅 / 酒店 / 机票 / 活动 / 多人 trip）
Backend：Agent Execution Layer（同一引擎服务 C 端 + Claude Desktop +
ChatGPT Apps + 第三方 agent builder via /api/v1）
明确不做：horizontal AI doer

产品地址：https://onegent.one/

================================================================
Current State Snapshot · 2026-04-30
================================================================

【架构现状】
- C 端：Vercel-hosted Next.js (onegent.one)，Neon Postgres，Clerk auth
- Worker：Railway long-process container 跑 booking-autopilot（restaurant
  scenario via USE_WORKER_FOR），其它 scenario 仍在 Vercel in-process
- MCP：双轨发行
  · npm @onegent/mcp-server v0.1.0（stdio for Claude Desktop）
  · /api/mcp（Streamable HTTP for Claude.ai web / ChatGPT Apps / 第三方）
- OAuth IdP：完整 RFC 6749 + 7591 (DCR) + 7636 (PKCE) + 9728 跑通
  · /api/mcp 双轨 auth：ogk_live_* API key 旧路径 + OAuth Bearer →
    HMAC bridge key → 复用同一条 require-api-key 链
- Pricing：Stripe sandbox 全跑通，prod 验证 PRO 链路 OK
  · Free: 3 bookings + 1 DR / 月，跨 surface 共享配额
  · Pro: $9/月 或 $79/年（年付省 27%）
- 双份代码（lib/booking-autopilot ≡ worker/src/booking-autopilot）：
  byte-identical，DELETE_WHEN trigger 未到（详见 CLAUDE.md）

【已上线产品面（按时间倒序）】
1. Social Feed 路线图（plan.md 已写，未实施）— 2026-04-30
2. DR 多人投票闭环（Phase 1-4 全部 ship）— 2026-04-29
3. 自然语言联系人模糊匹配（4-tier matcher）— 2026-04-29
4. Pricing v0.1（Stripe sandbox + /pricing + Billing tab）— 2026-04-27
5. ChatGPT Apps 已提交审核（5-10 工作日异步）— 2026-04-27
6. OAuth 2.0 IdP + claude.ai web 真实跑通 — 2026-04-27
7. @onegent/mcp-server@0.1.0 npm published — 2026-04-26
8. /api/mcp Streamable HTTP endpoint 上线 — 2026-04-26
9. Worker → Railway 迁移（restaurant scenario）— 2026-04-26
10. 主页 chat Claude.ai 风格重构 + NLU state 持久化 — 2026-04-26

【当前阻塞 / 等外部触发的事项（统一在此，下面 release notes 不重复）】
- ChatGPT Apps marketplace review 结果（OpenAI 5-10 工作日，被动等）
- Browserbase Pro $99/mo 升级（等付费用户敲门触发）
- Worker 双份代码 cleanup（等 hotel/flight/activity 切到 worker）
- B2B Lane C cold outreach（4 客户类型 × 5 contacts 还没启动）
- Cofounder / 早期合伙人搜索

【Pending backlog（不阻塞，待动手）】
- Social Feed MVP 实施（trip-anchored posts + 单向 follow + /feed 入口）
- 公开发布（HN + X + PH + Reddit launch post）
- @onegent/mcp-server 加 tool annotations 后 npm 重发（~5min）
- Live Stripe key 切换（等真有付费意愿用户）

【Browserbase Infra 演进路线图（2026-04-30 决定）】
关键决策：现在不升 Browserbase Pro，按用户增长曲线分阶段决定 infra
策略。10000 用户规模时 Browserbase ≈ $6000/月，毛利率会被压到 33%；
长期必须有自建 farm 路径。但**不做 premature optimization**，先验证
PMF。

| 阶段   | 用户数   | 方案                             | 理由                                |
|--------|----------|----------------------------------|-------------------------------------|
| 现在   | 0-100    | Free Browserbase + 本地 chromium | 不烧钱，验证 PMF                    |
| 早期   | 100-500  | $99 Pro + 本地 chromium 混合     | 12+ 付费用户回本，hotel/flight 解锁 |
| 成长期 | 500-2000 | $99 Pro + Browserbase 超额       | 毛利薄但增长优先                    |
| 规模化 | 2000+    | 启动路 B 自建 browser farm       | 毛利从 33% → 95%，工程投入回报清晰  |
| 企业级 | 10000+   | 路 B + Browserbase 灾备双跑      | 抗单点故障                          |

路 B 自建 farm 完整 roadmap 已落地至
[BROWSER_FARM_PLAN.md](./BROWSER_FARM_PLAN.md)，包含：
- 4 个 Phase（Spec / 写代码 / 买基础设施 / 上线）
- 服务器选型（推荐 Hetzner CCX23 起步 $18/月，Ashburn VA）
- Residential proxy 选型（SmartProxy / Bright Data / Oxylabs / IPRoyal）
- CAPTCHA solver（2Captcha / Anti-Captcha / CapSolver）
- 三阶段成本表（500 / 2000 / 10000 用户对应 $103 / $510 / $1540 月成本）
- 风险清单（技术 / 运维 / 商业 / 法律灰色地带）
- 替代策略（先做缓存 / API 替换 / session 复用，能砍 50-65% 用量）
- 启动 checklist（满足条件那天打开就能开工）

触发自建 farm 的硬信号（满足任意 2 条就开始 spec）：
1. 有 ≥ 500 个付费 Pro 用户
2. Browserbase 月账单 ≥ $1500
3. 有 cofounder / engineer 可以分担运维
4. 拿到种子轮，有真实预算

哲学锚点：
- DHH "Buy when you can, build when you must" — 早期付钱给 Browserbase
  是对的
- patio11 "Stop being scared about scale" — 0 付费用户时担心 10k 用户
  的 vendor lock-in 是 luxury problem
- Linus "Premature optimization is the root of all evil" — 6 周自建
  在没验证 PMF 前是负 ROI

详细历史 release notes：本文档时间倒序，最近 ~5 天保留全文；
2026-04-25 (cont.13) 及更早（Stage 2 / Week 2-6 / lib/core 抽象 /
B 端基础设施 / Phase 0 UI / Positioning Shift 等）已归档至
[PROJECT_SUMMARY_ARCHIVE_2026Q1.md](./PROJECT_SUMMARY_ARCHIVE_2026Q1.md)。

按钮 / 功能行为速查见 [FEATURE_MAP.md](./FEATURE_MAP.md)。

================================================================
Recent Updates - 2026-04-30 · DR Phase 4 闭环 + 联系人模糊匹配 + Profile portfolio + Expedia drift handling + Social Feed plan
================================================================

跨两天（2026-04-29 晚 ~ 2026-04-30 凌晨）一次性 push 了 30+ commits，从
"DR 多人投票流" 一直推到 "公开 Profile 二段结构 + Social Feed 路线图"。
重点是把 P3-P8 smoke 测试的所有阻塞 bug 全修了，用户 manual 跑下来基本
都过了，剩下问题以后回归再修。Pricing/OAuth/Worker 三大 distribution 已
经全部上线（cont.1-4 写过），这一轮属于"打磨 + 闭环 + 长期增长画布"。

【今天（2026-04-30）4 个新 commit】

1. ebe2683 — feat(booking): handle Expedia flight inventory drift gracefully
   - 新 lib/booking-errors.ts 提供 isFlightInventoryDriftError() +
     buildFlightInventoryDriftMessage/ManualMessage()
   - Expedia provider Select-button 匹配从单层 strict 改成 3 层级联：
     · Tier 1: 同航司 + 完全匹配（航班号 / 价格 / 时刻一致）
     · Tier 2: 同航司 fallback（容差 ±2 小时 / ±$60）
     · Tier 3: 跨航司 fallback（容差 ±3 小时 / ±$100）
     避免 Expedia 在 search → checkout 之间价格/时刻轻微漂移就直接 bail
   - app/api/booking-jobs/[id]/start/route.ts 在 runUniversalStep 失败
     分支识别 drift error，写入针对性 actionItem.message："We found a
     flight earlier, but Expedia no longer shows that exact fare."
   - app/tasks/page.tsx stepStatusLabel 加 "Fare changed or disappeared"
     状态 + diagnoseFail 加 drift 专用 reason/suggestion/chatPrompt
   - 用户体感：之前 drift 直接显示 "Failed"，现在诚实告诉用户原因 +
     给出"refresh / 手动选最近选项"两条出路

2. c32e763 — feat(rooms): notification system for DR invites and reached-decision events
   - 新 lib/room-notifications.ts 集中两个事件：
     · notifyDecisionRoomInvite({ room, recipientUserId, creatorLabel,
       totalMembers, requiresAccept }) — dr_invite kind，3+人加群组后缀
       "(N-person group)"，dedupeKey=`dr_invite:${roomId}:${userId}`
     · notifyDecisionRoomReachedDecision({ room, recipientUserIds,
       totalMembers, winnerLabel, proposalId }) — dr_decided kind，
       dedupeKey=`dr_decided:${roomId}:${proposalId}:${userId}`
   - 4 个调用点接通：
     · app/api/chat/commit/route.ts（kind=room 的两个分支，自然语言邀
       请走的路径，requiresAccept=true → linkUrl=joinRoomLink）
     · app/api/rooms/[id]/members/route.ts（直接 add member 路径，
       requiresAccept=false → linkUrl=openRoomLink）
     · app/api/rooms/[id]/proposals/[pid]/finalize/route.ts（创建者
       finalize 时通知非创建者）
     · app/api/rooms/[id]/proposals/[pid]/vote/route.ts（投票自动
       finalize 时通知所有非当前用户）
   - 全部 catch 成 non-fatal，不阻塞主流程
   - 解锁 P7 通知系统验收

3. ab72385 — feat(profile): split trips vs other shares + persist itinerary item snapshots
   - 公开 Profile `/u/<handle>` 改成 portfolio 结构：
     · listPublicArtifactsByOwner 加可选 kinds[] 过滤参数
     · 主区域改成 "Trips"（kind=trip）独占
     · 二段加 "Recent shares"（kind=booking + dr_outcome），副标题灰
       色 eyebrow 区分主次
     · OG 卡片 tripCount 只数 trip kind（不再混算 booking）
     · 空状态文案对自己 vs 访客分别处理，hasOtherShares 时不慌
   - itinerary_items 加 3 个 snapshot 列：snapshot_title / subtitle /
     emoji，TEXT。addItineraryItem() 时 buildItineraryItemSnapshot()
     从源 booking_job / decision_session 拍快照写入。
   - app/s/[slug]/page.tsx + app/api/itineraries/[id]/route.ts 渲染
     itinerary 子项时优先 it.snapshot_title，找不到子记录时不再显示
     "Removed"，而是显示当时的真实标题。
   - components/ShareTripModal.tsx 加 detectNativeMessageShareKind()
     探测 platform：Apple → "iMessage"，移动 Android → "SMS"，桌面
     非 Apple → 隐藏按钮（避免误导）。Channel 字段 imessage → message
     统一处理。
   - app/decide/[sessionId]/page.tsx 微调："Waiting on the group" →
     "Waiting for your group"；submitted 个数副本简化；pending avatar
     改为虚线边框（视觉上更"未到"）

4. 6398303 — docs: social feed MVP plan + ignore dev.log~ and ralph last-branch
   - 新 plan.md 把跟用户对齐的 8 条核心决策落定：
     · Post 形态 = trip-anchored（必须挂 trip / booking）
     · 关注模型 = 单向 follow（独立于 contacts，新增 follows 表）
     · Profile 入口默认进 /feed（Following feed），不是自己主页
     · 默认 visibility = public，单 post 可改 contacts-only
     · MVP 不做 video / repost / bookmark / hashtag / discover
     · Like + Comment（一级，无嵌套）+ @-mention 复用 picker
     · Vercel Blob 存图（无新依赖）/ 无 websocket
     · 5 张新表：posts / post_images / post_likes / post_comments /
       follows + 完整 API routes / UI 页面 / 12 个组件 / 5 类通知 /
       21 步 Phase 拆分 / 11 条 DoD / Out of Scope 明示
   - .gitignore 加 dev.log~ + scripts/ralph/.last-branch（本地临时
     状态文件，不该入库）
   - 实施时机：等 P3-P8 smoke 全跑完再开工

【昨天（2026-04-29）一并归档的核心 ship — DR 多人投票闭环 + 联系人增强】

之前这些 commit 散落但都属于"DR 真正可用"的关键链路：

· 9692af6 / fb6f2b1 / 7dbcc4a / d4e5f95 — DR Phase 1-3
  Phase 1（服务端搜索 + 落 proposal）：把 DR 里 4 类场景的 LLM
  search 结果落到 room_proposals 表，从原来的 client-side /api/chat
  改成 server-side 一次跑，所有成员看到同一份候选。
  Phase 2（客户端读 proposal + replay）：成员加入 DR 直接渲染共享
  proposal cards，不再各跑各的搜索（消除"两人看到不同推荐"的根因）。
  Phase 3（投票 wrapper + 多数派）：每张卡 vote button，达到多数
  立刻自动 finalize，写 winner 到 decided_card_id。

· 31c8a01 — DR Phase 4 闭环
  Decided 屏顶部 consensus banner（"You all picked Carbone"），唯一
  CTA 是 "Reserve now" 仅对 payer 可见（避免两人都点开浪费 quota）。
  其他成员看到 "Waiting for [payer name] to confirm" 静态文案。

· e41f75b — DR 投票按钮对比度 + 隐藏 solo CTA
  scenario proposal cards 在 DR 内不该显示 solo "Book this" CTA
  （DR 只走投票路径），且 vote button 在 dark mode 对比度修。

· c551db0 / ebc21e8 — DR 早期保护：≥2 joined 才允许 synth + 双方
  都看 spinner + scenario-aware chip set

· 0bf894b — fix(rooms): kick non-creator members back to / when creator deletes
  DR 房间被 owner 删除后，其他成员前端的 4-second poll 看到 404/403
  → router.replace("/") + toast "Room dismissed"。之前会卡在僵尸 URL。

· 5d5bbbc / 42e257d / 5e86a65 — 联系人 4-tier 模糊匹配链路
  自然语言 "和 ziweiC 找..." 自动解析联系人：
  · 新 lib/contacts-match.ts 公共匹配器（exact → username substring →
    name prefix → name substring，≥3 char 阈值）
  · pickPreferredContactLabel 优先级：nickname → 真实 display_name →
    username → email-fallback display_name → profile_code（解决之前
    显示 "guoziwei2019@126.com" 的问题）
  · /api/chat/parse 后置 resolver pass：全 resolve → 自动 invite +
    party_type=multi；任何 miss → block ask_clarification
  · ConfirmCard 客户端复用同一匹配器（消除两边逻辑不一致）

· 78c21cd — fix(booking): CAPTCHA misreported as "Ready for payment"
  之前两套检测器 desync：assessment.blocked 只匹英文关键字，中文
  CAPTCHA 只 trip 到 assessment.stage === "blocked"。改成 || 双判 +
  InlineJobCard 加 "Needs verification — open live view" 标签。

· 8264ed2 — Revert Yelp-first restaurant chain
  16aff2c 试过把 Yelp 提到 OpenTable 之前做 primary，但 Yelp 在本地
  Chromium 每次撞 CAPTCHA（free Browserbase 也撑不住），rollback。
  餐厅链恢复 OpenTable → Resy → Google Places → website handoff 顺序。
  Yelp provider 文件保留但不在 active fallback chain。

【P3-P8 smoke status】
用户 2026-04-30 manual 测试 P3 (公开 Profile) → P4 (Tier A polish) →
P5 (3+ Group DR) → P6 (反应+评论) → P7 (通知系统) → P8 (Itinerary 聚合)
全部基本通过。剩下回归再修。这意味着从 v0.2.49 开始的 6 周 smoke 套件
正式收口，进入"public launch + social feed 长期增长"阶段。

【未完成长尾】
- Social feed MVP 实施（plan.md 已写，等正式开工）
- Browserbase Pro $99/mo 升级（等付费用户敲门）
- Worker 双份代码 cleanup（等 USE_WORKER_FOR 扩到 hotel/flight/activity）
- ChatGPT Apps marketplace review 结果（被动等 OpenAI）
- B2B Lane C cold outreach（4 客户类型 × 5 contacts）
- Cofounder 搜索

================================================================
Recent Updates - 2026-04-30 (cont. 6) · 5/5 真正干净（2 succeeded + 3 no_availability，0 failed）
================================================================

Cont. 5 还有 Cosme failed/payment_stop —— classifier 拘泥于 step.status=
awaiting_confirmation 而 Resy 的 fillGuestForm provider-level marker 没 fire。
这一轮把 boundary marker emit 提到 executor 层（generic 而不是 provider-specific），
1 个 commit 让 Cosme 也 succeeded。**5/5 第一次全 expected，没有任何 failed bucket**。

【今天 1 个新 commit（64456d5）】

1. **64456d5 — fix(stagehand): emit executor-level dry_run boundary marker on paused_payment**
   - 起因：Cosme 走 Resy"Reserve Now"modal,但 Resy provider.fillGuestForm
     从未被 stagehand-executor 调用（visibleCheckoutFields=false → 没 form
     可填 → 不进 fillGuestForm path）。Resy provider line 197 的 marker
     emit 永远没 fire → step.decisionLog 没 marker → classifier 落到
     step.status=awaiting_confirmation → failed/payment_stop
   - 修法：在 stagehand-executor 调 determineFinalOutcome 之后，return
     之前 — 检测 dry_run + finalOutcome.status=paused_payment +
     assessment.stage ∈ {checkout_form, payment_gate} → trace() emit marker。
     trace() push 到 debugTrace → step.decisionLog → classifier 看见 → succeeded
   - 这是 **generic** 修法 — 任何 provider 走的 path 没 hit 自己的 marker
     都被 executor-level safety net 兜住

【验证：5/5 全 expected outcome on master `64456d5`】

| Case | Status | 时长 | 桶 |
|---|---|---|---|
| L'Artusi | failed | 16s | no_availability ✓ (OT not on network) |
| **Tao Downtown** | **succeeded ✓** | 1m 52s | OT cc-section path → boundary marker (cont. 2 fix) |
| Carbone | failed | 17s | no_availability ✓ (OT permanently closed) |
| Lilia | failed | 16s | no_availability ✓ (Resy May 15 prime time full, window=0) |
| **Cosme** | **succeeded ✓** | 1m 15s | Resy modal → executor-level boundary marker (this fix) |

**0 个 failed 桶包含 executor_error / payment_stop / unknown_error。所有 5 个
都精准命中 expected outcome bucket。**

【这一轮的关键 lesson】

O. **Marker emit 应在 generic 层，不是 provider 层**。Provider-specific
   marker emit 的 problem：每个 provider 的 fillGuestForm/fillPaymentForm
   被调用与否取决于 visible 字段 / page state / venue 行为。executor 层
   兜底确保 dry_run 走到 commit-click stage 都被记录。下一轮新 provider
   不需要每个都重写 marker emit logic — fall back to executor

P. **Classifier 不该照 step.status 死分类**。awaiting_confirmation 是
   stagehand 的"reached commit page"语义，不一定是 fail。看 decisionLog
   marker (boundary fired or not) 比 status 桶更准确

【已知 backlog（cont. 6 后剩余）】

- ~~Cosme classifier failed/payment_stop~~ ✓ **已修（这一轮）**
- ~~retry-on-transient~~ ✓ 已修（cont. 5）
- ~~stagehand fallback_policy 不感知~~ ✓ 已修（cont. 4）
- ~~Lilia executor_error~~ ✓ 已修（cont. 3）
- ~~5/5 CDP target race~~ ✓ 已修（cont. 3）
- ~~Tao Downtown OT widget~~ ✓ 已修（cont. 2）
- **`allow_platform_switch` 真实现** — 仍开放。需要 venue mapping 或
  OT-search-by-name dispatcher。3-4 小时
- **AI stage assessment 慢（30-60s/call）** — Tao 1m 52s + Cosme 1m 15s
  受这个限制。考虑 cache last-stage / batch / 减 vision call

================================================================
Recent Updates - 2026-04-30 (cont. 5) · retry-on-transient + 5/5 全 expected outcome (含 Tao Downtown succeeded)
================================================================

Cont. 1-4 累计了 5 类 transient 基建偶发：Neon DB IPv6 connect timeout、
Chrome CDP target init race、dispatcher 409 race、socket reset。这些不是
executor 真决定 give up，是"再跑一次就好"。但都 finalize 成 executor_error
污染 benchmark outcome buckets。

这一轮加 retry-on-transient (1 commit)，max 1 retry，audit jsonb 记录
retry_history。下次撞 transient 会自动救场，之前那种"重新触发整个 5/5"
的 workaround 不再需要。

【今天 1 个新 commit（51cf2c4）】

1. **51cf2c4 — feat(benchmark): retry-once on transient infra failures**
   - 修法：parse-decision-log.ts 加 `TRANSIENT_ERROR_PATTERNS` (9 个 regex)
     + `isTransientError()`。run-restaurant-benchmark.ts `resolveBenchmarkCase`
     在 finalize 之前检测：classifier=executor_error + transient pattern +
     attempt_count<2 → 调 dispatchBenchmarkCase 创建新 booking_job (新 uuid)
     fire /start，case row 仅 patch audit jsonb 记录 attempt_count + retry_history
   - 所有状态在 audit jsonb 字段，**不需要 schema migration**
   - dispatchBenchmarkCase 已经 update status=running + bookingJobId=newJobId，
     retry path 只 patch audit field，不重复写

【验证：5/5 全 expected outcome on master `51cf2c4`】

| Case | Status | 时长 | 说明 |
|---|---|---|---|
| L'Artusi | no_availability ✓ | 17s | OT not on network |
| **Tao Downtown** | **succeeded ✓** | **1m 21s** | **第一次在 5/5 跑里也 succeeded** |
| Carbone | no_availability ✓ | 15s | OT permanently closed |
| Lilia | no_availability ✓ | 14s | Resy May 15 prime time full (window=0) |
| Cosme | payment_stop ✓ | 1m 18s | Resy bookable, 走 fillGuestForm path 不走 cc-section |

注意 Tao 在 5/5 里也走 succeeded（cont. 4 单 case 跑里第一次看到的）。
Cosme 仍是 failed/payment_stop 因为 走的是不同 dry_run boundary path
（fillGuestForm 而不是 fillPaymentForm 的 cc-section path）—— 这是
classifier 分类问题，不是 executor 问题。要让 Cosme 也 succeeded 需要
review 整个 dry_run boundary marker 在 fillGuestForm 路径上的 emit。

retry 这一轮 dev.log 0 触发 — 没 transient flake。代码 standby，下次
基建偶发会自动救场。

【这一轮的关键 lesson】

M. **基建 flake 不该污染产品 outcome buckets**。Neon connect timeout 和
   CDP race 跟 stagehand 决策无关，要把这种 noise 从分类信号里剥离 —
   不是改 stagehand，是改 dispatcher 让它知道哪些是 retry-friendly

N. **audit jsonb 字段是免迁移的好工具**。attempt_count + retry_history
   都塞 jsonb 里，schema 不动，dashboard 想看时随时 parse。强 typed
   migration 适合 query-by 字段，audit-only 字段没必要

【已知 backlog（cont. 5 后剩余）】

- ~~retry-on-transient~~ ✓ **已修（这一轮）**
- **Cosme 在 5/5 里仍归类 failed/payment_stop，应是 succeeded** —
  classifier 分类问题。Cosme 走 `fillGuestForm` path（无 cc section），
  Resy provider 的 dry_run boundary marker 写在哪？需要 audit 哪条 path
  和 marker emit point。下一步追查
- **`allow_platform_switch` 未实现**（cont. 4 backlog 仍开放）— 需要
  schema migration + 测试 case 调整
- AI stage assessment 慢（30-60s/call）— bookable 路径占大头延迟

================================================================
Recent Updates - 2026-04-30 (cont. 4) · fallback_policy 链路打通 + 第一次 status=succeeded
================================================================

cont. 3 让 5/5 全 expected outcome，但 stagehand 还 hardcoded `maxDiff=90`
不读 case `fallback_policy.time_window_minutes`。Lilia case=0 ("严格只要
19:00") 凑巧分类对（page 真没空 + Pre-AI fast path 命中）—— 但是 luck。
这一轮把 fallback_policy 整条链路打通，stagehand 时间窗口跟随 case 配置。

并且**第一次 dashboard status 显示 `succeeded ✓`** —— Tao Downtown OT 高端
deposit-hold 流程走完 + dispatcher classifier 看到 dry_run boundary marker
后正确分类成 succeeded（cont. 2 已 ship marker fix，cont. 3 底层是对的，
cont. 4 单 case 验证显示 succeeded）。

【今天 2 个新 commit（335b633 → e78c3fd）】

1. **335b633 — feat(stagehand): thread fallback_policy from case to time-slot matcher**
   - 起因：cont. 3 背后的 deeper bug — stagehand 用 hardcoded ±90 min 接受
     最近 slot，不感知 case `fallback_policy.time_window_minutes`
   - 修法：4 层 thread:
     - `BrowserTaskInput` 加 `fallbackPolicy?` field (lib + worker types.ts)
     - `caseToBookingStep` 把 `c.fallback_policy` 注入 step.body
     - `start/route.ts` `runUniversalStep` forward 进 BrowserTaskInput
     - `stagehand-executor.ts` 用 `input.fallbackPolicy?.time_window_minutes ?? 90`
       替换 4 个 hardcoded 90 (OT listing / OT detail-page / OT
       restaurant-card-click / Resy)
   - 默认 ±90 保留给 legacy hotel/flight 路径（不传 fallbackPolicy）

2. **e78c3fd — fix(stagehand): hoist timeWindowMins above OT/Resy branches**
   - 起因：335b633 跑第一次 5/5，Cosme 26s executor_error。dev.log:
     `Executor threw an unexpected error: timeWindowMins is not defined`
   - 根因：`const timeWindowMins` 写在 OpenTable 分支里，但 Resy 分支也
     引用它（line 4082 `maxDiff: timeWindowMins`）。两个 if 是 sibling
     branches，不嵌套，scope 不互通
   - 修法：把 const 提到两个分支的外层 scope（listing handler 顶层）。
     OT 分支内的 inner 定义改成 comment 指向 outer

【验证：单 Tao Downtown 跑 status=succeeded ✓】

```
Case          Provider   Status        Duration   Booking job
Tao Downtown  OpenTable  succeeded ✓   1m 5s      390bd728
```

第一次 dashboard 显示 `succeeded ✓` 而不是 `failed/payment_stop`。
classifier path："dry_run boundary marker hit" → `status=succeeded`
（cont. 2 commit 61993ab marker emit 在 cc-section path 后正式打通）。

5/5 跑（cont. 4 fix 之前）的代理验证：
- L'Artusi 15s no_availability ✓ (window=0 严格)
- Tao Downtown 1m 37s payment_stop ✓ (window=60 内 7:30 PM 命中)
- Carbone 10s no_availability ✓ (window=30，permanently closed)
- Lilia 12s no_availability ✓ (window=0，page 真没空)
- Cosme 1m 11s payment_stop ✓ (window=90，bookable)

cont. 4 fix 之后 + 单 Tao Downtown 跑：1m 5s succeeded ✓

【这一轮的关键 lesson】

K. **JS scope 是 lexical**。`const X` 在 if branch A 里不能被 sibling
   if branch B 看到。Refactor 时如果想"hoist"成共享值要主动提到外层
   scope，别假设 next-block 看得到。基本知识但容易忘 — runtime 一报
   `not defined` 才发现

L. **fallback_policy threading 需要 4 层 sync**：types → caseToBookingStep
   → start route → stagehand-executor。用 grep `maxDiffMins: 90` 确保
   所有 hardcoded 90 都被 input.fallbackPolicy 替换。漏掉一个就成
   "部分修复"

【已知 backlog（cont. 4 后剩余）】

- ~~stagehand fallback_policy 不感知~~ ✓ **已修（这一轮）**
- ~~Lilia executor_error~~ ✓ 已修（cont. 3 navigate-w/-params）
- ~~5/5 CDP target race~~ ✓ 已修（cont. 3 stagger）
- ~~Tao Downtown OT widget~~ ✓ 已修（cont. 2）
- **Resy fallback：Lilia/Cosme `allow_platform_switch` 未实现** —
  case 配置允许 platform fallback (Resy fail → OT)，stagehand 不会主动
  跨平台。下一步：dispatcher 看到 no_availability + allow_platform_switch
  → 重 dispatch 到对方 platform
- **Anonymous benchmark booking_jobs 偶发"Job already running" 409** —
  cont. 4 发现 1 次。可能 dispatcher 端 race（POST /start fire-and-forget
  连续触发）。Workaround：重新触发 dispatcher 创建新 jobId。下一步可加
  idempotency key 或 createBookingJob 后短 wait

================================================================
Recent Updates - 2026-04-30 (cont. 3) · 5/5 全 expected outcome 第一次实现
================================================================

cont. 2 把 Tao Downtown 走通了，5/5 是 4 expected + 1 Lilia executor_error
+ 偶发 CDP race。这一轮 2 个 commit 把剩下两个独立 backlog 都修了，**第一次
拿到 5/5 全 expected outcome**：

| Case | Status | 时长 |
|---|---|---|
| L'Artusi | no_availability ✓ | 16s |
| Tao Downtown | payment_stop ✓ | 1m 41s |
| Carbone | no_availability ✓ | 9s |
| Lilia | no_availability ✓ | 12s |
| Cosme | payment_stop ✓ | 1m 11s |

【今天 2 个新 commit（48f5908 → 1162aa8）】

1. **48f5908 — fix(benchmark): stagger stagehand startups 500ms to avoid CDP race**
   - 起因：5/5 并发跑 1-2 个 case 偶发 1s 内 fail with
     "No Page found for target closed before CDP response"
   - 根因：`dispatchBenchmarkCase` 是 fire-and-forget /start，5 个
     chrome session 同时争 CDP target init
   - 修法：dispatcher loop 每个 dispatch 后 sleep 500ms。代价 +2s on
     full 5-case run，回报 0 race
   - 副发现：cont. 2 PROJECT_SUMMARY 里说"dashboard duration 显示 1s
     bug"实际是这个 race 造成的真实快 fail，dashboard 显示是对的

2. **1162aa8 — fix(stagehand): navigate Resy venue URL with date+seats params**
   - 起因：Lilia (case=2026-05-15 19:00) 27s executor_error。dev.log
     trace AI 看到 page 是 "April 30, 2026" (today)，不是 case date。
     19:00 today 满 → executor click 8:45 PM (75 min off, 不该接受
     fallback policy=0) → confirmation modal 渲染异常 → 27s timeout
   - 根因：Resy URL 没带 `?date=&seats=` query params 时默认用 today。
     跟 OT detail-page 同样的"widget 默认 today"问题（cont. 2 commit
     bb73afc 修过 OT side）
   - 修法：Resy 进 `/cities/<city>/venues/<slug>` 时 parse case
     date+covers from `input.task`，重 navigate 到带 query params 的
     URL。Mirrors OT 的 navigate-with-params 修复
   - 验证：Lilia May 15 19:00 真的没空 → 12s no_availability ✓
     （Pre-AI fast path 命中 Resy "no online availability for"）

【这一轮的关键 lesson】

I. **OT 和 Resy 都默认 today + 默认 covers**。做 venue detail-page
   automation 时要永远显式 navigate w/ case context，别依赖网站默认。
   两个 platform 都用 query params 接受 hint：OT 用
   `?dateTime=YYYY-MM-DDTHH:MM&covers=N`，Resy 用 `?date=YYYY-MM-DD&seats=N`

J. **Fire-and-forget concurrency 在 chrome resource-bound 上有 cap**。
   不是所有 fire-and-forget 都能无限平行，启动新 chrome session 是
   resource race。startup stagger 是稳定多并发的标配模式

【已知 backlog（cont. 3 后剩余）】

- ~~Lilia Resy click-after-slot 不稳~~ ✓ **已修（这一轮 1162aa8）**
  Fixed by navigate-with-date-seats — Lilia 现在 12s no_availability
- ~~5/5 并发 CDP target race~~ ✓ **已修（这一轮 48f5908）**
- **stagehand fallback_policy 不感知**：当前 maxDiff=90 hardcoded，
  不读 case `fallback_policy.time_window_minutes`。Lilia case=0 应该
  严格匹配，但代码会接受 ±90 min 内任何 slot。当前因为 navigate-w/-params
  让 May 15 19:00 真没空 + Pre-AI fast path 命中 Resy no-availability
  copy → 仍正确分类，但这是巧合。下一步把 fallback_policy 从 step.body
  传到 stagehand-executor，让 maxDiff 跟随 case 配置

================================================================
Recent Updates - 2026-04-30 (cont. 2) · Tao Downtown OT detail-page 走通 → payment_stop（5/5 全 expected outcome）
================================================================

cont. 1 收尾后 backlog 第 1 条："Tao Downtown OT widget time-slot
selector"。这一轮把它从 "30s+ executor_error" 一路修到 **"1m 50s
payment_stop"** —— OT 高端餐厅 deposit-hold 流程第一次端到端走通到
benchmark dry_run 边界。

【今天 6 个新 commit（f62ce8d → 61993ab）】

1. **f62ce8d — chore(stagehand): instrument OT detail-page widget DOM dump**
   - 起因：cont. 1 backlog 说 Tao Downtown widget selector 没匹配。
     Sandbox 反爬挡 curl/headless browse，无法离线看 widget DOM
   - 修法：在 OT 分支早期加一段诊断 dump，仅 `/r/<slug>` URL 触发，
     输出 visible `<select>` options + submit buttons + time anchors +
     `[data-test*=time/slot]` 元素到 dev.log
   - 跑一次 benchmark 拿到 widget 真实结构：time slots 是 `<a>`（不是
     button），在 `<ul data-test="time-slots">` 容器内，**没有 href**

2. **1b1f38a — fix(stagehand): handle OT detail-page time-slot <a> elements**
   - 第一版 fix：scope 到 `[data-test="time-slots"]` 容器找 `a, button`，
     不依赖 `role="button"`
   - 仍 fail：query-param SSR variant 没渲染这个容器

3. **3e4f440 — fix(stagehand): drive OT detail-page time-picker before reading slots**
   - 起因：dev.log 显示 widget 初始状态是 `<select data-test="time-picker">`
     dropdown，slots `<ul>` 只在用户 select 时间后才 AJAX 渲染
   - 修法：3 步流程 — set time picker（native setter + dispatch）→
     waitForSelector slots `<ul>` 5s → click anchor
   - 仍 fail：native setter dispatch 没让 OT 真正发 AJAX；time-picker-
     overlay div 不监听 `<select>` change event

4. **aa5e920 — fix(stage-assessment): pin OT/Resy detail URLs to listing stage**
   - 起因：trace 显示 `[stage-detect] AI=listing(conf=0.70) → mapped=
     listing | RPA=unknown` —— AI conf 0.70 < 0.75 阈值，stage 仍 unknown，
     OT 分支根本不跑
   - 修法：URL-based RPA fallback。`/opentable.com/r/<slug>` 和
     `/resy.com/cities/.+/venues/<slug>` deterministic listing pages，
     pin 死，不依赖 AI conf 波动

5. **ca0749b — fix(stagehand): use Playwright selectOption for OT time-picker drive**
   - 起因：native setter + dispatchEvent 没触发 OT 的 React state +
     AJAX refetch
   - 修法：`raw.locator('[data-test="time-picker"]').selectOption(value)`。
     Playwright 模拟真实 user-gesture，OT 完整 React 链路触发；
     waitForSelector 5s → 8s

6. **bb73afc — fix(stagehand): navigate OT detail URL with dateTime+covers params**
   - 起因：用户截图实证 widget 显示 "Apr 30 (today)" 而不是 case "May 14"。
     原来我们只 set time，date picker 没设，OT 用 today 的 slots
   - 修法：进 detail URL 时立即 navigate 到带 `?dateTime=YYYY-MM-DDTHH:MM&covers=N`
     query params 的版本，OT SSR 直接渲染正确 case context
   - 用户截图证实：widget 现在 "May 14, 2026, 7:30 PM, 2 people"

7. **42380fd → 4017a3f — fix(stagehand): broaden slot selector + match by text not href**
   - 起因：navigate w/ params 后 widget 正确，slots 渲染了，但
     `<ul data-test="time-slots">` 容器在 query-param SSR variant 不存在；
     anchor 也没 href（OT 用 onclick handler 做 SPA nav），所以
     `a[href*="/booking/"]` filter 把全部排除
   - 修法：多源 candidate collection — data-test container OR strict
     `<a>` text match `^\d:\d{2}\s*(AM|PM)$` length<12 OR `<button>`
     同样严格 text match。0 candidates 时 dump 实际 anchor 的 tag/text/href
     做下一轮诊断
   - 验证：dev.log 显示 `time slot match: "7:30 PM" — clicking via CDP`
     → click 成功 → 跳到 /booking/specials → /booking/details

8. **61993ab — fix(opentable): emit dry_run boundary on cc-section path**
   - 起因：Tao 走通了 RPA 但 dashboard 仍报 executor_error。dev.log
     显示 final stage=payment_gate, "Payment page is open"，但
     classifier 落到 executor_error
   - 根因：providers/opentable-com.ts:355-357 的 `if (ccRequired)`
     早返 path **没写 `DRY_RUN_BOUNDARY_MARKER`**；只 line 364 的
     dry_run path 写了。Tao 是 high-end 走 ccRequired
   - 修法：ccRequired path 在 dry_run mode 也 emit marker。production
     行为不变（cc handoff 给用户），但 benchmark classifier 现在能
     正确分类成 succeeded/payment_stop

【真实跑出来的发现 / 反模式】

E. **OT detail page 有 SSR 和 SPA 两种 widget 状态**。SSR (no query
   params): 部分 page render 默认 today slots 在 `<ul data-test=
   "time-slots">`。SPA (用户交互后): 选 time → AJAX → slot UL 重新渲染。
   两种结构不同，selector 必须兼容两种。教训：永远用 query params
   force SSR 进入"已选"状态，避免依赖 OT 的客户端 state machine

F. **OT time-slot anchor 没 href、没 role="button"** —— 是纯 onclick
   driven SPA element。任何 `a[href]` / `a[role="button"]` selector
   都会全部漏掉。只能靠 textContent 严格匹配 + 严格长度 cap

G. **AI stage detection 阈值 0.75 易卡死**。conf=0.70 / 0.74 时被丢进
   unknown，整条 OT/Resy 分支都不跑。URL-based fallback 更稳：知道是
   detail URL 就直接 listing，不依赖 AI 波动

H. **dispatcher classifier 漏写 boundary marker 是 silent bug**。
   stagehand 实际跑通 happy path，但 marker 没写 → dispatcher 看不到
   → 落到 executor_error 桶。每条会被 dry_run 拦截的 return path 都
   必须 emit marker

【验证：5/5 final benchmark on master `61993ab`】

| Case | URL | 结果 | 说明 |
|---|---|---|---|
| L'Artusi (OT, not on network)     | r/lartusi-new-york      | **17s no_availability** ✓ | Pre-AI fast path 命中 |
| **Tao Downtown (OT, deposit-hold)** | r/tao-downtown-new-york | **1m 50s payment_stop** ✓ | **新走通的主线** |
| Carbone (OT, permanently closed)  | r/carbone-new-york      | **17s no_availability** ✓ | Pre-AI fast path 命中 |
| Lilia (Resy, today full)          | cities/ny/lilia         | 30s executor_error ⚠       | 独立 Resy backlog |
| Cosme (Resy, valid bookable)      | cities/ny/cosme         | **59s payment_stop** ✓     | dry_run boundary 一致触发 |

4/5 expected outcome，Tao Downtown breakthrough 是这一轮的核心成果。
Lilia 30s executor_error 是单独 Resy click-after-slot 行为不稳定，
不在本轮 scope，下一轮处理。

【已知 backlog（cont. 2 后剩余）】

- ~~Tao Downtown OT widget time-slot selector~~ ✓ **已修（这一轮）**
- **Lilia Resy click-after-slot 不稳**：dev.log 实锤
  `[resy] time slot diag: BUTTON "8:45 PMDining Room"` → click → 但下次
  stage assessment 仍是 listing，没进 confirmation modal。可能是 Resy
  pop-up modal 没正确等待
- ~~5/5 并发 CDP target race~~ ✓ **已修（commit 48f5908 / 2026-04-30）**
  Fix: dispatcher loop 在每个 dispatch 后 sleep 500ms 错峰 chrome 启动。
  Verified: 5/5 跑完 0 个 CDP race，所有 case 跑真实时长 (12-100s)。
  代价 +2s on full 5-case run（acceptable 在 60-120s 总时长上）
- **Dashboard duration 显示 bug**：依然存在（不影响 DB 数据），cosmetic
- **AI stage assessment 慢（30-60s/call）**：bookable 路径还是慢，pre-AI
  fast path 只救了 not-bookable 路径

================================================================
Recent Updates - 2026-04-30 (cont. 1) · Restaurant Benchmark Phase 0-4 闭环 + 真跑出来的 6 个 stagehand 分类 bug 全修
================================================================

把"agent 真订得下来"的能力第一次有了**可量化、可复跑、自动化的回归
测试**。从 Phase 0 schema 到 Phase 4 site-skill registry 全部 ship 到
master，然后立刻在真实 NYC 餐厅上跑了 4 轮 benchmark，把 stagehand
分类层、URL 同步、env 注入这些 hidden 路径上的 bug 一个个挖出来修了。

最重磅的证据是 **Cosme 三轮一致跑到 `payment_stop` (1m+)** — 这是
end-to-end RPA 链路在真实 Resy 站点（带 redirect、session cookies、
checkout modal、cancellation policy）跑通到 dry_run 边界的第一个铁证。

【今天 7 个新 commit（22bdf85 → e6a4ec2）】

1. **22bdf85 — fix(start-route): build task NL independently of startUrl**
   - 起因：Phase 0 benchmark 第一次 trigger 时 2s 内 crash with
     "Cannot read properties of undefined (reading 'match')"
   - 根因：runUniversalStep 把 task-build 嵌套在 startUrl-build
     branch 里，当 caller 提供 startUrl 但没 task 时 task=undefined
     传到 runBrowserTask → 内部 .match() 炸
   - 修法：解耦两个 conditional，独立判断 startUrl / task synthesis
   - 单测：现有 benchmark-runner.test 覆盖

2. **a44b129 — fix(benchmark): refresh seeds + Phase 2 enrich on no_availability**
   - 起因：第二轮 benchmark 5 cases 全失败，dashboard 显示 4 个
     no_availability + 1 payment_stop。但所有 OT URL 实际是过时的：
     L'Artusi/Carbone/Via Carota 都不在 OT 预订网络
   - 修法：把过期 seed 换成 Boucherie/Tao Downtown/Buddakan 等已知
     稳定 venue；把 Phase 2 deep-link enrichment 接到 start route
     的 2 个 no_availability return path（之前只接 error path）
   - 副作用：Boucherie 和 Buddakan 我选的 URL slug 后来证明也是 404
     (commit 3e2bebd 修了)

3. **445bfa4 — fix(stagehand): classify OT/Resy not-bookable pages as no_availability**
   - 起因：第三轮 dev.log 实锤 Stagehand 在 L'Artusi 这种"detail 页
     存在但餐厅不接受预订"的页面跑 30s+ 后报 executor_error，应该
     是 no_availability
   - 根因：`NO_AVAILABILITY_SIGNALS` 数组只有酒店关键词
     ("sold out" / "fully booked")，餐厅 not-bookable 页面的 copy
     ("Not available on OpenTable" / "Permanently Closed" /
     "well, this is embarrassing" 404 页) 一条都不在
   - 修法：加 8 条针对真实页面 copy 的关键词；lib + worker/src 双份
     维护
   - 单测：10 条 pinning test 覆盖每个新关键词

4. **574daaa — fix(stagehand): forward AI no_availability to early-exit branch**
   - 起因：dev.log 一行铁证 `[stage-detect] AI=no_availability(conf=0.99)
     → mapped=unknown` — AI 给了 95% 置信的 no_availability 判定，
     被 mapAIStageToRPA 主动丢成 unknown
   - 根因：RPA 端 BookingStage 联合类型没 no_availability 成员，
     mapAIStageToRPA 默认分支吞掉了；unknown 又触发 20-step
     continuation pass 浪费时间
   - 修法：BookingStage 加 "no_availability"；mapAIStageToRPA 直通；
     stagehand-executor 在 listing 分支前加 early-exit 分支；lib +
     worker/src 双份
   - 单测：7 条 mapping test pinning 每个 AI stage

5. **3e2bebd — fix(benchmark): swap unverified seeds for known-existing OT URLs**
   - 起因：Boucherie/Buddakan 跑出来都是 OpenTable 404 页 — 我选 URL
     时基于记忆没 HTTP verify。沙盒环境因为 OT 反爬挡 curl/PowerShell
     无法离线 verify slug
   - 修法：换成用户截图证明存在的 L'Artusi (`r/lartusi-new-york`,
     not-on-network) + Carbone (`r/carbone-new-york`, permanently
     closed)。这两个虽然 not-bookable，但**正好用来回归测试**关键词
     修复在真实 not-bookable 页面上是否生效
   - Tao Downtown / Lilia / Cosme 不变

6. **63737e5 — perf(stagehand): pre-AI fast path for not-bookable pages**
   - 起因：所有分类修复都验证 work，但 case duration 还是 2m+。Anthropic
     vision API 调用 ~30-60s/次 + 5 case 并发 queue rate limit
   - 修法：在第一次 assessBookingStage 之前加一个超便宜的
     `page.evaluate(() => document.body.innerText)` + NO_AVAILABILITY_SIGNALS
     scan。命中直接 return no_availability，**完全跳过 AI**
   - 实际效果（dev.log 实锤）：L'Artusi 18s, Carbone 17.9s — 从 2m+
     压到 18s，主要时间花在 page.goto + browser init，不是分类逻辑
   - lib + worker/src 双份

7. **e6a4ec2 — fix(benchmark): inject mock guest profile + cover Resy 'today full' copy**
   - 起因 1：Tao Downtown 用 28s 才报 executor_error
     "Unverified checkout field values"。dev.log: hasProfile=false。
     Benchmark booking job 是 anonymous (userId=null)，profile loader
     空 → stagehand reach guest form 没字段填 → executor 阻断
   - 起因 2：Lilia 用 29s 报 "Stuck at listing page"。Resy 显示
     "no online availability for Today, next is Tomorrow" — venue 在
     线但今天满，不在已加的关键词里
   - 修法：caseToBookingStep 直接 inline `BENCHMARK_PROFILE`（RFC 2606
     .test TLD + 555-prefix phone）；NO_AVAILABILITY_SIGNALS 加
     "no online availability for" / "next availability for" /
     "there's no online availability"
   - 预期下一轮 Tao Downtown reach payment_stop, Lilia 早停 ~3-5s

【真实跑出来的发现 / 反模式】

A. **HMR 不重载 module-level const 数组** — 改了
   `NO_AVAILABILITY_SIGNALS` 但 dev server 没重启时一直读老数据。Next.js
   16.1.7 + Turbopack 对这种 import 的 const 数组 hot-reload 不可靠。
   Lesson: 改 lib/booking-autopilot/core 任何 module-level export 都
   提示用户重启 dev server，别假设 HMR 能搞定

B. **主 worktree 不会自动 fast-forward origin/master** — 我在
   `.claude/worktrees/festive-pare-f27273` commit + push 到 origin/master
   后，主 worktree (`~/onegent`) 的 HEAD 不会自动更新。每次 push 后
   要主动 `git pull` 主 worktree 才能让 dev server 加载新代码

C. **`(npm run dev) &` 子 shell 不继承父 shell env** — 用 `&` 启动
   dev server 时，Anthropic SDK 拿不到 ANTHROPIC_API_KEY，AI stage
   detect 全部 fallback to RPA。修法：先 `set -a && . ./.env.local
   && set +a` 显式 export 再 `exec npm run dev`

D. **dispatch profile 链路是手动维护的** — start route 的 profile
   loader 走 jobUserId 查 DB；anonymous benchmark 没 userId 就只剩
   step.body.profile 一条 inline 路径。如果 caller 不主动 inject 就
   是空 profile

【验证：Cosme 端到端 RPA 四轮稳定 + 5/5 final benchmark】

Cosme (Resy) 跨 4 轮、不同代码版本、不同 dev server 进程，全部跑到
dry_run boundary 触发。这是 Phase 0 boundary helper 工作的硬证据。

| Run | 代码版本 | Stage 路径 | 终态 |
|---|---|---|---|
| 1 (baseline)| 22bdf85 前 | redirect → listing → click 7:30 PM → checkout_form (5 reassess) → payment | payment_stop 57s ✓ |
| 2 (post-fix)| 22bdf85    | 同上 (reassess 简化)                                                      | payment_stop 1m4s ✓ |
| 3 (post-AI) | 574daaa    | listing → checkout_form (3 reassess) → payment                            | payment_stop 1m5s ✓ |
| 4 (final)   | e6a4ec2    | listing → click → checkout_form → payment                                  | payment_stop 53s ✓ |

5/5 final benchmark on master `e6a4ec2`（mock profile + Resy keywords ship 后）：

| Case | URL | 修复前 | 修复后 | 验证 |
|---|---|---|---|---|
| L'Artusi (OT, not on network) | r/lartusi-new-york | 41s executor_error | **3s no_availability** ✓ | Pre-AI fast path 命中 "not available on opentable" |
| Tao Downtown (OT, valid bookable) | r/tao-downtown-new-york | 0s/28s executor_error | 37s error | OT provider time-slot selector 没匹配 widget — 新 backlog |
| Carbone (OT, permanently closed) | r/carbone-new-york | 22s/2m14s executor_error | **14s no_availability** ✓ | Pre-AI fast path 命中 "permanently closed" |
| Lilia (Resy, today full) | cities/ny/lilia | 29s executor_error | **14s no_availability** ✓ | Pre-AI fast path 命中 "no online availability for" |
| Cosme (Resy, valid bookable) | cities/ny/cosme | 1m4s payment_stop | **53s payment_stop** ✓ | dry_run boundary 一致触发 |

Failure breakdown 干净：3 no_availability（设计就该这样）+ 1 payment_stop
（happy path 证据）+ 1 executor_error（具体 OT widget 适配 bug，下一轮）。

【已知 backlog（不阻塞，下一轮处理）】

- ~~Tao Downtown OT widget time-slot selector~~ ✓ **已修（cont. 2 / 2026-04-30）**
  Fixed in commits f62ce8d → 61993ab: detail-page navigate w/ params +
  selectOption time picker + text-match anchor + dry_run marker on
  cc-section. Tao Downtown 1m 50s payment_stop ✓
- **Dashboard duration 显示 bug**：L'Artusi step.status="no_availability"
  但 dashboard 显示 "executor_error 1s"。实际 booking_job DB 行正确，
  duration 计算或 race condition 把 createdAt - completedAt 算成 1s
- **OpenTable URL HTTP verify**：sandbox 反爬挡得死死的，需要在 dev
  server 内部跑 verify endpoint（local fetch 就不会被反爬）才能离线
  确认 seed slug 是否 200/404
- **AI stage assessment 慢（30-60s/call）**：5 case 并发互相 queue
  Anthropic rate limit。Pre-AI fast path 已经把 not-bookable 路径救了，
  bookable 路径仍然慢。考虑后台 prefetch / 并行度限流

Onegent 第一次有了**真实可付费的产品形态**。Stripe sandbox 配置完整、
prod E2E 跑通、user 走完 Checkout → webhook → Neon → /account/billing
显示 PRO 整条链路无误。原来 PROJECT_SUMMARY 里每条 backlog 都标"等付费
用户敲门"的阻塞从今天起可以解锁。

【价格结构】
- Free: 3 bookings/月 + 1 Decision Room/月，跨 surface 共享额度
  （onegent.one + Claude.ai connector + ChatGPT App + 第三方 OAuth agent
  全部按 user_id 聚合配额）
- Pro: \$9/月 或 \$79/年（年付省 27%），无限 bookings + 无限 DR + 价格
  监控 + 优先 autopilot 队列 + email 1 工作日响应
- 不做 Concierge / Enterprise tier — 等真有 100 个 Pro 用户再分层
  （DHH/PG 视角：don't optimize for problems you don't have）

【架构】
```
DB
├── user_subscriptions(user_id PK, stripe_customer_id, stripe_subscription_id,
│       tier{free|pro}, status, current_period_end, cancel_at_period_end,
│       plan_interval, created_at, updated_at) — Stripe-mirrored 状态
└── user_usage_counters(user_id, period_start DATE, bookings_used,
        rooms_used, updated_at) — 月度 calendar-month 计数器
        period_start = DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
        每月 1 号 UTC 0:00 自然新行 → 配额自动重置

lib/billing/
├── quota.ts — getUserTier / canBookMore / canCreateRoom /
│              buildQuotaExceededBody
│   active set: { active, trialing, past_due } 都给 Pro 待遇
│   past_due 故意保留 Pro，等 Stripe smart retry 救（~50% 成功率）
└── stripe.ts — Stripe SDK singleton + isStripeConfigured() guard

app/api/billing/
├── checkout/  — POST: 预创建 Customer 写 user_subscriptions row
│                tier=free 占位, metadata.user_id 双写（subscription_data
│                + customer.metadata）→ 创建 Checkout Session 返 url
├── webhook/   — POST: stripe-signature 验签后 switch 4 个事件:
│                customer.subscription.{created,updated,deleted} +
│                invoice.payment_failed → upsertUserSubscription
│                idempotent (PRIMARY KEY user_id), 失败也 200 防 retry storm
├── portal/    — POST: 拿 stripe_customer_id 创建 Stripe Customer Portal
│                session 返 url（管订阅、付款方式、取消、看 invoice）
└── me/        — GET: { tier, bookings.{used,limit}, rooms.{used,limit},
                   subscription.{status, current_period_end,
                   cancel_at_period_end, plan_interval} } 给 BillingTab 用

【quota gate 落点】
- app/api/booking-jobs/[id]/start/route.ts:
  · 入口加 canBookMore(job.user_id) → 不通过返 402 + upgrade_url JSON
  · runStepAt 末尾 transition→done/awaiting_confirmation 时
    incrementUsageCounter(user_id, "booking") 幂等防重计
- worker/src/index.ts runStepAt: 镜像同样 increment（worker 跑 restaurant
  时的计数路径，跟 Vercel 走 hotel/flight/activity 互斥）
- app/api/mcp/route.ts OAuth path:
  · isBookToolCall(parsedBody) 仅对 book_* tools 走 quota 检查
  · tools/list / get_job_status / get_job_audit 通通免计数
  · 超额返 HTTP 402 + 同样的 upgrade_url JSON, claude.ai/ChatGPT 都会把
    body 传给 LLM, agent 能告知用户去 onegent.one/pricing

【UI】
- /pricing — server-rendered, 消费端 warm-gold/cream tokens
  Hero "Free for casual use. Pro when you want more."
  Free + Pro 双卡, $79/年 saves 27% 副文案, 9 行 feature comparison 表,
  6 题 FAQ, 底部跳转 /developers/pricing 给 agent builder
- /account/billing → BillingTab.tsx
  Pro: tier badge + next renewal + cancellation/past_due warning +
       Manage subscription → Stripe Portal
  Free: usage progress bar (X/3 + Y/1), 超限红条, Upgrade → /pricing
- GlobalNav 加 Pricing 入口 — 之前 Tasks/Calendar/Rooms/Contacts/Memory
  五项都是 app 内部, 没有外部能让用户发现 pricing 的链接

【环境配置】
Stripe 开了 sandbox（"onegent sandbox"，独立于将来 live 账号）:
- Product: Onegent Pro · 2 prices (monthly $9 + yearly $79)
- Webhook endpoint: https://onegent.one/api/billing/webhook (4 events)
- 5 个 env vars 在 .env.local + Vercel 项目（Production/Preview/Development）:
  · STRIPE_PUBLISHABLE_KEY / STRIPE_SECRET_KEY
  · STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY
- 切 live 模式时 5 个值都要换（test→live key 不互通）+ 重新创建 webhook

【E2E smoke test 跑过的路径】
1. localhost:3000/pricing 渲染、Pricing 主导航点击 ✓
2. Upgrade button → /api/billing/checkout 200 → window.location.href ✓
3. checkout.stripe.com 页面正确显示 Onegent Pro $9/month + sandbox badge ✓
4. 测试卡 4242 4242 4242 4242 完成支付 ✓
5. success_url 跳回 /account?tab=billing&checkout=success ✓
6. Stripe webhook 打到 onegent.one/api/billing/webhook ✓
7. 签名校验通过 + handleSubscriptionUpdate ✓
8. user_subscriptions 行写入 tier=pro / status=active /
   stripe_subscription_id / plan_interval=month ✓
9. /account/billing 显示 PRO badge ✓
10. /api/billing/me 返回正确 tier+usage payload ✓

【已知小毛病 — 已修待 resend】
- Stripe API 2026-04-22.dahlia 把 current_period_end 从 subscription 顶层
  搬到 items.data[0]，第一次 webhook 写入 period_end=null
- commit 1d350d4 加了 periodEndUnixFromSubscription() 双形态探测函数
- 用户回 Stripe Webhook 页 Resend 一次, handler 走新代码就把 period_end
  字段补上, /account/billing 的 "Next renewal" 文案就显示

【没做（按设计文档原则推迟）】
- live mode key 切换 — 等真有付费意愿用户再切, 现在 sandbox 验证够用
- API tier 计费 (per-call billing for agent builders) — 等 /api/v1 真有
  集成流量再说, 当前 OAuth IdP 跑过的 claude.ai connector 是验证流量
- B2B Enterprise tier — 跟 patio11 视角一致, B2B 要冷启动 outreach 验证
  willingness to pay 后再设计 SKU
- Free tier 4th booking 触发 402 的实测 — 流程上肯定会触发(代码 review
  通过), 但需要造一个 free 测试账号跑 4 次 booking 才能 e2e 验

【影响】
之前 PROJECT_SUMMARY 多个 backlog 都标"等付费用户敲门":
- Browserbase Pro \$99/mo 升级时机 — 现在如果 Pro 用户付费了, 这 \$99/mo
  立刻在经济账上合理
- Worker 双份代码 cleanup — DELETE_WHEN 触发条件之一是"升 Browserbase
  Pro", 链式解锁
- B2B Lane C 验证 — 有 C 端付费数据后, B2B 谈 enterprise tier 才有依据
所有这些"等付费用户"的依赖现在都解锁了。

【Commit 链】
- ab1a3fb feat(billing): pricing scaffold (schema + quota + /pricing + gate)
- 03efd0e feat(billing): Stripe routes + MCP gate + account billing tab
- 461b89c feat(nav): add Pricing link to GlobalNav
- 1d350d4 fix(billing/webhook): handle current_period_end on items[0]

================================================================
Recent Updates - 2026-04-27 (cont. 3) · Worker 30 天 cleanup deadline 解除 — 双份代码继续共存到 Browserbase Pro 升级
================================================================

CLAUDE.md 上原本写的 "Booking-autopilot 双份代码规则（DELETE_BY: 2026-05-26）"
今天主动废除，改成 conditional trigger：满足"hotel/flight/activity 切到 worker"
之一时再删。

【为什么本来要删】
Sprint 1 #1 (D1) 把 lib/booking-autopilot/ 整个 fork 到 worker/src/，
留 30 天双份过渡期。原计划 2026-05-26 删 root 那份回归"单源"。

【为什么不删了】
Phase 1 调研（不动代码，只看文件 + diff + grep + tsconfig）发现：

1. **物理上无法"回归单源"**：worker 是 standalone Docker 项目，不进
   monorepo workspace（D1 故意决定，PROJECT_SUMMARY L428）。worker 通过
   tsconfig paths 把 `@/lib/*` 重定向到自己的 `./src/*`，所以 worker 必
   须有自己的代码副本。"删 lib/" 真正含义只能是 "Vercel 这一侧不再
   in-process 跑"。

2. **Vercel 现在还在跑 hotel/flight/activity**：当前 prod USE_WORKER_FOR
   = `restaurant`（推断自 PROJECT_SUMMARY L415），其它 3 个 scenario 还
   在 lib/booking-autopilot/ in-process 跑。要删 lib 必须先把这 3 个切
   到 worker。

3. **切 hotel/flight/activity 到 worker 有真实阻塞**：
   - **Browserbase Pro $99/mo** —— Booking/Expedia 反检测能力强，本地
     chromium 不一定撑得住，Browserbase free tier 已经撞过 402 minutes
     exhausted。
   - **没付费用户** —— PROJECT_SUMMARY L495 明确："需要真有付费用户或
     hotel/flight scenario 真上线时再决定"，提前烧 $99/mo 是 cargo cult。

4. **双份维护成本目前是 0**：
   - `diff -rq lib/booking-autopilot worker/src/booking-autopilot` 输出空
   - D1 fork 之后没有任何同步过的 bug fix，说明实际维护负担为 0
   - 未来真出现需要同步的 hotfix 时再触发清理也不晚

【新规则】
触发删除的条件（满足任一即可）：
- 升 Browserbase Pro，把 USE_WORKER_FOR 扩到 restaurant,hotel,flight,activity
- 验证 hotel/flight 在 worker 容器的本地 chromium 抗反检测能力，扩
  USE_REAL_CHROME_FOR
- 双份代码真的开始 diverge（worker/src 改了但 lib 没跟，或反之）

【哲学视角】
- **Linus**: 双份 byte-identical 代码理论上是 git 的耻辱，但维护成本为 0
  时不必处理。等真有 diverge 信号再动。
- **PG / patio11**: Don't optimize for problems you don't have. 没付费
  用户阶段不该烧 $99/mo 解决"还没产生压力"的债务。
- **Kent Beck**: Make the change easy, then make the easy change. 现在
  状态：删除条件未到（hotel/flight 没切 worker），先不动是对的；当条件
  到了那天，CLAUDE.md 已经写好了清理清单，直接执行。

【改动文件】
- CLAUDE.md — "双份代码规则" section 重写：DELETE_BY → DELETE_WHEN，
  增加触发条件、修正改动规矩描述、列出删除清单
- PROJECT_SUMMARY.md — 本条 cont. 3 + 版本 v0.2.55.0 → v0.2.55.1

【没改动的代码】
零代码改动。这是个文档/规则决策，不是 refactor。worker、Vercel、prod
所有路径继续按原样跑。

================================================================
Recent Updates - 2026-04-27 (cont. 2) · ChatGPT Apps submitted + connected-apps dashboard + MCP tool annotations + OAuth dev guide
================================================================

Sprint 2 #1 那两条 release notes（主条 + cont. 1）只覆盖了 OAuth IdP 协
议层 + claude.ai 验证。今天后半场又干了 5 件事，外加把 Onegent 真正
推进了 ChatGPT Apps marketplace 审核队列。这条 release note 把这部
分一次性归档。

【里程碑：ChatGPT Apps 提交 v1.0.0 → Status: Review】
2026-04-27 当天傍晚，Onegent 的 Travel Booking Agent 应用通过 OpenAI
Apps 开发者后台 (platform.openai.com/apps) 提交审核。OpenAI 5-10 工
作日异步审核中。提交全套包括：
  - MCP Server URL: https://onegent.one/api/mcp
  - Auth: OAuth 2.0（OpenAI 自动从 .well-known 抓全部 metadata + DCR
    自我注册自己）
  - 6 工具的完整 tool annotations（readOnlyHint / openWorldHint /
    destructiveHint）
  - 5 个 happy-path test cases（restaurant/hotel/flight/activity 各
    一个 + status check）+ 3 个 negative cases
  - Screenshot：706×800 PNG 显示 ChatGPT 调 get_job_status 的 tool
    call widget，#212121 padding 跟 ChatGPT 暗色主题无缝
  - Test credentials：用 Clerk sign-in token 给 reviewer 一条单次免
    验证登录 URL（绕过 Clerk dev instance 的 adaptive new-device
    challenge），加 email/password 备份
  - Identity verification：通过 OpenAI org settings → Persona 完成
    个人开发者身份验证

整个 submit 流程踩过的所有坑（Clerk dev/prod instance 混淆 / new-device
challenge / sign-in token 配 Fallback development host / 706 像素
精确化 / tool annotations 必须项 / Persona ID 验证）已落入 memory
openai_apps_submission_journey.md，未来任何 marketplace 提交（Microsoft、
Apple Intelligence 等）按那条 memory 走都不用再 trial-and-error。

【今天后半场 5 个 commits】

- /developers/connected-apps 用户自助 OAuth 管理 dashboard (commits
  880cfd7 + 52a8dd8)
  · 新 lib/db.ts::findConnectedAppsByUserId(userId) UNION 查询找出
    用户所有活跃 grant（access OR refresh 任一未过期就算连着）
  · 新 lib/db.ts::revokeUserAppGrants(userId, clientId) soft-revoke
    一对 (user, client) 下所有 access + refresh tokens；不删 oauth_clients
    行，client 仍可被其他用户授权
  · 新 GET /api/developers/connected-apps + DELETE /[clientId] 路由，
    Clerk-gated，shape 跟 /api/developers/keys 一致
  · 新 app/developers/connected-apps/{layout,page}.tsx +
    _components/ConnectedAppCard.tsx，复用 keys 那边的 dev-key-card 风
    格（gradient + badge row + Disconnect 按钮）
  · DashboardNav 从 keys/_components/ 提到 _components/ 共享，加
    Connected apps 链接 + usePathname() 高亮
  · polish (52a8dd8)：null client_uri 时不显示占位灰条；first_authorized_at
    == last_token_at 时折叠成单行 "Connected Xm ago"

- MCP tool annotations on all 6 tools (commit 541522f)
  · packages/mcp-server/src/tools/types.ts 加 ToolAnnotations interface
    + ToolDefinition.annotations 可选字段
  · 6 工具文件分别加 annotations block：
    book_{restaurant,hotel,flight,activity}: readOnly=false, openWorld=true,
      destructive=false（payment-safety stop 解决 destructive 模糊性 —
      工具本身只入队 job，不直接扣款）
    get_job_{status,audit}: readOnly=true, openWorld=false, destructive=false,
      idempotent=true
  · server-factory.ts ListToolsRequestSchema handler 条件 spread
    annotations（仅 defined 时输出，避免空对象污染老客户端）
  · 这是 ChatGPT Apps 表单 "Tool justification" 红色 missing 项的硬性
    要求 — 没这个 submit 就被拦

- /developers/docs/oauth 第三方 agent builder 集成指南 (commit 52b7d59)
  · docs/oauth.md ~600 行 11 节完整手册：Quick reference / Discovery /
    Client registration (DCR + 预注册) / Authorization + PKCE /
    Token exchange + refresh rotation / Revoke / Calling /api/mcp /
    Scopes / 工作代码示例 (TypeScript Node 18+ / Python 3.11+ requests
    / curl) / Common errors 表 / Going further
  · 新 app/developers/docs/oauth/page.tsx 路由，复用 api/v1 page 的
    MdxContent + sidebar TOC pattern
  · /developers/docs landing 从 "Three doors" → "Four doors"，加
    OAuth 卡 + 锁形 glyph
  · 受众：LangChain / CrewAI / Lindy / 内部 agent / 任何想直接接
    OAuth IdP 的第三方开发者（不是 Claude/ChatGPT marketplace 用户）

- DashboardNav refactor：从重复 nav header 变成 tab strip (commit
  2a6b18f)
  · 用户截图反馈 /developers/connected-apps 上有两层 nav：上面
    BrandStrip（Onegent / Developers + Docs/Pricing/Dashboard + 头像），
    下面 DashboardNav 又一遍 Onegent / Dashboard + nav links + 头像
  · 修：DashboardNav 砍掉 logo 块 + UserButton，高度 64→44px，active
    tab 加 2px 金色下划线。Stripe / Linear / GitHub 同款 "global nav
    + section tabs" 分层
  · BrandStrip 单独负责品牌 + 账号，DashboardNav 单独负责 sub-page
    导航，零 duplication

【今天累计 commits】
14 个 prod commits：6ac2509 → 0dde391 → 7b3960f → d27e13c → b93452b →
9312374 → b818149 → df2fe63 → dd9837c → f0e7ba7 → 880cfd7 → 52a8dd8 →
541522f → 52b7d59 → 2a6b18f

涵盖：OAuth 2.0 IdP 全栈（D1-D5）+ RFC 9728 + RFC 7591 DCR + MCP tool
annotations + connected-apps dashboard + 第三方集成指南 + DashboardNav
polish + ChatGPT Apps 上架审核提交。

【未完成长尾】
- ChatGPT Apps marketplace review 结果（5-10 工作日异步）—— 反应式
- @onegent/mcp-server npm 发版（让 Claude Desktop 用户也拿到 tool
  annotations，~5 分钟工作）
- Worker 30-day cleanup（DELETE_BY: 2026-05-26 仍有效）

================================================================
Recent Updates - 2026-04-27 (cont. 1) · Sprint 2 #1 closed · DCR + claude.ai web verified
================================================================

D5 计划里 D5-D 是 conditional("如果 claude.ai 用 DCR 才做")。今天浏
览器测了下，claude.ai 确实走 RFC 7591 Dynamic Client Registration —
而且不只 DCR，还要 RFC 9728 Protected Resource Metadata 才能完成
discovery。两个都补完后，claude.ai 真实链路一次跑通。

【今天补的 4 个端点 / 改动 — commit dd9837c】
- 新 GET /.well-known/oauth-protected-resource (RFC 9728):resource =
  /api/mcp,authorization_servers = [issuer],scopes_supported,
  bearer_methods_supported = [header]
- 新 POST /oauth/register (RFC 7591 DCR):接客户端 metadata,验
  redirect_uris(https/localhost),品牌仿冒 blocklist(Onegent /
  Anthropic / OpenAI / Apple / Google / Microsoft 6 个 substring),
  mint dcr_<random> client_id + 32B base64url client_secret,持久化
  标 dynamically_registered=true
- 改 /.well-known/oauth-authorization-server:advertise
  registration_endpoint = /oauth/register
- 改 /api/mcp 401 WWW-Authenticate:加 resource_metadata 参数指向
  protected-resource metadata URL(RFC 9728 §5.1 要求,缺这个 claude.ai
  就报 "Couldn't reach the MCP server")

【真实 prod 验证 — gzw19914760905@outlook.com Max account】
1. claude.ai Settings → Connectors → Add custom connector,URL =
   https://onegent.one/api/mcp → 走完 DCR 自动注册 + OAuth dance +
   Approve → 状态从 "Connect" 变 "Configure"
2. Configure 页 → Tool permissions → 看到全部 6 工具(book_activity /
   book_flight / book_hotel / book_restaurant / get_job_audit /
   get_job_status),全部默认 "Needs approval"
3. 新开 chat → "check the status of jobId test-d5-smoke" → Claude
   触发 get_job_status → 链路全跑 → /api/v1/execution-jobs 返 404
   → Claude 自然语言转述给用户("Onegent returned a 404 — no job
   with the ID test-d5-smoke was found"),证明 OAuth Bearer →
   bridge key → /api/v1/* require-api-key → 业务层错误传播链路
   完整闭环

【Sprint 2 #1 状态】
- ✅ D1 schema + .well-known discovery (commit 6ac2509)
- ✅ D2 /oauth/authorize consent (commit 0dde391)
- ✅ D3 /oauth/token + /oauth/revoke + PKCE (commit 7b3960f)
- ✅ D4 /api/mcp 双轨 auth + scope check (commits b93452b + 9312374 +
     b818149)
- ✅ D5 docs §6 + PROJECT_SUMMARY v0.2.55.0 + DCR + RFC 9728
     (commits df2fe63 + dd9837c + 这个 commit)
- ✅ 4 个 RFC 一次接通:6749 / 7591 / 7636 / 9728

【剩下的长尾(未完成)— 不阻塞 Sprint 2 #1】
- D4-D ChatGPT Apps 表单重测:OpenAI 开发者后台用 OAuth 重新提交
  manifest,等用户拿到 ChatGPT 真实 redirect_uri
- /developers/connected-apps 用户 dashboard:让用户看自己授权过的
  OAuth client 列表 + 一键 revoke(目前要后台 SQL 或调 /oauth/revoke)
- /developers/docs/oauth.md:面向第三方 agent builder 的端到端 OAuth
  integration 指南
- Worker 30-day cleanup(DELETE_BY: 2026-05-26)— 单独工作流

================================================================
Recent Updates - 2026-04-27 · Sprint 2 #1 · Onegent as OAuth 2.0 Identity Provider (D1-D5 shipped)
================================================================

Onegent 现在是一个 OAuth 2.0 Identity Provider。第三方 MCP 客户端
（claude.ai web、ChatGPT Apps、第三方 agent builder）可以走标准的
auth-code-with-PKCE 流程让最终用户登录 Onegent，不再要求每个用户手
动复制 `ogk_live_*` API key 进 AI 客户端配置。这是 Sprint 2 #1 的全
部目标 —— 把 Sprint 1 #2 上线的 hosted /api/mcp 从"开发者级 API key
手动配置"升级到"消费级一键 Connect"。

【为什么这件事是 distribution 解锁】
- Sprint 1 #2 上线了 `https://onegent.one/api/mcp` MCP endpoint，但
  当时只接 `Authorization: Bearer ogk_live_...`。要求每个用户先去
  /developers/keys 生成 key、复制、粘贴进 claude.ai 配置 — 三步操作，
  消费级 SaaS 体验不及格。
- claude.ai web 和 ChatGPT Apps marketplace 的 MCP connector 一键添加
  入口要求 OAuth；没 OAuth = 进不了 marketplace 的 "Connect" 按钮。
- OAuth 上线后，从"先去 Onegent 网站生成 key + 复制 + 粘贴"压成"在
  claude.ai 点 Connect Onegent → 弹 consent → Approve"。

【架构 — /api/mcp 双轨 auth】
```
Authorization: Bearer ogk_live_xxx     →  既有路径,直接走
                                          require-api-key.ts → /api/v1/*
Authorization: Bearer <opaque>         →  validateAccessToken()
                                          → checkScopeForRpc(book/read)
                                          → findOrCreateOAuthBridgeApiKey()
                                            (HMAC-SHA256-derived 合成
                                             ogk_live_* key)
                                          → 复用既有 require-api-key 路径
```
HMAC 派生的 bridge key 让 OAuth 用户串入既有 /api/v1/* API key 链路 —
旧 lipa 集成零改动，require-api-key.ts 一行没动。bridge key 写 api_keys
表标 `source='oauth-bridge'`，findApiKeysByUserId 过滤掉，不在用户
dashboard "My Keys" 显示。HMAC 派生意味着不需要 plaintext 缓存表 —
每次请求按 user_id 重新派生同一个 plaintext。

【D1-D5 拆解】
- D1 (commit 6ac2509) — schema + .well-known discovery + oslo
  · 4 张表 ensureOAuthTables() 自动迁移：oauth_clients /
    oauth_authorization_codes / oauth_access_tokens / oauth_refresh_tokens
  · app/.well-known/oauth-authorization-server/route.ts (RFC 8414)：
    issuer + 3 个 endpoint + scopes [book, read] + S256-only PKCE +
    client_secret_basic / client_secret_post 双客户端认证
  · 装 oslo（TypeScript-first crypto helpers，base64url 编解码）
  · scripts/admin/register-oauth-client.mjs CLI 注册新 client，plaintext
    secret 一次性返回（DB 只存 sha256）

- D2 (commit 0dde391) — /oauth/authorize consent page (Clerk-gated, branded)
  · GET /oauth/authorize 校验 client_id + redirect_uri + response_type +
    code_challenge；未登录 Clerk 跳 sign-in；登录后 SSR 渲染 Onegent
    风格 consent 卡（client app 名 + 用户邮箱 + 请求 scopes 解释）
  · POST /oauth/authorize/decide：Approve → mint auth code（10 分钟
    过期，one-time，绑 PKCE challenge + redirect_uri + user_id + scopes）
    → 302 redirect_uri?code=...&state=...；Deny → redirect 带
    error=access_denied

- D3 (commit 7b3960f) — /oauth/token + /oauth/revoke + PKCE
  · POST /oauth/token：client_secret_basic / _post 双客户端认证
  · grant_type=authorization_code：consume code → verify PKCE (sha256 +
    base64url 比 challenge) → 校验 code/client/redirect_uri 绑定 → issue
    access_token (1h) + refresh_token (30d)
  · grant_type=refresh_token：原子 UPDATE rotation 防 race，关联
    access_token 同步 revoke，issue 新 pair
  · POST /oauth/revoke (RFC 7009)：永远 200 防 token enumeration
  · 端到端验收 5/5：auth code 兑换 → 200，re-use code → 400 invalid_grant，
    refresh → 200 + 轮换，revoke → 200，PKCE 短 verifier → 400

- D4 (commits b93452b + 9312374 + b818149) — /api/mcp 双轨 auth + scope check
  · app/api/mcp/route.ts：token 前缀分流；OAuth 路径走 validateAccessToken
    → checkScopeForRpc → findOrCreateOAuthBridgeApiKey → 复用 ogk_ 路径
  · lib/oauth/scope-check.ts：6 工具 → book/read 映射；只 gate
    tools/call，tools/list/initialize/ping passthrough
  · lib/db.ts::findOrCreateOAuthBridgeApiKey：HMAC-SHA256 派生 plaintext，
    INSERT ... ON CONFLICT DO NOTHING by sha256(plaintext)；api_keys 加
    source 列，findApiKeysByUserId 过滤 oauth-bridge
  · 6 vitest cases 覆盖 scope check 全分支
  · 端到端 prod 验收 5/5：OAuth tools/list → 200 + 6 工具，OAuth
    tools/call get_job_status → 200 跑通完整链路（OAuth → bridge key →
    prod /api/v1/* require-api-key → 404 job 不存在），无 auth / bogus
    token → 401，老 ogk_live_* 路径零回归
  · **新 prod env var：`OAUTH_BRIDGE_HMAC_SECRET`** (32+ chars base64url，
    Vercel Settings → Environment Variables 须设；缺则 OAuth 路径 500
    bridge_key_failed)

- D5 (本条 release notes) — claude-mcp.md docs + PROJECT_SUMMARY
  · docs/integrations/claude-mcp.md 第 6 节从 "Claude.ai (remote MCP) —
    roadmap" 改成完整 claude.ai web OAuth 操作指南（Add connector +
    consent flow ASCII 图 + scopes 表 + 撤销 + troubleshoot）
  · prerequisites 修：beta@onegent.one 邮件申请改成 /developers/keys
    自助页指引；troubleshooting 里 "Regenerate via beta@onegent.one"
    改 self-serve revoke + regenerate 流程

【未完成 — Sprint 2 #1 长尾】
- claude.ai web 浏览器真实操作验证（D5-C/E pending）：Connectors UI 输
  入 https://onegent.one/api/mcp，看走 RFC 7591 DCR 自动注册还是要手动
  填 client credentials；走通后真调一次工具
- RFC 7591 `/oauth/register` Dynamic Client Registration（D5-D，
  conditional on D5-C 结果）
- ChatGPT Apps 表单重测（D4-D）：OpenAI 开发者后台用 OAuth 重新提交
  manifest，要 ChatGPT 真实 redirect_uri 才能注册 chatgpt-apps client
- /developers/connected-apps 用户 dashboard：用户看自己授权过哪些
  OAuth client + 一键 revoke（目前要后台 SQL 或直接调 /oauth/revoke）
- /developers/docs/oauth.md：面向第三方 agent builder 的端到端 OAuth
  integration 指南（如何把 Onegent 接进你自己的 agent）

================================================================
Recent Updates - 2026-04-26 (cont. 5) · Hosted /api/mcp endpoint live (Sprint 1 #2 — code done)
================================================================

Sprint 1 #2 的代码部分上线：`https://onegent.one/api/mcp` 是一个 MCP
Streamable HTTP endpoint，跟 npm @onegent/mcp-server (stdio) 共享同一个
`createOnegentServer()` factory + 6 个工具定义。任何 MCP 客户端
（Claude.ai web、ChatGPT Apps、自建 agent、curl）都能 POST JSON-RPC
到这个 URL，带 `Authorization: Bearer ogk_live_...` header。

【为什么这件事是 distribution 解锁】
- stdio 通道（npm + Claude Desktop）触达 power user，需要装 + JSON 配置
- HTTP 通道触达消费者（Claude.ai 千万级 + ChatGPT Apps 亿级），一键添加
- 没这个 endpoint 也没法提交 ChatGPT Apps marketplace（必须 HTTPS URL）

【架构】
```
packages/mcp-server/src/             →  app/api/mcp/route.ts
  server-factory.ts                       (Next.js App Router)
  tools/{6 个文件}.ts                        ↓
  api-client.ts                       WebStandardStreamableHTTPServerTransport
       ↓                                    ↓
  npm @onegent/mcp-server (stdio)     POST /api/mcp (HTTPS)
  Claude Desktop / 命令行              Claude.ai / ChatGPT / curl

共享: createOnegentServer({ apiKey? }) — apiKey 来自 env 或 HTTP header
```

【D1-D5 拆解】
- D1 (commit bbb0053) — server-factory 加 apiKey 参数
  - api-client.ts 抽 configFromApiKey() helper
  - createOnegentServer() 接 { apiKey } 可选参数, 走 cfg 路径而不是 env
  - stdio 路径不变（无 apiKey 时 fall back 到 loadConfig env-based）

- D2 (commit bbb0053) — Next.js route + monorepo workspace import 配通
  - app/api/mcp/route.ts (124 行)
  - packages/mcp-server/package.json 加 exports field 暴露子模块
  - root package.json 加 prebuild → npm run build:mcp (Vercel build 链)
  - next.config.ts 加 transpilePackages (防御性, 让 Turbopack 处理 .js→.ts)

- D3 (commits 5662797, 0c70367, 1e8e029, b79c01f) — 部署 + 4 轮调试上线
  四次接力修 transport bridging:
  - 5662797: 第一版 Node http req/res shim 缺 stream 接口 → 加 destroy/
    pause/resume/pipe/cork (但 Hono Node→Web 转换层仍出错)
  - 0c70367: 改用 WebStandardStreamableHTTPServerTransport 直接接 Web
    Request → 跳过整个 shim 层, 280 行 → 124 行
  - 1e8e029: 加 enableJsonResponse=true 跳过 SSE ReadableStream 路径
  - b79c01f: **关键修复** — 删 finally 里的 transport.close() / server.close()
    在 JSON 模式下, send() 的 Promise resolve 跟 finally 的 close() race,
    后者赢 → 删 streamMapping → send 找不到 stream → Promise hang →
    Vercel 等到 SSE 默认 fallback 返回空 200. 删 finally 后 GC 自然回收.
  smoke test verified: tools/list 返回 6 个工具完整 schema

- D4 (in progress, partial) — ChatGPT Apps manifest 提交准备
  - manifest.json 已经指向 https://onegent.one/api/mcp ✅
  - 但 OpenAI review 强制查 /privacy + /terms 页面, 两个都 404 ❌
  - **D4 半完工** — 等 privacy/terms 页面写完再提交
  - 决定: 用 LLM 生成 SaaS 标准模板, 不付律师 (YC 早期 startup 通用做法)

- D5 (this section, commits b79c01f cleanup + this commit) — release notes
  - PROJECT_SUMMARY v0.2.54.0
  - app/api/mcp/route.ts 删 debug console.log (D3 排错时加的)

【Auth 方案 — 当前 vs 计划】
- **当前 (#22 范围)**: Bearer token in Authorization header. 用户去
  /developers/keys 创建 ogk_live_... key, 复制粘贴到 Claude.ai 的 MCP
  server 配置里. 体验 ≈ Stripe API key 配置.
- **计划 (#23, 后续 backlog)**: OAuth 2.0 — 用户在 Claude.ai 点 "Connect
  Onegent", 弹 OAuth 窗, 授权后 Claude.ai 自动管 token. 体验 = 普通
  消费级 SaaS. 实现复杂 (需要 OAuth provider + token 管理 + scopes).

【未完成 — 留 #22 收尾】
- /privacy + /terms 页面写完 (LLM 生成模板, ~30min)
- ChatGPT Apps developer portal 手动提交 manifest
- OpenAI review 5-10 天 (人工审核)
- 通过后 onegent 出现在 ChatGPT Apps marketplace (Discoverability 解锁)

================================================================
Recent Updates - 2026-04-26 (cont. 4) · Worker → Railway migration (Sprint 1 #1 shipped)
================================================================

Booking-autopilot 执行层从 Vercel serverless 整体搬到了 Railway 长进程
容器。这是 Sprint 1 路线图的第一块——拆掉 Vercel 5min 函数硬上限对真
booking 流程的杀伤，让 worker 可以跑任意时长的 Playwright 任务，并把
unit economics 从"按 Browserbase 浏览器分钟计费"切换成"按 Railway 容
器小时计费 + 简单站本地 Chrome 免费"。

【根本动机 — stagehand-executor.ts 实证】
- Vercel maxDuration=300s < 代码里 BROWSER_TASK_TIMEOUT_MS=420s,
  浏览器"正常超时"已超 Vercel kill 时间, job 频繁烂尾
- 强制 Browserbase (line 426-440 hard fail), 按浏览器分钟计费,
  10k 单/月 ≈ 333 小时浏览器时间, unit economics 跑不通
- USE_REAL_CHROME_FOR 本地 Chrome 路径 chromium ~200MB 超 Vercel 250MB
  lambda 上限, Vercel 上根本启动不了

【架构 — 新】
```
Vercel (picksy)                       Railway (worker)
─────────────────                     ──────────────────
POST /api/booking-jobs/[id]/start  →  while(!shuttingDown) {
  if step.type ∈ USE_WORKER_FOR        const job = await claimOne()  // FOR UPDATE SKIP LOCKED
     && body.__source = lib/core         await runJob(job)            // → runExecutionJobWithRecovery
  → return 202 (status='pending')    } // bounded MAX_CONCURRENT_JOBS=2
  else: legacy in-process exec       // setInterval 60s: processScheduledRetries
```

Postgres `booking_jobs` 表当队列, FOR UPDATE SKIP LOCKED 防 double-claim
across instances. 不引入 Redis / SQS / Inngest 任何额外依赖.

【路线决策 — 都按推荐执行】
- 灰度策略: binary on/off + per-scenario 分阶 (USE_WORKER_FOR=restaurant
  先, hotel/flight/activity 等 restaurant 跑稳后扩). 跳过 percentage
  rollout — 0 真实用户阶段 cargo cult.
- 状态机: 复用现有 `pending` 不加 `queued` — DHH/Solid Queue 一贯思路,
  零 schema 改动零 UI 改动, 语义完美对齐.
- 并发模型: in-process bounded MAX_CONCURRENT_JOBS=2, 不开 multi-instance.
  patio11 风格 — 早期正确性 > 吞吐.
- 双份代码: lib/booking-autopilot/ 整个 fork 到 worker/src/, 30 天后
  (DELETE_BY: 2026-05-26) 删 lib/ 那份回归单源. 期间 USE_WORKER 没
  覆盖的 scenario 用 lib/, 覆盖的用 worker/src/.

【D1-D5 拆解】
- D1 (commit 2707299) — 拆 worker/ 骨架 + Dockerfile + 主轮询
  - worker/ standalone npm 项目 (不进 monorepo workspaces, Docker 干净)
  - tsconfig paths 把 @/lib/* 重映射到 ./src/*, copy 来的 ~17800 行 lib
    代码一行不用改
  - Dockerfile base: mcr.microsoft.com/playwright:v1.58.2-noble
    (chromium 预装, ~200MB)
  - 用 tsx 跑 TypeScript 源码 (不预编译), 8 行手写 dotenv-lite 本地
    .env.local 加载
  - 验证: npm start 连 Neon, 每 10s "no jobs" 日志

- D2 (commit bdb3f3d) — Vercel 灰度门 + worker claim/run
  - app/api/booking-jobs/[id]/start/route.ts:1059-1093 加 USE_WORKER_FOR
    + per-step __source marker 双门控. mismatch 自然 fallthrough 老路径,
    零回归.
  - worker/src/index.ts: claimOne() FOR UPDATE SKIP LOCKED + runJob()
    复刻 route.ts 的 parallel-vs-sequential 切分 + serialized DB writes
    + bounded concurrency + 10min 单步 hard timeout (Promise.race) +
    SIGTERM graceful drain (60s)
  - lib/core/execution/runExecutionJobWithRecovery 直接被 worker 复用,
    600 行 orchestration 不重写.

- D3 (Railway dashboard 操作) — 部署上线 + smoke test
  - Railway service 创建, Root Directory=worker, env vars 9 个
  - 首次 deploy 翻车: service 自动命名 @onegent/mcp-server 触发 Railway
    的 npm workspace 自动检测, start command 被注入 --workspace= flag,
    container crash loop. 修法: Settings → Deploy → Custom Start Command
    显式设 npx tsx src/index.ts.
  - Browserbase 第一次 retry 撞 402 free plan minutes exhausted. 修法:
    USE_REAL_CHROME_FOR=opentable,resy,yelp 切本地 chromium (Docker
    image 自带), 餐厅 scenario 完全免 Browserbase.
  - smoke test: Carbone NYC OpenTable booking → worker pick up →
    OpenTable not found → Resy not found → Google Places 找到官网 →
    handoff URL 到 carbonenewyork.com. 完整 fallback chain ✅

- D4 (commit 24bf415) — Scheduled retry scanner 进 worker
  - worker/src/index.ts setInterval 60s 扫 retryScheduledFor ≤ now 的
    step, 重置到 pending, main loop 自然 claim. 不需要 HTTP fire-and-
    forget (worker 反正在 polling).
  - Vercel /api/cron/retry-jobs **保留** 30 天 fallback (USE_WORKER_FOR
    没覆盖的 scenario 还需要它). 两路共存, FOR UPDATE SKIP LOCKED 防
    double-claim.

- D5 (this section) — release notes + memory + 30 天规则
  - PROJECT_SUMMARY v0.2.53.0
  - CLAUDE.md 加 "Booking-autopilot 双份代码规则 (DELETE_BY: 2026-05-26)"
  - infra_stack memory 更新 worker host = Railway

【经济账】
- Vercel: $0 (免费 Hobby, picksy 项目不变)
- Neon: $0 (免费, 同前)
- Clerk: $0 (Hobby, 同前)
- Railway: ~$5-10/mo (单 1GB 容器, 24/7)
- Browserbase: $0 (free 用完, 餐厅 scenario 已切本地 Chrome; 酒店/机票
  scenario 还在 Vercel 老路径用 Browserbase, 后续灰度时再决定升级 Pro
  还是接受失败率)
- 总: ~$5-10/mo, 比之前纯 Vercel + Browserbase free-tier-ceiling 模式
  既便宜又能跑长时间任务

【未完成 — 留 Sprint 1 后续】
- USE_WORKER_FOR 扩到 hotel/flight/activity (需要先 Browserbase Pro
  或者验证这些站本地 Chrome 抗性)
- Vercel /api/cron/retry-jobs + lib/booking-autopilot/ + start route 老
  in-process 段 30 天后清理
- worker healthcheck endpoint (Railway 已直接监控进程, 优先级低)

【阻塞点】
- Browserbase Pro $99/mo 升级时机 — 需要真有付费用户或者 hotel/flight
  scenario 真上线时再决定
- Cofounder / 早期合伙人搜索 — 6 个月独干会燃尽, Lane A+C 双线压力
- B2B Lane C 验证 — 4 个客户类型 × 5 contacts cold outreach 还没启动

================================================================
Recent Updates - 2026-04-26 (cont. 3) · @onegent/mcp-server v0.1.0 published to npm
================================================================

Backlog #21 终于落地 — `@onegent/mcp-server@0.1.0` 上架 npm registry，
任何 Claude Desktop / ChatGPT Apps / 其他 MCP-compatible LLM 用户从今天
起可以 `npx -y @onegent/mcp-server` 一行调起 onegent travel booking
agent 的 stdio / Streamable HTTP 接口。

发布前修了一个 critical 错配 — 代码里所有 hardcode 的 `onegent.com`
其实是别人的域名（早期 placeholder 抄过来一直没改），实际生产域名是
`onegent.one`（Porkbun 注册）。MCP 包默认 base URL、README、ChatGPT
Apps manifest、developers landing 页面的 curl/fetch 演示、文档教程里
所有的 URL + email 全部一次性扫干净。

1. fix(domain): rename onegent.com → onegent.one (commit da800ba)
   - packages/mcp-server/src/api-client.ts — DEFAULT_BASE_URL
   - packages/mcp-server/src/index.ts — --help 文本
   - packages/mcp-server/README.md — 4 处 URL + 1 处 staging URL
   - packages/mcp-server/chatgpt-apps/manifest.json — icon/mcp.url/contact
   - docs/integrations/{claude-mcp,chatgpt-apps}.md — 教程 URL
   - app/developers/_components/CodePreview.tsx — landing 上展示的 demo
   - app/developers/_components/DevFooter.tsx — beta@onegent.one mailto
   - app/developers/pricing/page.tsx — beta access mailto + body copy
   - 顺手把 npm pkg fix 提示的 bin 字段 `./dist/index.js` → `dist/index.js`
     一起 commit 了

2. infra 准备
   - 域名 onegent.one 在 Porkbun，DNS 已经指向 Vercel picksy 项目
   - Porkbun email forwarding 配了 beta + support → gzw13979725269@gmail.com
   - Vercel env vars 补齐 OPENAI/GEMINI/GOOGLE_GENERATIVE_AI/
     BOOKING_ENCRYPTION_KEY/CRON_SECRET 5 个缺失项；NEXT_PUBLIC_APP_URL
     去掉末尾斜杠
   - Clerk production instance 创建（Clone development instance），
     phone auth 在 dev 关掉避免触发 Pro 计费墙
   - GitHub repo 改成 Private（保护核心 SaaS 代码不被竞品抄；npm 包
     的 dist/ 仍然公开发，因为这是 wrapper 必须开源用户才能装）

3. Vercel 触发 master push 自动 deploy（30 秒上线），smoke test
   `curl -X POST https://onegent.one/api/v1/execution-jobs` 期望 401
   missing_authorization → ✅ 实测通过

4. npm publish 流程
   - npm 账号: kakarottoooo (gzw139797256269@gmail.com)
   - @onegent npm org 已建（free Hobby 计划）
   - 2FA 走浏览器 SSO 流程发包成功
   - 验证: `npm view @onegent/mcp-server` shows v0.1.0, MIT, 21.3 kB
   - tarball 可下载: https://registry.npmjs.org/@onegent/mcp-server/-/mcp-server-0.1.0.tgz

剩下 backlog:
- #22 onegent.one/api/mcp hosted Streamable HTTP endpoint + ChatGPT Apps
  正式提交（5-10 天 review）
- #23 Claude.ai remote MCP OAuth 2.0 接入（2-3 天）
- worker 部署：booking-autopilot 当前还跑在 Vercel serverless 上（受
  250MB 限制，Playwright 跑不了），未来要拆到 Railway / Render

================================================================
Recent Updates - 2026-04-26 (cont. 2) · Phase C' — onegent-flavored session UX
================================================================

把 ChatGPT 通用风格的 "Sessions" 列表改成 onegent 自己的语义: 一个
session = 一次"找 trip 的探索过程"。Sidebar 分 Drafts (在聊还没敲定)
和 Completed (已经创建了 plan / trip), Completed 标 ✓ + scenario emoji
+ destination 副标。

不开 separate LLM endpoint — 复用现有 NLU result 抽 destination/scenario
就够了 (0 latency, 0 cost). title 不动, 因为副标 "🍽️ Manhattan" 已经
够给 onegent 味道, title 还是 first-message-80-chars。

1. lib/db.ts — chat_sessions schema 扩 5 列
   - upgraded_plan_id TEXT (sentinel "plan" 或 scenario 名,plan 没 DB record)
   - upgraded_trip_id TEXT (sentinel "trip")
   - destination TEXT (NLU-extracted, sidebar 副标)
   - scenario TEXT (NLU-extracted, sidebar emoji 选择)
   - completed_at TIMESTAMPTZ (任一 upgraded_* flip 时 stamp)
   - ALTER TABLE ADD COLUMN IF NOT EXISTS × 5 (向后兼容老表, 0 数据迁移成本)
   - 新 helpers: markSessionUpgradedPlan, markSessionUpgradedTrip,
     updateChatSessionMeta (动态 SET title / destination / scenario)
   - markSessionUpgraded (room) 也补 stamp completed_at = NOW()

2. app/api/chat/commit/route.ts — plan / trip 分支挂接
   - kind="plan" return 之前调 markSessionUpgradedPlan(sessionId, userId, scenario)
     (Q3 a: plan 创建即 completed)
   - kind="trip" return 之前调 markSessionUpgradedTrip(sessionId, userId)
   - kind="room" 沿用 markSessionUpgraded (现在带 completed_at)

3. app/api/chat/parse/route.ts — NLU result → metadata
   - syncSessionContext 后, 用 result.scenario + extractDestination(constraints)
     一并 updateChatSessionMeta (失败 swallow, 不阻塞 chat 链路)
   - extractDestination helper: 多 key fallback (destination/location/city/
     dest/arrival_city/neighborhood), 截 40 字符,数组取第一个

4. components/Sidebar.tsx — Drafts / Completed 分栏
   - SessionRow type 扩 5 字段 (upgraded_plan_id/trip_id/destination/scenario/completed_at)
   - SCENARIO_EMOJI 表 (restaurant 🍽 / hotel 🏨 / flight ✈ / activity 🎟 / trip 🧳)
   - sessionEmoji() / sessionSubtitle() helpers
   - filter 拆: drafts (无 upgraded_plan/trip) + completed (有任一 upgraded_plan/trip)
     room-upgraded 仍然 hide (Rooms 区显示, 避免 duplicate)
   - 渲染两个 SectionLabel: Drafts (顶部) + Completed (下方,有 ✓ 标)
   - SidebarRow subtitle 显示 destination 或 "Completed"

效果:
- Sidebar 不再是平的 "Sessions" 列表,分了 Drafts / Completed 两栏
- 每条 session 自动带 scenario emoji (🍽 / 🏨 / ✈ / 🎟 / 🧳),不再统一 💬
- 有 destination 抽到的 session 副标显示 "Manhattan" / "Tokyo" 等
- 完成 plan/trip 后 session 自动归档到 Completed + ✓ 标

跟 ChatGPT 区别:
ChatGPT 的 sidebar 是平的 "Today / Yesterday / Last 7 days" 时间分组,
对话的"完成度"概念缺失 (因为它没有"任务完成"这个产品语义)。
Onegent 的 sidebar 反映"找 trip 探索过程的状态" — Drafts 是在聊,
Completed 是已经下决定了。这个分栏在 Brian Chesky / Tobi Lütke 的
"产品语义优于通用模式"哲学下是 onegent 真正的护城河。

向下兼容: ALTER TABLE ADD COLUMN IF NOT EXISTS, 老 session row 5 个
新 column 都是 NULL → 全部归入 Drafts (不会突然消失). 旧的
markSessionUpgraded(roomId) call 仍工作 (room session 仍走 hide 路径).

typecheck pass / lib + components 测试 609/611 (2 pre-existing failures
in lib/__tests__/ai-loop.test.ts + scenario2.test.ts, 跟 chat session
完全无关 — 已 git stash verify, 是 booking-autopilot/ai-loop 和 booking-
links 的旧问题, 留 backlog 不在 Phase A/B/C 范围)

================================================================
Recent Updates - 2026-04-26 (cont. 1) · Phase B' — NLU state 持久化跨会话
================================================================

Phase A (chat 视觉重构) 之后立刻接 B'. 目的: 解决"用户从 sidebar 点回
旧 session,extractor 看不到之前抽出的 constraints"——这是 Claude.ai 之
类成熟产品的隐性体验, onegent 没做就是"agent 健忘"。

之前架构: nluHistoryRef 把 stringified NLU JSON 塞进 history 的 assistant
content,extractor 看到时反向 reconstruct 部分 state. 算 hack,refresh
后会丢。这次改成真正的 nlu_state JSONB column 持久化。

1. lib/db.ts — chat_session_messages 加 nlu_state JSONB
   - ChatSessionMessageRow 加 nlu_state?: unknown 字段
   - ensureChatSessionMessagesTable: CREATE TABLE 含 nlu_state JSONB
     + ALTER TABLE ADD COLUMN IF NOT EXISTS (兼容老表)
   - insertChatSessionMessage 加可选 nluState 参数, JSON.stringify 后
     用 ::jsonb 插入
   - listChatSessionMessages SELECT 加 nlu_state 列

2. app/api/chat/parse/route.ts — prev_nlu_state in / __v2_state out
   - body 解析加 prev_nlu_state (JSON object), 传给 analyzeConversationalV2
     的 prev_state 参数 (extractor 已支持 merge 模式)
   - syncSessionContext 接 nluState 参数, 持久化到 assistant message
     的 nlu_state 列 (来自 result.__v2_state)
   - syncRoomContext 不需改 (room 已经 upsert IntentState 到
     room_member_intent_state 表)

3. app/page.tsx — client side hydrate
   - 加 lastNluStateRef (useRef<unknown>) 存最后一条 assistant 的 IntentState
   - session-replay 拉 nlu_state 从 messages 反向 walk 找最近一条
     assistant 的 nlu_state, 写入 ref
   - /api/chat/parse fetch body 加 prev_nlu_state: lastNluStateRef.current
     (条件展开,无值时不发)
   - 收到 result 后 if (nlu.__v2_state) lastNluStateRef.current = nlu.__v2_state
   - clearChat / handleConfirmCommitted 时 reset lastNluStateRef = null

4. B'2: hero 渐隐 — verify 后判断保持现状
   - 现状: !hasMessages 条件渲染 hero (line 2282), 一旦发消息 hard cutoff
   - URL ?session_id replace 已经在做 (line 805)
   - 已符合 Q5(c) "对话开始 = hero 让位" 目的
   - fade-out 改动需 wrapper + delay state + 400ms timer, 在 page.tsx
     3300 行内 risk 高 / 收益低 (用户发消息后视线在 input,看不到 hero
     消失). Claude.ai 自己也是 hard cutoff. 留低 ROI backlog

效果: 跨 session 切换 / 浏览器 refresh 后, NLU 仍然记得之前抽出的
scenario / constraints / member_names 等. 不再是"接着聊却像第一次见面"。

向下兼容: ALTER TABLE ADD COLUMN IF NOT EXISTS, 老表自动加列. 旧
session 没 nlu_state 行的 message — fetch 后 lastNluStateRef 仍是 null,
parse 不发 prev_nlu_state body, server 当作新对话处理 (extractor 自己
能从 history 部分恢复). 零数据迁移成本.

typecheck pass / lib/agent/nlu-v2 88/88 测试 green

下一步 (Phase C' 已规划):
  C'3: chat_sessions 加 destination/scenario/upgraded_plan_id/
       upgraded_trip_id 列 (基础 schema)
  C'1: NLU async 抽 destination → PATCH session title
  C'2: Sidebar 改成 Drafts/Completed 分栏 + ✓

================================================================
Recent Updates - 2026-04-26 · Phase A — 主页 chat 链路 Claude.ai 风格重构
================================================================

用户反馈"对话 UI 不够好看,金色 bubble 像茶饮店"。深入产品级讨论后
拍板: 走 Claude.ai 路线 (去 bubble + 大字 + 大留白) + onegent-flavored
session UX (路线 4: 一个 session = 一次"找 trip 的过程"). 整体 ABC
分 3 个 Phase, 这次只做 Phase A (chat 视觉重构).

audit 中发现关键事实: chat_sessions DB schema + API + Sidebar 都已
存在 (B 阶段大部分已实现, 之前 plan 严重 over-estimate). ConversationalChat.tsx
是 358 行的孤儿组件 (主页直接在 page.tsx 写 chat,从来没用过), 顺手删掉.

1. 新建 components/chat.css (340 行) — 跟 cards.css/tasks.css 一致的
   page-scoped BEM module. 复用 globals.css 的 9-step ink + spacing/
   radius/shadow/motion token. 设计哲学:
   - 去 bubble (Claude.ai 2024 删 bubble 是因为 content 才是产品)
   - 用户消息: 细灰边框 + 暖 cream 底 (var(--ink-1)) + 16 radius
     symmetric (无 iMessage tail), 不再黑底/金底实心
   - Assistant: 完全无容器, 直接 ink-7 文字
   - 字号 13 → 15 (text-md), 行高 1.5 → 1.65 (lh-relaxed)
   - 消息间距 8 → 24 (space-6)
   - Quickpicks: 12px 灰胶囊 → 14px chip + hover gold border + lift
   - Submit: 圆形 floating + linear-gradient(gold, gold-strong) + scale(1.04) hover
   - Mic: silent default (gold border on hover), listening 才 gradient
   - Input: 13px → 15px, focus gold border + gold-glow shadow
   - ConfirmCard: 16px radius, gold-gradient CTA, ghost edit 按钮

2. app/page.tsx chat 区域 inline style 全清 (~144 行净减)
   - 用户 bubble 黑底/金底 iMessage tail → chat-msg chat-msg--user
   - assistant <p> gray 13px → chat-msg chat-msg--assistant + stack wrapper
   - Quickpicks 12px 灰胶囊 → chat-quickpicks/chat-quickpick
   - Bottom bar div + input + mic + send + new-chat → chat-bottombar
     系列 BEM
   - Thinking indicator inline → chat-thinking
   - 移除 activeRoomId-based bubble 颜色分支 (room 模式不再用 gold
     实心 — 统一去 bubble 让 thread 视觉一致)

3. components/ConfirmCard.tsx 16 处 inline style → BEM (~119 行净减)
   - CARD_STYLE/PILL/PRIMARY_BTN/GHOST_BTN 4 个 const → confirm-card
     系列 BEM (confirm-card/__pills/__pill/__summary/__hint/__warn/
     __rows/__row-key/__row-value/__error/__cta-row/__cta-primary/__cta-ghost)
   - 沿用 cards.css 的 :where() 共享 chrome 设计哲学
   - CTA: linear-gradient(gold, gold-strong) + translateY(-1px) hover
   - Ghost edit: gold border on hover

4. 删孤儿 ConversationalChat.tsx (358 行)
   - grep 确认 prod code 0 引用 (只有 doc 注释 + nlu-v2 alias 注释)
   - 同步清理 lib/agent/nlu-v2/index.ts 和 types.ts 的 doc 注释 (改"homepage chat")
   - 减债 358 行 — 之前被 stale plan 误以为是当前 chat 入口

净改动: -541 行删 / +340 chat.css / 总 -201 行 (代码瘦身)
typecheck pass / RecommendationCard 11/11 测试 green

下一步 (Phase B' + C' 已规划):
  B'1: chat_session_messages 加 nlu_state JSONB column, parse 端点
       接受 prev_nlu_state, 加载历史时 hydrate (Q4 b 选择)
  B'2: verify + 微调 hero 渐隐 (Q5 c 选择)
  C'1: NLU async 抽 destination → PATCH session title
       (从 "Tokyo trip..." → "Tokyo · Apr 24-28")
  C'2: Sidebar 改成 Drafts/Completed 分栏 + ✓
  C'3: chat_sessions 加 destination/scenario/upgraded_plan_id/
       upgraded_trip_id 列 (Q3 a: plan 创建即 completed)

================================================================
── 历史归档（2026-04-25 cont.13 及更早） ─────────────────────────

已迁移到 [PROJECT_SUMMARY_ARCHIVE_2026Q1.md](./PROJECT_SUMMARY_ARCHIVE_2026Q1.md)

涵盖 Stage 2 / Week 2-6 / lib/core 抽象 / B 端基础设施 /
Phase 0 customer UI / pre-existing test 修复 / Positioning Shift
/ Week 4 #2 MCP connector / Week 4 #3 /developers landing /
Week 5 #1-3 NLU 直订 + ship audit / Week 6 #1-2 hotel/flight/
activity 接进 lib/core / Stage 2 T11 落地 / 2026-04-18 ~ 04-23
完整 release notes。

查找历史 commit hash / 决策路径 / 具体改动细节请去归档文件。

================================================================
