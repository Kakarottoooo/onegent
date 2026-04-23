================================================================
Trip Packaging 计划 · v1.0 · 2026-04-22
================================================================

本文档定义 Onegent 从"单品类 autopilot"演进到"跨品类 trip 打包 +
多人混合决策房间"的完整路径。

**阅读指南**
- 想快速了解要做什么：读 "一、Vision" + "三、Stage 1 任务列表"
- 想知道为什么这样做：读 "二、现状诊断" + "六、决策记录（ADR）"
- 改代码前必读：读 "三、Stage 1" 完整 + "四、Stage 2" 的数据契约
- 本计划配合 `PROJECT_SUMMARY.md` 和 `CLAUDE.md` 使用，不重复这两份文档的内容

**状态**（截至 2026-04-23）
- ✅ Stage 1（单人 trip 打包）：已落地 — `lib/agent/planners/trip-package.ts`、
  `app/api/booking-jobs/create-trip/route.ts`、`components/TripPackageCard.tsx`、
  `app/api/chat/trip/*` 全部就位；NLU 三层现在是 `lib/agent/nlu-v2/`（v1 已删除）
- 🟡 Stage 2（多人混合房间）：设计已定，实现排在 Stage 1 实盘验收后，预估 2 周

> ⚠️ 本文档里提到 `lib/conversational-nlu.ts` 的位置均为历史快照（Stage 1 起草时）。
> 当前 NLU 入口在 `lib/agent/nlu-v2/`（三层架构），详见 `NLU_REFACTOR_PLAN_C.md` + `CLAUDE.md`。

================================================================
一、Vision 与实现目标
================================================================

【用户原话 · 2026-04-22】

> 我们 Decision Room 的设计是多人在多方面的 UI 和填空输入框里填信息来做决策，
> 而我想要的是多人在主页和 agent 对话，用自然语言来代替手动输入那些条件，
> 从而执行 Decision Room 的 task 比如预定酒店、机票、餐厅、活动。
>
> 第二，我们现在只是实现了主页的单独的活动，比如我让 Onegent 订机票，
> 他给我返回结果，然后预定；我让 Onegent 订酒店，他给我返回结果卡片，
> 我选择然后预定。而我构想的是：一套流程，我和 Onegent 说我要去 NY 旅行，
> 它自动帮我从这四个维度同时进行，在收集完信息之后，帮我直接同时订酒店、
> 机票、预定餐厅、活动推荐买票。这是我的打包功能。
>
> 把这个跑通了再扩展到 Decision Room 来解决多人的一键打包 trip 活动。

【目标拆解】

A. **单人 trip 打包**（Stage 1，本文档主体）
   - 用户在首页 chat 说 "I want to go to NY for 3 days"
   - Agent 多轮对话收齐必要信息（目的地、日期、出发地、人数、预算档、活动兴趣）
   - Agent 并行调用 hotel + flight + restaurant + activity 四条 pipeline
   - 产出 3 tier trip package（Upscale / Trendy / Local）
   - 用户选一个 tier → 一键启动多 step autopilot → 同时下单 4 个品类
   - 在 PCI iframe 边界分别暂停（4 个 paused_payment），用户刷卡完成

B. **多人混合决策房间**（Stage 2，本文档末尾 "四、" 章节）
   - 每个成员和同一个 agent **私聊**说偏好 / 约束 / 安排
   - Agent 匿名聚合 → 生成符合多人利益的 trip 方案
   - 房间内有**公开频道**（像现在 Decision Room）用于交流讨论
   - 大家对 tier package 投票（unanimous / majority），通过后一键打包下单
   - 默认私密，主动共享（"Share to room" 按钮才广播）

【不做的事（明确排除）】

- 不重构现有单品类 chat 流程（restaurant / hotel / flight / activity 独立场景继续可用）
- 不动现有 Decision Room 单品类表单入口（保留作为降级路径）
- 不做 "代付钱包"（PCI iframe 边界的绕过方案）——超出本阶段
- 不做跨城市多日跳点 trip（例如 NY → Boston → Chicago）——当前只做单城市多日

================================================================
二、现状诊断（2026-04-22 快照）
================================================================

【已有基础设施（约 60% 铺好）】

1. `city_trip` / `weekend_trip` 规划器存在且工作
   · 位置：`lib/agent/parse/city-trip.ts`、`lib/agent/planners/city-trip.ts`
   · 能力：chat 里并行调 hotel + restaurant + bar，输出 3 tier 展示包
   · 缺口：产物是**展示用** DecisionPlan，不生成 booking job，无法一键下单

2. BookingJob 已支持多 step 多品类
   · 位置：`lib/db.ts:642-687`
   · Schema：`BookingJob.steps: BookingJobStep[]`
     可以包含 `[flight_step, hotel_step, restaurant_step, activity_step]`
   · 缺口：`/api/rooms/[id]/execute` 和 chat commit 只会 build 单 step

3. NLU 已声明 "trip" 意图
   · 位置：`lib/conversational-nlu.ts:32`
   · 缺口：`/api/chat/commit/route.ts:402` 显式拒绝 `scenario === "trip"`

4. 4 个 per-category pipeline 全部 ready，可并行
   · `lib/agent/pipelines/{restaurant,hotel,flight,activity}.ts`
   · 无共享 state，签名不统一但能独立调用

5. Real Chrome profile 分支已跑通（DataDome 绕过）
   · 位置：`lib/booking-autopilot/core/real-chrome.ts`
   · 活动类 booking（SeatGeek）必须走这个分支

【缺口清单】

| # | 缺口 | 阻塞什么 |
|---|------|---------|
| G1 | `/api/chat/commit` 硬拒绝 trip | 整个 trip 流程过不了 commit |
| G2 | `DecisionRoomType` 枚举无 "trip" | DR 无法承载多品类 |
| G3 | `city_trip` 规划器不生产 booking job | 看得到推荐但无法下单 |
| G4 | `/api/rooms/[id]/execute` 只 build 单 step | 即使有 trip room 也不会并行 autopilot |
| G5 | `ROOM_CONFLICT_CONFIGS` 无 trip 条目 | 多人 DR 无法合并 trip 约束 |
| G6 | 前端无 TripPackageCard 组件 | 3 tier UI 无法展示 |
| G7 | BookingJob.start 可能是 sequential 执行 | 4 step 不并行违背 "同时下单" 需求 |

================================================================
三、Stage 1：单人 Trip 打包（7–10 天）
================================================================

【核心用户故事】

> 用户：I want to go to NY for 3 days next weekend.
>
> Agent：Got it. To plan your trip I need a few details. I'll ask them all
> at once so you can fill in one message:
> - Where are you flying from?
> - How many people?
> - Budget tier (upscale / mid / budget)?
> - Any activities or events you want (shows, sports, museums)?
>   Leave blank and I'll suggest popular ones.
>
> 用户：From SFO, 2 people, mid budget, open to activity suggestions.
>
> Agent：[10s 并行抓 hotel + flight + restaurant + activity seeds]
> Here are 3 trip options for 2 people, SFO → NYC, Apr 25–28:
> [TripPackageCard with 3 tier switcher + Book this trip button]
>
> 用户：[选 Mid tier] → [Book this trip]
>
> Tasks 页面：4 个 step card 并行跑 → 各自到 paused_payment
>
> 用户：分别刷 4 次卡 → trip 完整订完

【设计决策（用户已确认）】

- **多轮追问**：一次列全所有缺失字段（不是每次问一个）
  · 原因：用户明确选择"体验像表单"胜于"体验像真人聊天"
  · 好处：轮次少、填写效率高；坏处：首次问题显得长
  · 实现：T3 状态机一次性列出所有 missing，用户在一条 reply 里补齐
- **Tier 结构**：保留 3 tier（Upscale / Trendy / Local）
- **Activity 可选**：NLU 无明确意图时推荐 2–3 个种子；用户表达兴趣后展开列更多

【Task 列表（严格按顺序执行）】

T1. NLU 识别 "trip" + missing-fields 检测
    文件：`lib/conversational-nlu.ts`
    工作量：0.5d
    产出：
      · NLU 对 "I want to go to NY" / "plan me a trip" 输出 `scenario: "trip"`
      · 提取已给字段（destination, dates, origin, travelers, budget, activities）
      · 返回 `missing: string[]`，标注哪些必填缺失
    验收：手测 10 种自然语言表达，全部正确分流

T2. Chat commit 解锁 trip 分支
    文件：`app/api/chat/commit/route.ts:402`
    工作量：0.5d
    产出：
      · 删除 `if (!scenario || scenario === "trip")` 的拒绝逻辑
      · 当 `scenario === "trip"` 时走新的 trip 分支（调用 T3 + T4 + T6）
    验收：chat commit 不再报 "Rooms require a concrete scenario"

T3. 多轮补全状态机
    文件：新建 `lib/agent/trip-intent-state.ts`
    工作量：1d
    产出：
      · `TripIntentState` 类型（见 T5）
      · `mergeTripIntent(prev, new)` 增量合并函数
      · `getMissingFields(state)` 返回缺失必填字段列表
      · `buildClarificationMessage(missing)` 生成**一次列全**的追问文案
      · 必填：destination, date_range, origin_city, traveler_count
      · 可选：budget_tier（默认 mid）、activity_interest、per-category prefs
    验收：单测覆盖 5 种 partial intent → 正确列出缺口 + 正确 merge

T4. TripIntent parser（增量）
    文件：扩展 `lib/agent/parse/city-trip.ts`
    工作量：0.5d
    产出：
      · 当前只解析首次输入；改成接受 "prev state + new message"，增量补充
      · 新增字段：`origin_city`（flight 必填）
    验收：多轮测试，每轮正确补全 1–N 个字段

T5. TripPackage 数据契约
    文件：`lib/types.ts` 添加 TripPackage 类型
    工作量：0.5d
    产出：
      ```typescript
      export interface TripPackage {
        destination_city: string;
        date_range: { from: string; to: string };
        origin_city: string;
        traveler_count: number;
        tiers: TripTier[];
      }
      export interface TripTier {
        tier_id: "upscale" | "trendy" | "local";
        tier_label: string;
        tier_description: string;
        hotel: HotelCard;       // 已存在
        flight: FlightCard;     // 已存在
        restaurants: RestaurantCard[];  // 2-3 个推荐
        activities: ActivityCard[] | null;  // null = 无活动意图时
        total_cost_estimate?: number;
      }
      ```
    验收：typecheck 通过；3 个下游 component（planner / card / booking builder）签名对齐

T6. 改造 city-trip planner 输出 TripPackage
    文件：`lib/agent/planners/city-trip.ts`
    工作量：1.5d
    产出：
      · 用 `Promise.all` 并行调 4 个 pipeline：hotel / flight / restaurant / activity
      · 对每个 tier 从候选池里挑符合 tier 风格的一个 hotel + 一个 flight +
        2-3 个 restaurant + (optional) 1-2 个 activity
      · Activity 选择逻辑：
          - 有 activity_interest：用 seatgeek + ticketmaster 并行抓 + activity-merge
          - 无 activity_interest：推荐 2-3 个种子（concerts / sports / musicals），
            标记 `suggested: true` 让前端显示 "Interested? Tell me which" CTA
    验收：实盘 3 个场景（NY / LA / Chicago）× 3 tier，全部产出完整 package

T7. Activity 推荐种子 + drill-down
    文件：planner 内部 + 复用 `lib/agent/pipelines/activity.ts`
    工作量：0.5d
    产出：
      · 种子推荐模式：每城市最多 3 个（1 concert + 1 sport + 1 theater）
      · Drill-down：用户在 TripPackageCard 点 activity card →
        NLU 记录兴趣 → 下一轮自动抓更多同类
    验收：NY 无意图 → 返回 Hamilton + Knicks + SNL 种子

T8. TripPackageCard 组件
    文件：新建 `components/TripPackageCard.tsx`
    工作量：1.5d
    产出：
      · 顶部：destination + dates + traveler count
      · 中部：3 tier 横向切换器（tab 或 segment control）
      · 每 tier 内部：4 张子 card（hotel / flight / restaurant / activity）
        · 子 card 复用现有 HotelCard / FlightCard / RestaurantCard / ActivityCard
        · 每张子 card 右上角显示 "核心项 / 可选项" 标记
      · 底部：一个大按钮 "Book this trip" + 小字 "Total est. $X"
      · 响应式：桌面 4 张横排，移动端 2×2 或纵向
    验收：3 tier 切换流畅；所有子 card 原有交互（查看官网等）保留

T9. 多 step BookingJob builder
    文件：新 API `app/api/booking-jobs/create-trip/route.ts`
    工作量：1d
    产出：
      · 请求：`{ session_id, trip_package, selected_tier_id }`
      · 从 selected tier 提取 4 张子卡
      · 每张子卡 map 成一个 BookingJobStep：
          - type: "flight" / "hotel" / "restaurant" / "activity"
          - apiEndpoint: 对应品类的 autopilot 启动 endpoint
          - body: 子卡的预订参数
          - fallbackUrl: 子卡的官网直链
      · 创建 BookingJob，写入 DB，返回 job_id
    验收：一个 Mid tier → 1 个 BookingJob with 4 个 steps

T10. BookingJob start 改为并行执行
    文件：`app/api/booking-jobs/[id]/start/route.ts`
    工作量：1d
    产出：
      · 确认当前是 sequential 还是 parallel（先读代码）
      · 如果 sequential：改成 `Promise.allSettled` 并行启动 4 个 step
      · 每个 step 有独立 Playwright browser context（已有能力）
      · step 间不共享 state；一个失败不影响其他
    验收：实盘 4 step 同时启动（Tasks 页面看到 4 个同时进入 running 状态）

T11. Tasks 页展示 trip 多 step
    文件：`app/tasks/page.tsx`（已有 focus 能力）
    工作量：0.5d
    产出：
      · 识别 BookingJob.steps.length > 1 的情况（trip job）
      · 顶部展示 trip 摘要（destination / dates / tier）
      · 下方 4 个 step card 纵向排列，每个独立 status + decision log
      · paused_payment 时 4 个 step 分别显示 CVV 提示
    验收：trip job 打开 Tasks 页，4 step 卡片清晰展示

T12. 部分失败 UX
    文件：Tasks 页 step card + retry 按钮
    工作量：0.5d
    产出：
      · 1 个 step 失败时，其他继续跑，不联动失败
      · 失败 step 旁 "Retry" + "Book on <site> manually" 备选链接
      · Trip job 整体状态：all_success / partial_success / all_failed
      · partial_success 时 UI 显示："Your hotel and flight are ready,
        but restaurant booking failed. Here's the fallback link."
    验收：手动制造 1 个 step 失败 → 其他 3 个完成 → UI 正确展示混合状态

T13. 实盘端到端
    文件：-（手测）
    工作量：0.5d
    产出：
      · 测试用例："Plan me a 3-day NY trip next weekend, flying from SFO,
        2 people, mid budget, I love Broadway"
      · 10 分钟内看到 TripPackageCard with 3 tiers
      · 选 Mid tier → 4 step job → 10 分钟内全部 paused_payment
      · 分别刷 4 次卡 → trip 完整订完
    验收：至少 2 个城市 × 2 次成功 E2E

【Stage 1 验收标准】

- 用户一句自然语言 "I want to go to X" → agent 完成信息收集 → 生成 3 tier
  package → 用户选 tier → 4 个 autopilot 并行 → 全部到 paused_payment 刷卡
  → 完成整个 trip 下单
- 总耗时（含用户填信息 + agent 思考 + autopilot 执行）控制在 20 分钟内
- 任意 step 失败不阻塞其他 step，用户能看到清晰的"哪些成功、哪些需补救"

================================================================
四、Stage 2：多人混合决策房间（方案 Y）
================================================================

【形态定义】

- 房间一开就有**两个频道**：
    1. 每个成员和 agent 的**私聊频道**（默认入口）
    2. 全员可见的**公开频道**（类似现在 Decision Room 的 messages）
- 成员在私聊里说偏好 / 约束 / 安排（"我预算紧"、"我不能去那几天"）
- Agent **匿名聚合** N 个成员的私聊数据 → 生成统一 trip package
- Agent 把 trip package 发到公开频道（所有人可见）
- 投票机制：现有 unanimous / majority 投 tier 粒度
- 通过后复用 Stage 1 的多 step BookingJob 一键下单

【核心 UX 原则】

> 默认私聊 + 有意识升到公开（fail-safe default）

- 进房默认展示私聊界面（像 homepage chat）
- 顶部明显 tab 切换到公开频道
- 私聊每条消息有 "Share to room" 按钮，点了才广播
- Agent 的合成方案作为**公开卡片**出现，不占用消息流
- 颜色区分：私聊背景色 vs 公开频道背景色明显不同，避免看错

【为什么选方案 Y】

- 真实场景：朋友间对敏感约束（预算、时间、不想一起多天）开不了口
- 私聊 + agent 聚合能拿到更真实信息
- 保留公开频道满足"大家交流讨论"的社交诉求
- Kent Beck "fail-safe default"：默认安全，共享需主动
- Linus "don't break userspace"：保留现有 DR 的公开交流能力，不强制走新流程

【Stage 2 任务（高层，Stage 1 验收后细化）】

S1. DB schema 扩展
    · 新表 `decision_room_private_messages`（room_id, member_id, content, ts）
    · `decision_rooms.type` 枚举加 `"trip"`
    · `decision_rooms.synthesis_json`（agent 聚合产出的 trip package）
    · `ROOM_CONFLICT_CONFIGS` 加 trip 条目

S2. 房间双频道 UI
    · `app/rooms/[id]/page.tsx` 加 tab 切换（My Chat / Room）
    · 私聊 component 复用首页 chat（同 NLU、同 trip planner）
    · 公开频道保留现有 messages UI

S3. 聚合 Agent
    · 新模块 `lib/agent/trip-synthesis.ts`
    · 读取所有 member 的私聊 TripIntentState（匿名化，不带 member 名）
    · 合并约束：用现有 room-conflict.ts 的合并逻辑扩展 trip 多维度
    · 调用 Stage 1 的 TripPackage planner 产出方案
    · 输出到 `decision_rooms.synthesis_json` + 公开频道通知

S4. 投票 + 执行
    · 复用现有 unanimous / majority 投票
    · 投 tier 粒度（不是 per-category 分开投）
    · 通过后调 Stage 1 的 `/api/booking-jobs/create-trip` endpoint
    · 多人场景下 payer 选定（可用现有 DR payer 机制）

S5. 共享语义设计
    · "Share to room" 按钮：把私聊消息 / agent 回复选择性广播
    · 共享时**标记来源**（"Shared by Alice"），避免匿名泄漏
    · 约束层面：agent 可以 anonymously 在公开频道说
      "Group average budget is mid-tier, 1 member has hard budget constraint"

S6. 隐私保证（非功能需求）
    · 私聊消息**永不自动**进入公开频道
    · Agent 聚合输出不包含"谁说了什么"，只包含聚合后的约束
    · 私聊消息 DB 层独立存储，权限严格

【Stage 2 工作量估算】

约 2 周。等 Stage 1 验收跑通后细化到 task level。

================================================================
五、Stage 间过渡 + 风险
================================================================

【Stage 1 → Stage 2 的资产复用】

- ✅ TripIntent state machine（T3）直接用于 Stage 2 私聊
- ✅ TripPackage 数据契约（T5）直接用于 Stage 2 房间聚合方案
- ✅ TripPackageCard 组件（T8）直接用于 Stage 2 房间公开频道
- ✅ create-trip booking job builder（T9）直接用于 Stage 2 payer 一键下单
- ✅ 多 step 并行执行（T10）直接用于 Stage 2 任务执行

Stage 2 本质上是 Stage 1 的"外挂多人协调层"，不改 Stage 1 的核心能力。

【已识别风险】

R1. **并行 autopilot 资源消耗**
    · 4 个 Playwright browser context 同时跑 → 本地 CPU / 内存压力大
    · 缓解：监控 T10 实盘时的资源占用，必要时加 concurrency 限流

R2. **Activity 种子推荐质量**
    · 种子如果太"mainstream"（所有 NY trip 都推 Hamilton）体验差
    · 缓解：T7 实盘 3 个城市验证多样性；预留用户 drill-down 回路

R3. **追问长度感知**
    · 用户选了"一次列全"，但 5 个字段一起问可能显得冗长
    · 缓解：T3 生成的 clarification message 用**列表格式 + 标注可选项**
      （例："Budget tier? (optional, defaults to mid)"）

R4. **部分失败的用户信心**
    · 4 个里坏 1 个，用户可能觉得"trip 没成"
    · 缓解：T12 UX 明确分类 all_success / partial / failed，
      partial 时突出"你已经搞定 3/4"的正面叙事

R5. **Stage 2 私聊 vs 公开的 UX 混淆**
    · 用户发消息时可能搞不清发在了哪个频道
    · 缓解：颜色区分 + 发消息前的 channel preview

================================================================
六、决策记录（ADR 精华）
================================================================

ADR-1. 选方案 A（Chat-Only）而非方案 B（Chat + DR 并轨）
    · 日期：2026-04-22
    · 背景：用户想要"单人 trip 打包 + 多人 DR 打包"两个能力
    · 决策：先方案 A（只做单人 chat trip 打包），验收后再扩 Stage 2 多人 DR
    · 理由：Kent Beck + Linus 混合打法；最小闭环快速验证，不动现有 DR
    · 被拒方案：方案 B（单人 + 多人同时上线，工期 8-12 天）
    · 被拒方案：方案 C（激进重构 DR chat-first，工期 15+ 天）

ADR-2. 保留 3 tier 结构（Upscale / Trendy / Local）
    · 日期：2026-04-22
    · 决策：不简化为"一个方案 + refine"
    · 理由：city_trip 已有 3 tier 实现，降低改动；3 tier 给用户选择感
    · 用户确认：是的

ADR-3. 多轮追问策略：一次列全（不是每次问一个）
    · 日期：2026-04-22
    · 决策：agent 第一次响应就列出所有缺失字段，用户在一条 reply 里补齐
    · 理由：用户明确偏好"体验像表单"胜于"体验像真人聊天"
    · 权衡：牺牲对话感，换取填写效率

ADR-4. Activity 可选 + 种子推荐
    · 日期：2026-04-22
    · 决策：NLU 无明确意图时推荐 2–3 个种子，不强塞 activity
    · 理由：出差 / 开会 trip 不需要活动；家庭旅游 / 度假需要
    · 实现：种子卡片显示 "Interested? Tell me which" CTA

ADR-5. 多人形态选方案 Y（Hybrid Always-On）
    · 日期：2026-04-22
    · 决策：私聊 + 公开房间双轨并存；默认私聊，主动共享
    · 理由：真实 group trip 的敏感约束需要私密通道；同时保留社交交流
    · 被拒方案：方案 X（Private-First 强制串行，流程太硬）
    · 被拒方案：方案 Z（Silent Digest 自动摘要，用户失控）
    · Kent Beck "fail-safe default" 风格

ADR-6. BookingJob.steps 并行而非串行
    · 日期：2026-04-22
    · 决策：4 个 step 用 Promise.allSettled 并行启动
    · 理由：用户核心诉求是"同时下单"，sequential 会让总耗时翻 4 倍
    · 风险：资源占用（见 R1）

================================================================
七、相关文档 + 代码入口
================================================================

【相关文档】
- `PROJECT_SUMMARY.md` — 项目全局架构和阶段演进
- `CLAUDE.md` — Booking Automation 三层架构规范（程序化 + AI 填表 + AI 验证）
- `DECISION_ROOM_TEST_PLAN.md` — DR 手测用例（Stage 2 实施时复用）

【Stage 1 关键代码入口】
- NLU 改造：`lib/conversational-nlu.ts`
- Chat commit 分支：`app/api/chat/commit/route.ts:402`（解锁点）
- Trip planner 改造：`lib/agent/planners/city-trip.ts`
- 新建状态机：`lib/agent/trip-intent-state.ts`
- 新建 TripPackage 类型：`lib/types.ts`
- 新建 API：`app/api/booking-jobs/create-trip/route.ts`
- 新建组件：`components/TripPackageCard.tsx`
- BookingJob 并行执行：`app/api/booking-jobs/[id]/start/route.ts`
- Tasks 页多 step 展示：`app/tasks/page.tsx`

【Stage 2 关键代码入口（预估）】
- DB schema：`lib/db.ts`（加 trip 类型 + 私聊表）
- 房间双频道：`app/rooms/[id]/page.tsx`
- 聚合 agent：新建 `lib/agent/trip-synthesis.ts`
- 房间冲突配置：`lib/agent/scenario-configs/room-conflict.ts`

================================================================
八、下一步 · 立即行动
================================================================

1. 本计划提交到 git（与 PROJECT_SUMMARY.md 同级）
2. 在任务系统创建 T1-T13 追踪记录
3. 开工 T1（NLU 识别 trip + missing-fields 检测）
4. 每完成一个 task 在任务系统 mark completed
5. T13 验收通过后，本文档 "Stage 2" 章节细化到 task level

================================================================
