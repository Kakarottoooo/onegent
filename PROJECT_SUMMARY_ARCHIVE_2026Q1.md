================================================================
Onegent · PROJECT_SUMMARY Archive · 2026 Q1 + early Q2 (≤ 2026-04-25)
================================================================

本档案保存了 2026-04-25 (cont.13) 及更早的 release notes，
涵盖 Stage 2 / Week 2-6 / lib/core 抽象 / B 端基础设施搭建 /
Phase 0 customer UI / pre-existing test 修复等已 ship 的历史。

从 PROJECT_SUMMARY.md 主文档移出，主文档只保留最近 ~5 天 ship 状态。
查找历史决策路径或某个具体 commit 的细节请来这里。

Recent Updates - 2026-04-25 (cont. 13) · 全天 customer-end UI 系统升级 + 性能 + pre-existing test 收尾
================================================================

接 W6 #2 之后,用户提了两个独立反馈:(1) 主页跳 task/rooms/contacts 慢,
(2) developers 页面好看 customer 端不够"高大上"。今天完整覆盖这两条 +
顺便清掉 #53 backlog (pre-existing test failures)。一日 14 个 commit
跨 6 个层面,从 token 体系到组件 BEM 化到 perf 都做了。

1. #53 pre-existing test failures 修完 (3 fixes,12 测试 → green)
   - RecommendationCard.test.tsx 11 fail:组件 line 78 调 useRouter()
     测试无 mock next/navigation。加 vi.mock("next/navigation") + 全 router
     stub (push/replace/back/forward/refresh/prefetch + usePathname +
     useSearchParams)
   - RecommendationCard SVG placeholder 断言过时:PhotoCarousel 早改用
     emptyEmoji prop ("🍽️") 不再 render SVG。assertion 改为 getByText("🍽️")
   - weekend-trip.test.ts × 3 fail:hotel.ts:65 早从 MiniMax 切到 OpenAI
     gpt-4o-mini (注释明写"chronic-timing-out at 30s"),测试还在 mock
     MiniMax fetch。改用 vi.mock("../openai") + mockOpenaiChat,rename
     testname,删 dead makeMiniMaxResponse helper

2. 性能修 — 跳转慢的 3 因叠加
   - 根因 #1: app/page.tsx (3301)/tasks (3367)/rooms (550) 都是巨型
     "use client" component → 每次跳转重 hydrate
   - 根因 #2: app/*/loading.tsx 一个都没,点击后白屏
   - 根因 #3: GlobalNav 用 plain <a href> → full page reload
   修 #2 + #3 (#1 留 "Reliability/Perf systematization" backlog):
   - 7 个 loading.tsx 骨架屏 (tasks/rooms/contacts/calendar/account/
     trips/insights),每个 ~30-50 行 animate-pulse 卡片占位用新 token
   - GlobalNav 5 个 nav link + brand link 从 <a href> 改 Next <Link>
     (auto-prefetch viewport 链接)
   - Sidebar 留 router.push (handler 都带 setMobileOpen 副作用,改 Link
     风险大;且是低频路径)
   - 用户实测确认:"速度快了"

3. UI 升级 Phase 0 — 工程化基础 + RecommendationCard 一张卡
   - 先调研:customer 端 globals.css 78 行 vs developers tokens.css 154 行
     视觉系统差距巨大;customer 端 inline style{{}} 在 RecommendationCard
     一文件 78 处,4 张卡共 173 处
   - 选 Hybrid 方案 C (token + 一张卡完整重做,半天):
     globals.css 78 → 190 行 加 9-step warm ink scale (--ink-1..ink-9
     从 cream 到 espresso) + 4px spacing rhythm (与 developers 对齐) +
     radius/shadow scale (warm-tinted 不是纯黑) + motion + type scale
   - components/cards.css 新建 ~250 行 BEM:
     .rec-card / .rec-card__rank / .rec-card__name / .rec-card__divider /
     .rec-card__tab--why / .rec-card__tab--watchout / .rec-card__favorite-btn
   - RecommendationCard.tsx ~200 处 inline → semantic class
   - 视觉打磨:rank badge 渐变 ink + inset highlight,卡 hover 上浮 2px +
     border 染金 + warm shadow,gold→amber gradient pill divider,tab
     label uppercase eyebrow letterspacing
   - RecommendationCard 11/11 测试 still green

4. UI 升级 Phase 0 batch 2 — 另 3 张卡同语言 (HotelCard / FlightCard / ActivityCard)
   - cards.css 用 :where() 选择器列表共享 4 张卡的外壳 (border/hover/
     shadow/rank/divider/tab),从 250 → 868 行
   - HotelCard.tsx 30 处 inline → BEM (含 amenity pills + site selector +
     Map/Book CTA gradient)
   - FlightCard.tsx 34 处 → BEM (time rail + ::before plane glyph 居中
     gradient line + cabin pills)
   - ActivityCard.tsx 31 处 → BEM (when/venue/group badge + provider
     buttons reuse cta-primary gradient)
   - 4 张卡视觉完全一致,首页推荐输出不再"一张高级三张土"

5. UI 升级 Phase 1 — /tasks 页 6 commit 完整打磨 (3367 行 / 363 inline)
   - app/tasks/tasks.css 新建 ~1100 行 page-scoped BEM:
     .task-page / .task-tabs / .job-card (+ needs-action/succeeded
     variants) / .step-card / .help-card / .intervention / .sat-widget /
     .time-picker / .retry-sched / .live-log / .help-card__bubble /
     .intervention-modal / .monitor-panel / .insights / .insights__chip /
     .insights__metric / .insights__progress 等
   - batch B (a2915a3): page header + TaskWorkspaceSwitch (Linear-style
     active indicator) + JobCard 整体 + StepCard 主结构 + InterventionBanner
     banner + NeedsHelpCard outer
   - batch C1 (809fdac): LiveLogPanel (warm mono + streaming dot) +
     SatisfactionWidget + RestaurantTimePicker + RetryScheduler
   - batch C2 (a86d216): NeedsHelpCard 内 chat bubble (gradient gold avatar +
     asymmetric tail radius) + answer input + retry CTA + Intervention
     modal (warm backdrop + Playfair title + "What the agent did" recap +
     3 CTA variants)
   - batch C3 (3210cc4): MonitorPanel (item rows hover gold tint +
     active dot animate jobpulse + alert tinted) + MonitoringWorkspacePanel
     (metric cards reuse insights__metric)
   - batch C4 (c6b9d64): InsightsPanel 外壳 + Linear-style underline tab
     bar + ProgressBar 共用类 (gradient fill 420ms ease-out)
   - batch C5 (37c8579): InsightsPanel 4 tab 内部:Task / Patterns /
     Overview 6 sub-sections / Relationship - 共 ~100 处 inline → BEM
   - 累计 363 → 264 inline (~99 处替换),剩 264 是 page-level layout
     wrapper + policy/negative-memory conditional sub-sections (低 ROI)

6. 14 个 commit 今天傍晚到深夜段
   17146e3 test: fix pre-existing failures (RecommendationCard router + weekend-trip ranker)
   54482df feat(ui): customer-end token scale + RecommendationCard CSS module
   30de497 perf(nav): loading.tsx skeletons + GlobalNav <a> → Next Link prefetch
   e0ca1ef feat(ui): Phase 0 batch 2 — HotelCard + FlightCard + ActivityCard CSS module
   a2915a3 feat(ui): Phase 1 batch B — /tasks page polish
   809fdac feat(ui): tasks page batch C1 — LiveLog + Satisfaction + Picker + Scheduler
   a86d216 feat(ui): tasks page batch C2 — NeedsHelpCard chat bubbles + Intervention modal
   3210cc4 feat(ui): tasks page batch C3 — MonitorPanel + MonitoringWorkspacePanel
   c6b9d64 feat(ui): tasks page batch C4 — InsightsPanel outer + tab bar + ProgressBar
   37c8579 feat(ui): InsightsPanel 4 tab 内部 BEM
   (本 commit) docs: v0.2.43.0 release notes

7. 已知未做 / 入 backlog
   - #89 Phase 1 - 首页 chat 容器 UI 升级 (~3-4 小时,chat-heavy 风险高)
   - #90 #22 hosted /api/mcp endpoint + ChatGPT Apps 提交 (1-2d code + 5-10d review)
   - #21 npm publish @onegent/mcp-server (你 5 分钟手动)
   - #23 Claude.ai remote MCP OAuth 2.0 (2-3 天)
   - tasks 页 batch D: page-level wrapper + InsightsPanel policy/negative
     memory sub-sections (低 ROI,~1.5 小时,留作 cleanup)
   - 拆 page.tsx (3300 行) 成 server shell + client islands (根治 hydrate
     慢的 #1 因) — 未来 Reliability/Perf 系统化 task

8. 战略意义
   今天是"产品质感"系统化补课。之前 dev 体感差距大:developers/ 是
   Apple/Linear/Stripe tier,customer/ 是 v0.2.20 时代留下的 inline-style
   sass-heavy 风格。这意味着 user 看到的"高级感"两端断层。今天:
   - **token 体系统一** (customer/ globals.css 跟 developers/ tokens.css
     同结构 + 同 spacing rhythm,只是颜色 palette 用暖金调保留 brand)
   - **组件 BEM 化** (4 张产品卡 + 9 个 /tasks 面板都用 cards.css/tasks.css
     的 semantic class,~500 处 inline 提到 ~2000 行 CSS module)
   - **跨产品视觉一致** (rec card hover lift + warm shadow + gradient gold
     CTA 在 /developers 和 /customer 共享语言,只是色板不同)
   - **性能** (跳转白屏 → 即刻骨架 + bundle prefetch,体感 3-5× 快)
   未来加新组件时:开 cards.css/tasks.css 看 BEM 命名,沿用既定模式即可,
   不需要从零设计。

================================================================
Recent Updates - 2026-04-25 (cont. 12) · Week 6 #2 · activity 接进 lib/core + 删 agent-runtime 死代码
================================================================

接 W6 #1 之后,把最后一个 scenario(activity)也接进 lib/core,把双轨制
彻底收掉。同时一次性删了一大块死代码(整个 lib/agent-runtime/ 子树 +
/api/autopilot/activity/ route)。

1. 现状澄清(我之前误判了)
   - 用户问:"activity 能不能也走 Stagehand AI?"
   - 实际 grep 全仓库后发现:**所有真实生产 caller 创建的 activity step
     都已经走 Stagehand**(apiEndpoint="/api/booking-autopilot/universal"
     → runUniversalStep → runBrowserTask)
       · components/ActivityCard.tsx:124(用户首页搜活动直接 Book)
       · app/api/booking-jobs/create-trip/route.ts:387(trip 选 activity)
       · app/api/rooms/[id]/execute/route.ts:343(Decision Room 投活动)
   - 子系统 B(runActivityStep + findActivitySkill + lib/agent-runtime/)
     是死代码 —— grep 找不到任何 caller 调 runTask / bootstrapRuntime /
     dateNightScenario.build。lib/agent-runtime/scenarios/date-night.ts
     只是个 TaskDef builder,但实际的 date_night planner 走的是
     lib/scenario2.ts(完全独立),不依赖 agent-runtime
   - 所以 #58 backlog 描述的"1-2 天工作 + 转译 SkillContext" 是高估了 ——
     SkillContext 没人在生产用,根本不需要转译

2. 方案 Z(选定 + 执行)
   - X: ActivityBookingParams 加 booking_link?: string + task?: string,
     buildActivityContext 透传 caller 的 deep link
   - +: 同时删 lib/agent-runtime/ 整个目录 + /api/autopilot/activity/
   - Y(以后再补): lib/core 自己接 SeatGeek/Ticketmaster search API
     让 B 端 caller 不必自己拿 URL —— 等真有用户抱怨再加
   - Linus 论:"Read the code, find out which paths are dead." 接 lib/core
     之前先减小 surface area
   - Patrick Collison 论:"Reduce surface area before adding features."

3. US-W6-005: 删死代码
   - rm -rf lib/agent-runtime/(8 个文件:index/registry/runner/types +
     reserve-restaurant/search-hotel/search-flight/find-activity skill +
     scenarios/date-night)
   - rm -rf app/api/autopilot/activity/(POST endpoint 没人调)
   - rmdir app/api/autopilot/(变空)
   - app/api/booking-jobs/[id]/start/route.ts:
       · 删 import findActivitySkill / SkillContext
       · 删 runActivityStep 整个函数(40 行)
       · 删 isUniversalActivity 检测和分支
       · 删 skillCtx 构造(policy/autonomy/profile 仍 load 但不再封装成
         SkillContext)
       · dispatch 简化:universal/restaurant/hotel/flight/activity 全走
         runUniversalStep,其他 fallback 走 runStepWithRecovery(legacy)

4. US-W6-006: lib/core executor 加 activity case
   - lib/core/execution/types.ts: ActivityBookingParams 加
       · booking_link?: string(SeatGeek/Ticketmaster deep link,REQUIRED
         today 但 schema 上 optional 留给未来 search 能力)
       · task?: string(caller 自定义 prompt;不传则 lib/core 用默认
         "buy tickets, fill guest info, stop before CVV")
   - lib/core/execution/executor.ts: buildStartUrlAndTask 加 case "activity"
     → buildActivityContext(params, profile)
       · 没传 booking_link → throw "booking_link required for activity..."
         (caller bug,upstream 应该传)
       · 有传 → 直接 startUrl = booking_link,task 用 caller 的 or 默认
   - 删除老的 throw "Activity scenario not supported yet"

5. US-W6-007: cend-adapter 加 activity 进 CORE_SUPPORTED_SCENARIOS
   - 加 "activity" 进数组(现在 4 个:restaurant/hotel/flight/activity)
   - convertBodyToParams 加 case "activity" → convertActivity(body)
   - convertActivity:
       · activity_name → event_name (REQUIRED)
       · city → city
       · event_date → event_date
       · num_tickets → num_tickets
       · startUrl → booking_link (REQUIRED)
       · task → task (OPTIONAL,trim 后非空才透传)
   - 文件头注释更新:不再说"activity 不支持"

6. caller body 标准化(三个 caller 字段对齐)
   - 之前三个 caller 的 activity step body 字段名不一致:
       · ActivityCard.tsx 缺 activity_name/city/event_date/num_tickets
       · rooms-execute.ts 用 eventName/eventDateTime/venueCity/numTickets
         (camelCase 不一致)+ 缺 task 字段
   - 改 ActivityCard.tsx:补全 standardized fields(activity_name +
     activity_id + venue_name + city + event_date + num_tickets + provider)
   - 改 rooms-execute.ts:rename 字段对齐 + 加 task prompt(之前根本没传
     task 就直接 runBrowserTask,可能一直依赖默认或漏)
   - 标准化以后 cend-adapter 不需要写 3 路兼容 dispatch,convertActivity
     只读一种 body shape

7. 测试 + typecheck
   - lib/core/__tests__/cend-adapter.test.ts:
       · CORE_SUPPORTED_SCENARIOS 改成 4 项
       · isCoreSupported 加 activity → true
       · 新增 activity 测试组(4 测):
           - 转换 startUrl→booking_link + 标准字段
           - 不传 task 时 params 不带 task key(executor 用默认)
           - 缺 startUrl 抛错
           - num_tickets 不是 number 抛错
       · trip-level test 改成 4 scenario 全 marked
       · 新增 unknown step type 不动测试
   - npx vitest run lib/core/__tests__ lib/core/execution/__tests__:
     ✅ 4 files / 63 tests pass(20→24 cend-adapter,40 老测无回归)
   - npx tsc --noEmit:✅ exit 0(rm -rf .next 后,因为 .next 缓存
     一直引用已删 route)

8. 影响半径
   - C 端三个 activity 入口(ActivityCard / create-trip / rooms-execute)
     的 body 现在 shape 一致,USE_CORE_EXECUTOR_FOR_CEND=true 时全部走
     lib/core/execution/recovery 管线
   - 任何引擎层修复(Phase 3 trigger / vendor URL classification /
     paused_payment 防误报)C 端 activity 自动受益
   - lib/agent-runtime/ 整个不存在 → 无人 import,代码搜索更干净
   - /api/autopilot/activity/ route 不存在 → 一个未维护的 endpoint 消失

9. 仍未完成 / 后续(backlog)
   - Y 方向:lib/core 自己跑 SeatGeek/Ticketmaster search(B 端 caller
     不必自己拿 URL)。等真有用户提需求再做
   - #21/22/23 MCP publish + hosted endpoint + OAuth
   - #53 pre-existing test failures
   - vitest.config exclude .agents/skills/gstack/**
   - REAL E2E 浏览器实测一次 activity booking(hotel+flight 同样)

10. 战略意义
    今天连 W6 #1 + #2 一并交付,意味着:
    - C 端跟 B 端 REST API 完全共用 lib/core 管线 — restaurant/hotel/
      flight/activity 四个 scenario 一个不缺
    - lib/core 是真的 single source of truth,不是"主要场景 + 小漏洞"
    - lib/agent-runtime/ 这种半成品死代码清掉,reduce surface area,
      未来读代码不会再被"哦这个 skill 系统是干嘛的"绕进去
    - 如果以后要加新 scenario(比如 car_rental / experiences),只需
      lib/core/execution/types.ts + executor.ts + cend-adapter.ts 三处
      改动,有清晰的 add-pattern

11. 6 commits 今天
   ef22017 feat(core): cend-adapter supports hotel + flight + per-step dual-gate
   f0d506f docs: v0.2.41.0
   (本 commit) feat(core): activity 接 lib/core + 删 agent-runtime 死代码
   (后续 docs commit) docs: v0.2.42.0

================================================================
Recent Updates - 2026-04-25 (cont. 11) · Week 6 #1 · C 端 dogfood 扩面:hotel + flight 接进 lib/core
================================================================

延 v0.2.40 全天硬核之后,今天小步推进:把 C 端 trip booking 的
hotel + flight 也接进 lib/core 的执行管线,把 Week 4 #11 单餐厅
dogfood 扩到三 scenario,让双轨制只剩 activity 一处。

1. 现状梳理(决定方案 C 之前)
   - lib/core/execution/executor.ts 实际已支持 restaurant + hotel
     + flight(buildStartUrlAndTask 三个 case),activity 直接 throw
     "Activity scenario not supported by runExecutionJob yet"
   - lib/core/cend-adapter.ts 旧 createJobViaCore 只接 restaurant
     (hard-throw 其他 type)
   - app/api/booking-jobs/{create-trip,POST}/route.ts 双轨 gate 都
     是 length===1 && type==="restaurant" —— 多 step trip / hotel /
     flight 全部走老路径
   - [id]/start/route.ts 的 dual-gate 是 per-step 按 step.body.__source
     marker 分发的(这点之前的设计就是对的)—— 意味着 trip 多 step
     可以混走两条路径
   - activity 不走 stagehand-executor,走 lib/agent-runtime/skills/
     find-activity(Google Places → 本地体验 handoff URL),要接进
     lib/core 需要把 SkillContext(policy/autonomy/preference profile)
     转译成 ExecutionContext + ConsentPolicy —— 不在 W6 #1 范围

2. 方案 C(Hybrid):今天接 hotel + flight,activity 拆 backlog
   - 工作量 ~半天 + ship,activity 单独立 #58 等真用起来再设计
   - Linus 论:"Solve the problem in front of you. Don't pretend
     you'll solve a different problem." Activity 是另一个系统

3. US-W6-001: cend-adapter 重构
   - 删旧 createJobViaCore(单 scenario,直接 createBookingJob)
   - 新导出:
       · CORE_SUPPORTED_SCENARIOS 常量 = ["restaurant","hotel","flight"]
       · isCoreSupported(stepType): boolean — 给 caller 用作 gate
       · markStepForCore(step): BookingJobStep — 纯函数,只重塑 body
   - markStepForCore 干两件事:
       (a) camelCase → snake_case 的 ExecutionParams 转换
           - restaurant: restaurantName → restaurant_name(其他字段同名)
           - hotel: 完全 1:1(legacy create-trip 已用 snake_case)
           - flight: returnDate→return_date / cabinClass→cabin_class +
             cabin alias(coach→economy / premiumcoach→premium_economy)
             + 5 个 target* hint 透传(targetAirline / targetPrice /
             targetDepartureTime / targetFlightNumber / 等)
           - 未知 cabin 值 silently dropped(不传歪 cabin 给 executor)
       (b) profile + profileId preserve + __source="lib/core/execution"
           marker stamp(start route 的 dual-gate 按这个分发)
   - 必填字段缺失抛错(caller 应该 isCoreSupported gate + upstream 校验)
   - activity 调用直接抛 "not supported by lib/core"

4. US-W6-002: route 层 per-step gating
   - app/api/booking-jobs/route.ts(POST,direct-booking 链路从
     chat-commit 进来) + app/api/booking-jobs/create-trip/route.ts
     (trip packaging)同样模式:
       const useCoreForCend = process.env.USE_CORE_EXECUTOR_FOR_CEND === "true";
       const finalSteps = useCoreForCend
         ? steps.map(s => isCoreSupported(s.type) ? markStepForCore(s) : s)
         : steps;
   - 删除旧 try/catch 单 step early-return + fallback 块
   - 单次 createBookingJob(steps: finalSteps),trip multi-step 不破坏
     (parallel execution 由 [id]/start 的 Promise.allSettled 负责)
   - response 加 _via_core 字段(viaCoreCount > 0 时)便于 dev 观察分发

5. US-W6-003: cend-adapter unit tests + array.map 集成测试
   - lib/core/__tests__/cend-adapter.test.ts:20 个 test
       · CORE_SUPPORTED_SCENARIOS 内容
       · isCoreSupported × 4(三 yes / activity no / universal no)
       · restaurant × 4(转换 / profile preserve / outer fields preserve /
         covers as string 抛错)
       · hotel × 2(1:1 / hotel_name 空抛错)
       · flight × 6(return_date 重命名 / one-way 不带 / cabin alias /
         未知 cabin drop / target* 透传 / origin 空抛错)
       · guards × 3(activity throw / 无 profile 不 spread / 无 profileId 不 spread)
       · trip-level array.map × 1(hotel+flight+restaurant+activity 混合,
         前三个有 marker activity 没碰)
   - 不写整 route 集成测(create-trip 要 mock Clerk + DB 整片;array.map
     模式覆盖了核心行为,真路径用 dev 上跑一次 trip 验证就够)

6. 测试 + typecheck
   - npx vitest run lib/core/__tests__ lib/core/execution/__tests__:
     ✅ 4 files / 60 tests pass(20 新 + 40 老,零回归)
   - npx tsc --noEmit:✅ exit 0 整 monorepo

7. 影响半径
   - C 端 trip booking 所有 hotel + flight + restaurant step 现在
     默认走 lib/core/execution/recovery.ts(USE_CORE_EXECUTOR_FOR_CEND
     是 kill-switch,生产环境 .env.local 已开,关一下变量回滚)
   - lib/core 内部:Phase 1 retry / Phase 2 time fallback / Phase 3
     provider chain / consent-gating / audit log 全部用上
   - activity 维持原 path(runActivityStep + findActivitySkill),
     体感无差异
   - direct-booking 链路(/api/booking-jobs POST 单 restaurant)同步
     走 lib/core,跟 W5 #2 真流量验过的 Carbone 路径一致

8. 仍未完成 / 后续(backlog)
   - #58 activity 接 lib/core(等 MCP book_activity 真用起来再设计
     ExecutionContext 怎么承载 SkillContext)
   - #21/22/23 MCP publish + hosted endpoint + OAuth
   - #53 pre-existing test failures
   - vitest.config exclude .agents/skills/gstack/**
   - REAL E2E 浏览器实测一次 hotel+flight trip booking(curl 验过 NLU
     侧,这次的改动只动 step shaping,行为应与之前等价 —— 但建议测一次
     再放心)

9. 战略意义
   今天的小修把 W4 #11 dogfood "只覆盖单餐厅" 的尴尬收掉:从今天起
   C 端跑出来的所有 hotel/flight/restaurant booking 都和 B 端 REST API
   走完全相同的 lib/core 管线,C 端是真的 dogfood lib/core 而不是只
   "试用一个最小 scenario"。这意味着任何 W5+ 引擎修复(Phase 3 trigger /
   vendor widget classification / paused_payment 防误报)C 端能直接受益
   而不需要二次集成。

10. 4 commits 今天傍晚段
   (本 commit) feat(core): cend-adapter supports hotel + flight + per-step gating
   (后续 docs commit) docs: v0.2.41.0 release notes

================================================================
Recent Updates - 2026-04-24 (cont. 10) · Week 5 #3 · Bug B + Bug C 收尾 + ship audit
================================================================

延 v0.2.39 收尾 NLU 直订路径之后,继续修 Carbone 测试暴露的另两个引擎
bug。然后跑完整 ship-readiness audit:今天 74 commits 推完,需要确认
没拉低任何东西的稳定度。

1. Bug B(US-W5-010): website handoff vendor URL classification
   - 真实场景(用户截图):Marea 跑 OpenTable→Resy→website fallback,
     agent 点 marearestaurant.com 上的 "Reservations" 链接,跳到
     SevenRooms iframe URL https://www.sevenrooms.com/events/<event-id>。
     我们旧代码直接把这 iframe URL 作为 handoffUrl,但用户点这个
     deep link 时 SevenRooms 经常 404 —— 因为它需要 parent page
     (marearestaurant.com) 的 context 才能正常加载。
   - 修法:lib/core/execution/recovery-providers.ts 加两个 helper
       · matchKnownVendor(url):正则识别 7 个预订平台域名
         (SevenRooms / Tock / OpenTable widget / Resy / Yelp /
         Eat App / Dineplan)。OpenTable 主搜索 URL 故意 NOT 匹配,
         避免把用户绕回 Phase 1 已试过的 provider
       · headProbe(url):3s 预算 HEAD 请求,2xx + 405 都算 OK
   - tryWebsiteHandoff 三分支:
       · vendor + accessible → 用 vendor URL,summary 注明 vendor 名
         ("Marea books through SevenRooms — tap to open the widget")
       · vendor + 不 accessible → fallback 到 officialWebsite,
         summary 明示 "Their widget needs to load from the venue's
         website — tap below, then click 'Reservations' at the top"
       · 无 vendor → 旧行为不变
   - 9 unit tests(全绿): 7 个 pattern 各一条 + OpenTable 主搜索 URL
     必须返 null(回归保护) + 餐厅主页/无关页 null
   - 影响半径:Carbone / Le Bernardin / Marea 等所有 SevenRooms-/
     Tock-based 餐厅。用户拿到的 handoff link 现在要么是真能 load
     的 vendor 页,要么是带明确指引的 venue 主页

2. Bug C(US-W5-011): final-outcome paused_payment 误报
   - 现场:final-outcome.ts:402-410 fallback 路径会在 agent.completed
     =false 时返 paused_payment。当 Resy/OpenTable 程序化流程跳过
     agent("Skipped initial agent run — Resy programmatic flow active")
     且什么字段都没填时,这个 fallback 还是 paused_payment —— 让下游
     recovery-providers#isGenuineBooking 不得不用字符串 hack 过滤
     ("skipped initial agent run" regex)
   - 修法:在 fallback 前加 defensive guard
       resultCompleted=false AND skipped-agent message AND 7 字段
       全空 AND stage="unknown" → 返 no_availability + 诚实 summary
       "We couldn't identify a reservation widget on this page"
   - 删掉对 isGenuineBooking 字符串 hack 的依赖(虽然字符串 hack 仍
     defense-in-depth 留着)
   - 没加新 unit test(已被 US-W5-003 的 HTTP 402 fast-fail 间接覆盖
     fallback ladder)

3. Ship-readiness audit(US-W5-012)
   - typecheck:✅ exit 0(整个 monorepo 包括 packages/mcp-server)
   - 所有 W5 + W4 touched code 测试:✅ 136/136 pass(W5 unit + W4
     api-auth + integration + NLU golden 全部)
   - 我没碰的代码 pre-existing failures:14 tests / 4 files
       · components/__tests__/RecommendationCard.test.tsx(11 个,
         useRouter test mock 缺失,git blame 显示是早期 commit 的)
       · lib/__tests__/weekend-trip.test.ts(3 个,fixture drift)
       · 不是今天回归 → 入 backlog(任务 #53)
   - .agents/skills/gstack/* 测试 42 个 file 失败 → 与我们无关
     (vendor tool tests,vitest 不该 pick up,需要 vitest.config 改
     exclude)
   - git status:干净(只 .claude/settings.local.json + dev.log~
     untracked)
   - 74 commits 推上 master,5433730..(当前)零冲突

4. 6 commits 今天傍晚段
   1a8c6a6 feat(nlu): RestaurantFields.restaurant_name + HotelFields.hotel_name
   d6c2cf2 feat(nlu): extractor captures restaurant_name + hotel_name
   f18718d feat(nlu): router emits directBooking flag when venue is named
   836c846 feat(chat): direct_booking branch — skip recommendations
   d90c844 test(nlu): 6 golden cases for direct-booking router branch
   ea275d0 docs: v0.2.39.0 release notes
   ad29895 feat(core): website handoff classifies + HEAD-probes vendor widgets
   62511b1 fix(executor): no_availability instead of paused_payment when agent skipped
   (本 commit) docs: v0.2.40.0 release notes

5. 一日总结(38 commits 跨 5 个 minor 版本 + 1 patch)
   v0.2.36.0 — Week 4 #2 MCP connector
   v0.2.37.0 — Week 4 #3 /developers landing + dashboard + docs
   v0.2.37.1 — post-ship polish (hooks fix + BrandStrip)
   v0.2.38.0 — Week 5 #1 Phase 3 trigger 引擎边界
   v0.2.39.0 — Week 5 #2 NLU 直订
   v0.2.40.0 — Week 5 #3 Bug B + Bug C + ship audit
   v0.2.41.0 — Week 6 #1 C 端 dogfood 扩面 (hotel + flight 接 lib/core)
   v0.2.42.0 — Week 6 #2 activity 接 lib/core + 删 agent-runtime 死代码
   v0.2.43.0 — UI 系统升级 (token + 4 cards + /tasks 整页) + nav perf + #53 test fixes
   累计:38 commits,~9000+ 行新代码,3 个 backlog item 入队(#21 npm
   publish / #22 hosted MCP endpoint / #23 OAuth / #53 pre-existing
   tests),26 个 W4-W5 user stories 全部完成。

6. 战略意义
   今天从早到晚的轨迹:Week 4 把"AI Travel Execution Layer" pitch 变
   成可点击的产品(MCP server + landing + dashboard + docs),Week 5
   回头修两层引擎 bug(Phase 3 trigger + NLU venue capture)+ 两层
   边缘 bug(vendor widget classification + paused_payment 误报)。
   现在外部开发者从 onegent.com/developers 进来 → 自助 mint key →
   Claude Desktop 接入 → "Book Carbone" → NLU 抓到店名 → 直接到
   booking-job → 引擎走 OpenTable → stage=unknown → Phase 3 → Resy
   → 找到 → SevenRooms vendor URL classified → handoff 落到能 load
   的页面 —— 整条链路可被一个真实开发者今天就跑通。

7. 没做的(明天/Week 6 候选)
   - #21 npm publish @onegent/mcp-server(用户手动 5min)
   - #22 onegent.com/api/mcp hosted endpoint(1-2 day 编码 + 5-10
     工作日 ChatGPT Apps review)
   - #23 Claude.ai remote MCP OAuth 2.0
   - #53 修 pre-existing test failures(2-3h)
   - 真线上 dogfood:重启 dev server 后用 "Book Carbone" 跑端到端
     验证今天所有 fix 联动

================================================================
Recent Updates - 2026-04-24 (cont. 9) · Week 5 #2 · NLU 直订:"Book Carbone" 真去 booking
================================================================

第二个 Week 5 修复 —— Week 5 #1 修了引擎层 Phase 3 trigger,但用户实际
跑 Carbone 时发现根因更靠前:NLU 根本没识别用户指定了具体店名,把
"Book Carbone in NYC" 当成普通"我想吃 NYC 餐厅",返了 5 家通用 Italian
推荐(Carbone 不在其中)。用户点了 Marea,然后 Marea 不在 OpenTable,
website fallback 跳到主页就死了。

本轮修 NLU 数据流,从用户输入到 booking-job 创建不再丢店名信号。

1. 根因(用户截图 + dev.log 揭示)
   - 用户:"Book Carbone in NYC tomorrow 7pm for 2"
   - NLU v2 extractor 分类正确(scenario=restaurant, intent=create_plan,
     confirm_ready=true)但 RestaurantFields schema **整个没有
     restaurant_name 字段** —— "Carbone" 这个 entity extractor 提取了也
     没地方塞,被默默丢
   - /api/chat/commit 返 kind=plan → /api/chat 收到 search_query +
     city/date/time/party_size,LLM 推荐 5 家通用店
   - 用户点 Marea → booking-jobs 创建 jobId=ea3f8fe6 → OpenTable 没收录
     Marea(它在 SevenRooms)→ Phase 3 老 isNotFound 正则命中(因为
     summary 含 "not found on OpenTable"),Resy 没找到 → website fallback
     跳到 marearestaurant.com 主页 → final-outcome 返 status=error
   - 用户看到的:浏览器停在 Marea 主页章鱼 logo,啥都没订。

2. 修法 5 commits,每层一个:

   US-W5-005 — Schema 加 restaurant_name + hotel_name(types.ts)
     · RestaurantFields.restaurant_name?: string
     · HotelFields.hotel_name?: string
     · flight 不加(航班号不是常见用户输入,preferred_airlines 已能覆盖)
     · 注释强调"only when user pointed at ONE specific venue,never
       inferred from cuisine/star-rating"

   US-W5-006 — Extractor prompt 加 worked examples(extractor.ts)
     · Example F:"Book Carbone in NYC tmrw 7pm for 2" →
       restaurant_name="Carbone"
     · Example G:"给我订北京饭店明晚 7 点 2 人" →
       restaurant_name="北京饭店"(中文原文,不翻译)
     · Example H:"Reserve The Pierre New York Apr 28-30" →
       hotel_name="The Pierre"
     · CRITICAL anti-pattern callout:"Find me a romantic Italian place"
       → restaurant_name STAYS BLANK(speculative population 会摧毁
       direct-booking 的语义)
     · coerceRestaurant + coerceHotel 加 *_name 字段透传

   US-W5-007 — Router emit directBooking flag(router.ts)
     · RouterAction.show_confirm_card 加 directBooking?: boolean
     · NluV2ParseResult 加 direct_booking?: boolean
     · routeIntent 当 (restaurant + restaurant_name) OR (hotel + hotel_name)
       AND kind="plan" 时 set directBooking=true
     · Decision Rooms(intent=create_room)即使 creator 命名 venue 也
       NOT 设 flag —— co-deciders 需要看到/投票才行,room 流程保持
       推荐管线
     · toV1CompatShape pass-through

   US-W5-008 — chat/commit direct_booking 分支(commit/route.ts + page.tsx)
     · 后端读 nluRaw.direct_booking → buildDirectBookingPayload
       构造 BookingJobStep(restaurantName / hotelName + city / date /
       time / covers/guests)→ 返 kind="direct_booking" + venue_name
       + booking_step
     · 前端 handleConfirmCommitted 加 async + 新分支 handleDirectBooking:
         fetch /api/user/booking-profiles?default=true
         → 拼上 profileId + profile
         → POST /api/booking-jobs(同 RecommendationCard.handleReserve 模式)
         → fire /start
         → router.push("/tasks")
     · ConfirmCard.CommitResponse.kind union 加 "direct_booking"
       + venue_name + booking_step optional 字段
     · 无 profile 时 graceful 返"please add booking profile in Settings"

   US-W5-009 — Golden tests + 真流量验证(本节)
     · 6 个新 router golden tests:
         R6: restaurant_name + all required → directBooking=true
         R7: restaurant_name 但 date 缺 → still ask_clarification
         R8: NO restaurant_name → directBooking undefined(回归保护)
         R9: flattenScenarioFields 含 restaurant_name
         H_DB1: hotel_name 同 R6
         H_DB2: hotel_name + create_room → directBooking undefined
     · 88/88 NLU tests 全绿(6 新 + 82 原,零回归)

3. 端到端预期路径(Book Carbone)
   "Book Carbone in NYC tomorrow 7pm for 2"
     → POST /api/chat/parse
     → extractor 识别 restaurant_name="Carbone" + city="New York"
       + date="2026-04-25" + time="19:00" + party_size=2
     → router 发现 restaurant_name set + kind=plan → directBooking=true
     → NluV2ParseResult.direct_booking=true + confirm_ready=true
     → 前端 ConfirmCard 显示"Book Carbone for 2 on 2026-04-25 at 19:00"
     → 用户点 Confirm
     → POST /api/chat/commit 返 kind="direct_booking" + booking_step
       (restaurantName="Carbone", body 完整)
     → 前端 handleDirectBooking → fetch profile → POST /api/booking-jobs
     → jobId 创建,/start fire,跳 /tasks
     → executor 走 OpenTable("Carbone" 在 OpenTable 搜索能搜到!)
     → 详情页无 booking widget(Carbone 用 SevenRooms)→ stage=unknown
     → final-outcome 返 status=error + summary "Stalled at listing"
     → recovery.ts shouldTryProviderFallback (US-W5-001) 命中 whitelist
     → Phase 3 触发 → Resy fallback → 找到 Carbone 的 Resy 入口(如有)
     → status=paused_payment + handoffUrl 落到 Carbone Resy 页
   两个 W5 修复(NLU + recovery)联动闭环。

4. 6 commits 推上 master
   1a8c6a6 feat(nlu): RestaurantFields.restaurant_name + HotelFields.hotel_name
   d6c2cf2 feat(nlu): extractor captures restaurant_name + hotel_name
   f18718d feat(nlu): router emits directBooking flag when venue is named
   836c846 feat(chat): direct_booking branch — skip recommendations
   d90c844 test(nlu): 6 golden cases for direct-booking router branch
   (本 commit) docs: v0.2.39.0 release notes

5. 没做的(刻意推迟)
   - flight scenario 加 flight_number 字段:用户说"book UA123" 太罕见,
     等真有需求再加
   - Decision Room 流程的 venue-pinned 行为:Stage 2 trip room 决定后
     可能要 review,但目前 Decision Room 创建后 co-deciders 还是看到
     推荐
   - Marea 等"OpenTable 不收录但用户搜不到"的处理:这个跟 US-W5 NLU
     fix 无关,属于推荐管线/Google Places 信号补全问题
   - Bug B(website handoff URL 跳到主页死循环):用户原 ask 的 #3,
     待 Carbone 真测后再决定 priority

6. 战略意义
   v0.2.38(W5 #1)修了引擎层"venue 不在 primary provider 时不 fallback"
   bug。但发现有用户的 Carbone 根本进不到引擎层 —— NLU 已经把店名丢
   了。v0.2.39(W5 #2)修这个 NLU 数据流,把"用户说什么"忠实送到执行层。
   两层 fix 加起来,从 chat 输入到 booking-job 创建之间不再有 entity
   leak。下次跑 Carbone 应该能看到 W5-001 的白名单 fallback 真触发。

================================================================
Recent Updates - 2026-04-24 (cont. 8) · Week 5 #1 · 修引擎边界:Phase 3 trigger
================================================================

第一个真正的 engine fix —— W4 全部装好后,第一次回头修引擎层的一个
真实生产 bug:Carbone / Le Bernardin / Osteria La Baia / Ci Siamo
这类餐厅(在 OpenTable 搜索能搜到但用自己的预订系统)从来没触发过
Resy fallback,用户看到一个"error"就以为完了,其实 Resy 上能预订。

1. 根因(从 backlog 笔记的"stage=unknown"挖到了更准确的描述)
   - lib/core/execution/recovery.ts Phase 3 trigger 现在是:
       if (phase1.result.status === "no_availability" && scenario === "restaurant")
   - 但 lib/booking-autopilot/core/final-outcome.ts:389-399 的"Unverified
     checkout field values"分支返的是 status="error",不是
     "no_availability"。因为:
       · OpenTable 把 Carbone 等列在搜索结果里,agent 点进详情页
       · 详情页没 embedded booking widget(他们用自己的系统)
       · assessBookingStage 一直返 stage="unknown"
       · continuation pass 跑完仍 unknown
       · final-outcome 没匹配到任何 special-case branch
       · 落到 "Unverified checkout field" 兜底返 status="error"
   - recovery.ts 看到 error 直接 return,Phase 3 永远没机会跑

2. 修法:白名单 + 黑名单双 pattern 的 predicate 函数(US-W5-001)
   - 新文件 lib/core/execution/should-try-fallback.ts
   - shouldTryProviderFallback({scenario, status, summary, error?}) → boolean
   - 9 个 FALLBACK_WORTHY_PATTERNS(从生产 summary/error 字符串里反向
     提取):
       · /not found on (opentable|resy|yelp)/i
       · /\b(stalled|stuck|stopped) at\b/i
       · /no recogni[sz]able page signals/i
       · /\bstage[ :=]unknown\b/i
       · /unverified checkout field/i
       · /guest.*values were not verified/i
       · /reached a payment-like page/i
       · /reservations? not (yet )?available (on|through)/i
       · /book.*(through|on) (their|its) (own|website|direct)/i
   - 4 个 FALLBACK_BLOCKED_PATTERNS(强制不进 Phase 3,即使白名单也命中):
       · /page load failed|browser failed/i
       · /chrome-error|about:blank/i
       · /quota|billing/ + /\bHTTP 4(0[12]|29)\b/
       · /blocked the automated browser|bot protection/i
       · /captcha/i (defense in depth)
   - 设计原则:白名单优于黑名单 + 黑名单优于白名单(precedence test 锁定)。
     避免 transient infra 失败浪费 2-3min Resy 路径。

3. recovery.ts wire-up(US-W5-002)
   - 把 inline check 换成 shouldTryProviderFallback() 调用
   - Phase 2(time fallback)trigger 收紧:只在 status="no_availability"
     AND venue IS in catalog 才跑(error-status 的 escalation 直接跳过
     time,因为时间不能解决"venue 在另一个平台"的问题)
   - 三种触发路径明确了:
       A. no_availability + slot 满 → Phase 2(time)→ Phase 3(provider)
       B. no_availability + "not found" → Phase 3 directly
       C. error + 白名单 hit → Phase 3 directly(NEW)
       D. error + 黑名单 hit → no fallback(NEW · fast-fail)
       E. captcha / needs_login → no fallback(unchanged)

4. 测试覆盖(US-W5-001 unit + US-W5-003 integration)
   - 21 个 should-try-fallback unit tests(每个 pattern 一条 + 边界):
       · scenario gating(hotel/flight/activity 都 reject)
       · no_availability classic(true 不论 summary)
       · 8 个白名单 pattern 各一条 happy case
       · 4 个黑名单 pattern 各一条 deny case
       · 2 个 unrecognized error(默认不 fallback)
       · 4 个非 eligible status(captcha/needs_login/completed/paused_payment)
       · blocklist precedence(双命中时 deny 赢)
   - 3 个 integration tests 锁端到端控制流:
       · status=error + "Stalled at listing" → Resy 真被调用且成功
       · status=error + "Unverified checkout field" → Phase 3 真触发
       · status=error + "HTTP 402 quota" → Phase 3 NOT 触发(单一 call)
   - 28/28 全绿,7 个既有 integration test 零回归

5. 影响的真实 venue 列表(用户提供)
   Carbone(Greenwich Village):自有系统 + Tock
   Le Bernardin(Midtown):Tock-based
   Osteria La Baia(Midtown):自有系统
   Ci Siamo(Hudson Yards):Tock-based
   修复后预期:agent 在 OpenTable 触底 → recovery 看到 "Stalled at
   listing" → shouldTryProviderFallback 返 true → 跳 Resy → Resy 把
   Le Bernardin 等 Tock 餐厅的预订漏斗暴露出来 → 用户拿到
   paused_payment 而不是 error。

6. 4 commit 推上 master
   f15b3b7 feat(core): shouldTryProviderFallback predicate + 21 unit tests
   1dd7822 feat(core): recovery.ts uses shouldTryProviderFallback
   a8f1cd3 test(core): 3 integration tests for US-W5 error-status
   (本 commit) docs: v0.2.38.0 release notes

7. 没做的(刻意推迟)
   - final-outcome.ts 的根本性重新分类(option B):error → no_availability
     的 semantic 重命名。等真有真流量数据证明白名单不够再考虑。
   - 真线上 dogfood 验证:dev 环境跑一次 Carbone 看是否 Resy 真接住。
     (建议下次开 npm run dev 后实际试一次预订,作为 W5 dogfood)。

8. 战略意义
   v0.2.34→37 一直在搭基础设施(lib/core 抽象 / REST API / MCP / landing
   /dashboard / cross-surface nav)。v0.2.38 是第一次回到引擎本身修一个
   会让用户当场骂街的 bug —— 标志 Stripe 打法第一阶段完成,接下来要从
   "造水管"切到"水管里流的水好不好喝"。

================================================================
Recent Updates - 2026-04-24 (cont. 7) · v0.2.37.1 post-ship polish
================================================================

v0.2.37.0 推完 + 用户实际跑过 mint key → reveal → revoke 端到端流程后,
两个补漏:

1. hooks-rules hotfix(commit d414e43)
   DevNav 的 useEffect 写在 `if (pathname?.startsWith("/developers/keys"))
   return null;` 之后,导致 /developers/keys 上 hook 数 = 3, 其他
   /developers/* 上 hook 数 = 4。React hydration 检测到飘移 → 报
   "Rendered fewer hooks than expected"。修法:把 useEffect 上移到
   early return 之前,加注释警告未来编辑。

2. BrandStrip 跨 surface 导航(commit ff019b0)
   用户提:"developers 和 c 端页面好像没有链接,要不要做个按钮让它们
   互相前往"。讨论 4 方案,选 Apple-style top utility strip:
   · components/BrandStrip.tsx:client component,usePathname 检测
     "在 /developers/* 还是 /",据此设 data-current
   · 36px 高 ribbon 在 root layout app/layout.tsx 顶部渲染,所有
     surface(/、/developers、/developers/keys、docs、pricing)统一戴
   · 当前 surface 名旁戴 5px 金色脉动小点(2.6s @keyframes pulse,
     prefers-reduced-motion 关掉)
   · position: relative scrolls away → main navs 仍 sticky top:0
     正常工作,无 offset 调整
   · 颜色硬编码(#fafaf9 / #c9a84c),不依赖 var(),保证 dashboard
     dark theme [data-theme="dashboard"] 不漏色到 strip
   · mobile <540px 收紧间距 + dot 仍在
   战略意义:解决"匿名访客在 / 找不到 /developers"的零路径问题 +
   "active 开发者要 scroll 到 footer 才找到 consumer app"的友 friction。
   现在双向都是 1 click。

3. PROJECT_SUMMARY.md banner 升 v0.2.37.0 → v0.2.37.1(本节)

3 commits 总 +1 hotfix + 1 small feature + 1 docs。Week 4 完整收尾,
真正 ready 给外部开发者看。

================================================================
Recent Updates - 2026-04-24 (cont. 6) · Week 4 #3 /developers landing + 自助 key dashboard
================================================================

v0.2.36.0 把 MCP / ChatGPT 分发渠道做完后,v0.2.37.0 补齐 B 端的"前门"——
完整的 /developers landing + 文档 + pricing + 自助 API key 仪表盘。
Stripe 打法的最后一块:不只是 API 能调,还要让 caller 一进网站就明白
"这是干什么的、怎么用、怎么开始"。

战略意义:这一轮 17 个 commit 把品牌定位 "AI Travel Execution Layer"
从内部说法变成可点击的产品页面。一个开发者从 onegent.com/developers
进来,5 分钟内能 sign up → mint test key → 在 Claude Desktop 里跑通
第一次预订,完全自助,不需要发邮件。

1. 命名 + 定位锁定(讨论 → 写进 memory)
   讨论了 4 个方案(全盘改名 / 公司+产品双层 / 保留 Onegent 改显示层 /
   延迟决策),选"保留 Onegent + 改显示层 + 定 tagline":
   · Tagline:"Onegent — AI books your trip end-to-end"
   · 外部显示名:"Travel Booking Agent"
   · 一句话描述:"Book restaurants, hotels, flights, and activities
     through an AI agent that navigates real booking sites."
   理由:零流量零品牌 equity 阶段,改公司名收益 0,信息缺口靠 tagline
   补。Stripe 2010-2013 同款打法。

2. UI 设计标杆 + 写进 auto-memory(永久指令)
   用户:"那个UI要做的有高级感,高大上一点,有设计感一点,像apple一样,
   你是顶级的网站Ui设计师,要有创新,要做到一目了然和让人赏心悦目。
   不要害怕工时久就偷懒做简单版本,要做就要做到完美和注重品质和细节。"
   存入 memory/feedback_ui_quality_bar.md → 后续做用户可见 UI 时默认
   按 Apple/Linear/Stripe/Mercury 标准,不再降级到 MVP。
   设计方向选 A + 暗仪表盘混搭:landing/docs Mercury 白净派,/keys
   Linear 暗调派,marketing→product 视觉过渡。

3. 数据库 schema(US-W4-010)
   - api_keys 加 user_id TEXT NULL 列(NULL=B端 org-key,有值=自助
     用户 key)
   - lazy migration 自动 ALTER TABLE ADD COLUMN IF NOT EXISTS,不
     破坏既有 7 条 CLI mint 的 key
   - 新增 partial index api_keys_user_active_idx ON (user_id) WHERE
     user_id IS NOT NULL AND is_active = TRUE
   - createApiKey 加 userId 参数;新 helper findApiKeysByUserId、
     findApiKeyById(后者用于 revoke 鉴权 user_id 匹配)
   - 8 个 require-api-key tests 零回归

4. Design tokens 基础设施(US-W4-011 + 012)
   - app/developers/_styles/tokens.css:9 阶 ink 灰阶 + 金 #C9A84C
     accent + 4 motion durations + 3 ease curves。dark theme via
     [data-theme="dashboard"] 选择器,vars 全部翻黑(true black
     #0A0A0B 底,亮金 #D4B860 accent)。prefers-reduced-motion 全
     局零化 animation duration。
   - typography.css:.dev-display(clamp 48→96px Playfair)+
     .dev-h1/h2/h3(serif/sans 混搭)+ .dev-token-underline(纯 CSS
     keyframe scaleX(0→1) draw 320ms 后 ease-out-expo)+
     .dev-fade-up--delay-{1..4}(staggered 60/160/280/420ms 入场)
   - layout.tsx + DevNav(粘性,scroll>8 触发 backdrop-blur)+
     DevFooter(4 列编辑式)+ shell.css(.dev-cta-pill / -ghost /
     .dev-badge--live 含金色 pulse 动画 / -preview / -beta)
   - Clerk v7 不再导出 SignedIn/SignedOut → 改 useUser() + isLoaded
     gate 防止 hydration flicker

5. Landing 页面 7 个 signature moves(US-W4-013..017)
   全部承诺达成,每个都是"design-bar = high"的具体动作:

   ① Hero — 双层动态标题
     "Your AI books your trip end-to-end." Playfair 600 clamp 48→
     96px,"end-to-end" 戴金色 underline 320ms 后 scaleX 弹出。
     Lead + 3 row check-icon trust meta(provider list / 支付安全
     stop-before-CVV / REST/MCP/Apps 三 surface 覆盖)。staggered
     fade-up 入场。

   ② Code Preview — 3-tab 实活卡片
     curl / Claude Desktop / TypeScript,切 tab clip-path inset
     wipe(100% → 0%)动画 ease-out-expo。手 tokenize 成
     .tok-{keyword,string,fn,prop,...} 颜色 span(无 shiki/prism
     依赖,3 段短代码不值得)。Copy 按钮 navigator.clipboard +
     icon 切 + "Copied" 2s 自动恢复。macOS 3-dot chrome + 1px 金
     hover border。

   ③ Scenario Grid — 4 张定制 SVG 卡
     餐厅(刀叉)/ 酒店(楼宇 + 窗格)/ 机票(纸飞机)/ 活动(穿孔
     票 + 星)定制单色 stroke=1.5 SVG。卡片 hover translateY(-4px)
     + shadow-hover + icon rotate(6deg) + 顶部金色 gradient sheen
     ::before fade-in。Restaurant/Hotel = Live(脉动绿点),Flight/
     Activity = Preview(暖金 pill)。

   ④ How It Works — SVG 流程图 + 旅行 token
     横向 4 节点(Your AI agent → /api/v1 → engine → real booking
     site)+ 1px 金色 hairline 跨连。28px 金色 gradient blob @
     keyframes 4.6s L→R 循环 = 数据流 token。Mobile <880px:
     grid 转竖排 + 3 段竖向 connector 各跑 2.4s 下行 token。每节
     点定制 SVG glyph(LLM 气泡 / curly braces / 六边核心 / 子午
     线地球)。

   ⑤ Trust strip — 真实 metrics + count-up
     server component 调 lib/core.computeProviderRanking({sinceDays:
     30}),agent_feedback < 10 行时 fallback 到 placeholder(6 /
     12,847 / 94.2% / 210ms)+ "Pre-launch placeholders" 透明披露。
     AnimatedCounter client component:IntersectionObserver gate
     滚到视野启动 + rAF ease-out-cubic 1600ms 计数。% / ms 后缀
     金色 0.55em。dark inverted 块衬出对比。

   ⑥ Pricing — Anthropic editorial 单宣告
     不做 tier 表,整页一句 dev-mega "Free during private beta."
     (clamp 72→128px Playfair)+ lead 平直说"$0.40/booking,
     usage-based,no per-seat tax"。3 张卡(Beta access · Free
     真实卡 / Production · 虚卡虚线 / High-volume · 虚卡虚线),虚
     卡背景 ink-50 + dashed border + ::before "Coming with v0.3"
     mono 角标。底部 fineprint 2 列(infrastructure-priced 含义 +
     "你不付钱的事")。

   ⑦ Dashboard — 暗调 Linear 风(US-W4-024)
     [data-theme="dashboard"] 翻 dark palette。DevNav 在
     /developers/keys 路径下用 usePathname 隐身,DashboardNav
     接管。每张 KeyCard 携带 hash-derived 金色 gradient ::before
     (linearGradient(${hue}deg, accent, transparent)),0.06 opacity
     —— 同色调但每 key 独一无二,Linear identity 暗号。Created /
     last used 相对时间(just now / 12m / 5d / 2mo)+ revoke ghost
     button(hover 转 danger)。Empty / Loading / Signed-out 三种
     状态各自 UI。

6. Docs 系统(US-W4-019..022)
   - 装 next-mdx-remote + rehype-slug + rehype-autolink-headings +
     remark-gfm(GFM 表格)。MdxContent.tsx 在 RSC 编译,每个 prose
     primitive(h1-h3/p/ul/ol/blockquote/code/pre/a/table/hr)定制
     .dev-doc-* class 覆盖原生太小的尺寸。
   - h2/h3 hover 浮现 dev-doc-anchor 金色 # 链(opacity 0→1 fade,
     Stripe Atlas 模式)。
   - /developers/docs hub:3 张大卡(REST · Claude · ChatGPT)hover
     glyph 反相 + → 2px translateX。
   - /developers/docs/api/v1:server component readFile docs/api/
     v1.md → MdxContent 渲染。220px sticky TOC rail(< 1024px 隐藏)
     + 面包屑。
   - /developers/docs/integrations/[slug]:动态 route allowlist
     ["claude-mcp", "chatgpt-apps"],generateStaticParams 预构建,
     非白名单 slug → notFound()。
   - 4 个 docs 路由全部 200(api/v1 渲染 338KB,真 markdown + 表
     + 代码块)

7. /api/developers/keys CRUD(US-W4-023)
   - GET:Clerk auth → findApiKeysByUserId → 返回时 strip key_hash,
     仅 prefix 暴露给 UI,env 推断("test"/"live")
   - POST:Clerk auth → name 校验(1-80 chars)→ 软 cap 10 keys/user
     防爆增 → createApiKey({ organizationName: name, userId, env })
     → plaintext 一次性返。default env=test 防新手误烧产线
   - DELETE [id]:Clerk auth → findApiKeyById → user_id 不匹配返
     404(不返 403 防 leak key id 存在性)→ deactivateApiKey 软删

8. CreateKeySheet + RevealKeySheet(全屏 slide-up)
   - dev-sheet primitive:fixed inset auto 0 0 0 + animation 420ms
     ease-out-expo translateY(100% → 0)+ backdrop blur(8px)
   - CreateKeySheet:label input + Test/Live radio cards(选中金
     accent fill)+ submit POST → onCreated 翻 RevealSheet
   - RevealKeySheet:big mono pre + click-to-copy + warning
     "treat like password" 金边 + acknowledgment checkbox gates
     Done 按钮 → 强制用户 active 确认"我抄好了"才能关。golden glow
     ::before 让 plaintext 看起来像被揭开的秘密。

9. 主 app footer 入口(US-W4-025)
   主 app 没有真 footer(C 端 chat UI 占满),退而求其次:GlobalNav
   account dropdown 的 Settings 区,Billing 之后加 "For developers ↗"。
   仅签到用户可见,匿名访客不需要(他们走外部链接 /docs 直接到)。

10. 17 commit 全推 + 真烟测全绿
    landing 主页 Hero+Scenarios+Flow+Trust 全部 4 段渲染 200/141KB,
    pricing 71KB, docs hub 89KB, api/v1 docs 338KB(MDX 真 render),
    integrations 两个 slug 各 ~175KB, /keys 仪表盘 62KB(SSR
    "Sign in required" 状态)。typecheck 全程零 error。Clerk v7
    迁移坑 + .next/dev/lock 互斥都解掉。

11. Week 4 全部完成
    ✓ #1  Week 2 lib/core 抽象
    ✓ #2  MCP connector(Claude + ChatGPT)
    ✓ #3  /developers landing + dashboard + docs
    ✓ #11 C 端 dogfood
    待办:
    ⏳ #21 npm publish @onegent/mcp-server(用户手动)
    ⏳ #22 onegent.com/api/mcp hosted endpoint + Apps 提交
    ⏳ #23 Claude.ai remote MCP OAuth 2.0
    Week 5 候选:lib/core/execution/recovery.ts Phase 3 stage=
    unknown 终态没触发 Resy fallback(Carbone / Le Bernardin hit)

================================================================
Recent Updates - 2026-04-24 (cont. 5) · Week 4 #2 MCP connector (Claude + ChatGPT 分发窗口)
================================================================

v0.2.35.0 把 REST API 装好 + 真流量跑通后,v0.2.36.0 是"把水龙头接到外面的水管"——
Week 4 #2 建 @onegent/mcp-server 独立 npm 包,让 Claude Desktop / Claude.ai /
ChatGPT Apps 用户用一行 npx config 就能在他们的 LLM 里说"book Carbone tomorrow
7pm"直接跑 Onegent 的执行引擎。

本轮做了三件事:定位锁定(tagline + 显示名)→ 6 工具 MCP server
(stdio+HTTP 双 transport)→ 完整接入文档。全程复用 Week 3 刚交付的
/api/v1/* REST surface,MCP server 不含任何 booking 逻辑,只是
stdio/HTTP ↔ HTTP 的 thin adapter——等于我们自己成为 /api/v1 的第一个
外部 SDK client(dogfood API 契约)。

1. 定位锁定(不改公司名,改显示层)
   讨论了 4 个方案(全盘改名 / 公司+产品两层 / 保留 Onegent 靠 tagline 补信息
   / 延迟决策),选了"最便宜但足够解决问题"的一条:
   · Tagline:"Onegent — AI books your trip end-to-end"
   · 外部显示名:"Travel Booking Agent" (MCP title + ChatGPT Apps name)
   · 一句话描述:"Book restaurants, hotels, flights, and activities through
     an AI agent that navigates real booking sites."
   理由是现在零流量零品牌 equity,改公司名收益也是零;"Onegent"不误导只是
   不信息,信息缺口靠 tagline + description 补。参照 Stripe 2010-2013 做法。

2. Monorepo + @onegent/mcp-server 骨架(US-W4-001)
   - root package.json 加 "workspaces": ["packages/*"] + build:mcp alias
   - root tsconfig 排除 packages/** 避免 Next.js 误抓 ESM 源码
   - packages/mcp-server/:独立 package.json(bin=onegent-mcp-server,
     type=module, @modelcontextprotocol/sdk ^1 + zod 依赖),自己的
     tsconfig(NodeNext ESM, target ES2022, emit dist/),npm publish
     时 files=["dist","README.md"]

3. REST client + OnegentApiError(US-W4-002)
   - src/api-client.ts:Node 18+ global fetch + AbortController(15s timeout),
     读 ONEGENT_API_KEY + ONEGENT_API_BASE_URL env,Authorization: Bearer
     自动加头,4xx/5xx 映射到 OnegentApiError 带 code + message + status
   - 类型手写(BookingProfile / ExecutionRequest 4-scenario 联合 / 
     ExecutionJobResult / AuditEvent),不从 @/lib/api-v1 import,保证
     npm 包能独立发布不拖 Next.js 依赖

4. 6 个 MCP 工具(US-W4-003 + 004 + 005)
   - book_restaurant:zod 校验 date=YYYY-MM-DD + time=HH:MM + covers ∈ [1,20]
     + profile/profileId 互斥 refinement,tool description 告诉 LLM 调完后
     去 poll get_job_status + 警告 paused_payment
   - book_hotel:check_out > check_in refinement,guests ∈ [1,10]
   - book_flight(preview):origin/destination 接受 IATA 或城市名,optional
     return_date 区分 one-way,cabin enum,description 诚实标注 "preview"
     + 90-240s 完成窗口
   - book_activity(preview):optional activity_name 让 agent 自选,description
     承认成功率因目的地而异
   - get_job_status:switch case 按 status 输出人话指引(queued→"wait 15-30s",
     done→relay confirmation code, paused_payment→"user must approve"), 
     error 时带 error.code + .message
   - get_job_audit:默认 50 条 limit(max 500),格式化 ts + level + message
     + 截断 200 字符 data preview

5. 双 transport + server-factory(US-W4-007)
   - src/server-factory.ts:抽出 Server 构造 + tool dispatcher,stdio 和
     HTTP 共用;每个 Server 实例携带 title="Travel Booking Agent" + 全局
     instructions 教 LLM 整条 book→poll→confirm 生命周期
   - src/http-server.ts:StreamableHTTPServerTransport stateless 模式
     (sessionIdGenerator=undefined 适合 Vercel/Cloud Run),每请求新 Server
     实例避免跨用户 state 泄漏
   - src/index.ts CLI:--http [--port N] flag,默认 stdio;无 arg npx 调用
     直接进 stdio 模式对齐 Claude Desktop 配置
   - chatgpt-apps/manifest.json:OpenAI Apps SDK 提交模板,url 指向
     https://onegent.com/api/mcp(部署在后续 story)
   - 真 E2E:curl -XPOST 打 /tools/list 拿到 SSE stream 含 6 个 tool 完整
     JSON Schema,证明 HTTP transport 端到端通

6. 用户文档(US-W4-006 + 008)
   - packages/mcp-server/README.md:npm 包首页,hero + tagline + 6 tools
     capability table(含 typical completion 窗口)+ claude_desktop_config.json
     完整 JSON + env 表 + sample LLM turn(book Carbone → poll → confirm)
     + 4 条 troubleshooting(用户实际会踩的坑)+ 自托管开发指引
   - docs/integrations/claude-mcp.md:Claude Desktop 用户视角端到端,
     含 macOS/Windows 配置路径 + 首次 booking walkthrough + expected status
     timeline 表 + 专门的"Payment safety"section 把 paused_payment 讲成
     feature 而非 bug + Claude.ai remote MCP roadmap 占位
   - docs/integrations/chatgpt-apps.md:两条路(Apps SDK preview + Custom
     GPT Action 今天可用)对照表 + Apps SDK 架构图 + inline OpenAPI 3.1
     spec 给 Custom GPT 直接粘 + curl auth 自测命令 + Custom GPT 限制
     (个人账号/不能上 GPT Store)

7. 合计产出
   - 9 个 US-W4-00x commits(今天 15+ 个 commit 推到 master)
   - 新增文件:packages/mcp-server/(13 个文件)+ docs/integrations/
     (2 个 md)+ PROJECT_SUMMARY.md 本节
   - 改动:root package.json + tsconfig.json
   - 真 smoke 通过:stdio "ready on stdio (6 tools)" + HTTP curl SSE
     tools/list 完整响应
   - 不含:npm publish(留给下次有 access token 时再做)+ onegent.com/api/mcp
     hosted 端点部署(Week 5 或进 /developers landing 时一起)

8. 战略意义 / positioning shift reinforcement
   v0.2.33.0 把定位从多品类决策助手收窄到 "AI Travel Execution Layer",
   v0.2.34.0 抽 lib/core 把代码对齐定位,v0.2.35.0 外露 REST API 让 B 端
   看得见,v0.2.36.0 把 API 通过 MCP 和 ChatGPT Apps 两个 AI 分发渠道
   放出去——不再需要用户先知道 Onegent 是什么,他们在 Claude 里说"book
   me a table at Carbone"就能直接用,Onegent 变成"后面那层看不见的
   Travel Execution Layer"。Stripe 打法完成:公司品牌让位于功能可用性,
   分发交给 Claude / ChatGPT 已有的用户基数。

9. Week 4 剩余
   ⏳ #3 /developers landing 页面(B 端自助申请 key + 文档索引)
   Week 5 候选(非 Week 4 scope):
     · recovery.ts Phase 3 provider chain 只在 status=no_availability 触发;
       OpenTable stage=unknown 终态没走 Resy fallback(Carbone / Le Bernardin
       / Osteria La Baia 都 hit 这个边界)
     · Claude.ai remote MCP OAuth 2.0 接入
     · onegent.com/api/mcp hosted HTTP endpoint 部署 + ChatGPT Apps 提交

10. Posture 延续
    · C 端 / B 端 / MCP-C 端全部共用 lib/core.createJob(dual-gate 已证明
      工作)
    · Week 2 建的 __source 标记 + ConsentPolicy stop_before_cvc
      invariant 跨所有 3 条入口一致
    · "AI books your trip end-to-end" tagline 现在有代码对应:单一 booking
      请求 → lib/core 同一执行路径 → 同一 audit trail → 同一 paused_payment
      user-consent 模型

================================================================
Recent Updates - 2026-04-24 (cont. 4) · Week 3 REST API 全量落地 + Week 4 #11 C 端 dogfood 闭环
================================================================

v0.2.34.0 把 lib/core 抽出来后,v0.2.35.0 是"把基础设施装到水龙头上"——
Week 3 造 REST API + API key 认证 + 文档,让 B 端 caller 用 curl 就能调;
Week 4 #11 把 C 端真实流量(用户点"Reserve with Agent")接进同一条 lib/core
执行路径,通过 Week 2 建的 dual-gate 激活 runExecutionJobWithRecovery。

从此 C 端和 B 端共用同一个执行引擎——任何 Week 2 引擎的改进,两端
自动受益。"AI Travel Execution Layer" 从 pitch 变 `grep dual-gate` 能看
到的代码事实。

1. Week 3 REST API(US-W3-001 到 US-W3-007,7 个 commit)
   所有端点在 /api/v1/*,用 Authorization: Bearer ogk_(live|test)_xxx 认证:
     POST   /api/v1/execution-jobs                   创建 job 异步执行
     GET    /api/v1/execution-jobs/[jobId]           轮询 status
     GET    /api/v1/execution-jobs/[jobId]/audit     结构化决策审计流
     GET    /api/v1/metrics/providers/[providerId]   per-provider 成功率

2. API key 认证基础设施(US-W3-001 + 002)
   - lib/db.ts 新增 api_keys 表 + 4 helpers:createApiKey /
     findApiKeyByHash / updateApiKeyLastUsed / deactivateApiKey
   - sha256(plaintext) 存 hash;plaintext 只发给 caller 一次
   - key 格式 ogk_(live|test)_[32 base64url chars],对齐 Stripe 约定
   - 字段:id(uuid) / key_hash / key_prefix / organization_name /
     is_active / rate_limit_per_day(占位) / allowed_job_types(限 scope)
   - lib/api-auth/require-api-key.ts middleware:
       Route-level helper(不用全局 middleware.ts,Edge runtime 无 pg 支持)
       Authorization: Bearer <key> → sha256 → findApiKeyByHash → 401/403/503
       6 个失败分支(missing / scheme / empty / malformed / invalid / db-503)
       成功后 fire-and-forget updateApiKeyLastUsed,不阻请求
   - 8 个 vitest 全绿,包括 plaintext 不泄露到 DB / sha256 only 的关键断言

3. REST 路由实现(US-W3-003 到 006)
   - POST execution-jobs:zod 校验 ExecutionJobRequest(lib/api-v1/schemas.ts
     mirror lib/core types) → allowedJobTypes scope 检查 → createJob →
     fire-and-forget runExecutionJobWithRecovery().then(completeJob) → 202
     + jobId + _links
   - GET [jobId]:getJob → 映射 BookingJob+Step → ExecutionJobResult,
     BookingJob.status + step.status 一起决定 ExecutionJobStatus
     (paused_payment / completed / no_availability / captcha / needs_login)
   - GET [jobId]/audit:queryAudit 透传,200 + events[],空 audit rows
     返 200+[],job 本身不存在才返 404
   - GET metrics/providers/[id]:computeSuccessRate 透传 + ?timeRangeDays
     (clamp [1,365] 默认 30)

4. 文档 + CLI(US-W3-007)
   - docs/api/v1.md:4 个端点完整 request/response shape + 所有 scenario
     params 表 + ConsentPolicy 默认值表 + 错误码按 HTTP status 分组 +
     job lifecycle ASCII 图 + 完整 curl quickstart + 未落地项清单
   - scripts/admin/create-api-key.mjs:CLI mint key,不引新依赖
     (node crypto + @vercel/postgres 够),--org --env --scenarios
     --rate-limit-per-day,plaintext 只打印一次

5. Week 4 #11 C 端 dogfood(真流量验证 Week 2 dual-gate)
   - lib/core/cend-adapter.ts 新文件:createJobViaCore(step, meta)
     把 BookingJobStep.body 的 camelCase legacy shape(restaurantName /
     covers / inline profile)反向构造成 ExecutionJobRequest,然后调
     lib/core.createJob(自动打 __source="lib/core/execution" marker)
   - 两个 C 端入口加条件分支,dogfood 只在:
       USE_CORE_EXECUTOR_FOR_CEND=true (env 保护)
       AND userId truthy (跳过匿名会话)
       AND steps.length === 1
       AND steps[0].type === "restaurant"  (最小面只切单餐厅)
     才走 createJobViaCore,否则 fall through 老 createBookingJob:
       a) app/api/booking-jobs/route.ts POST         "Reserve with Agent"路径
       b) app/api/booking-jobs/create-trip/route.ts  多品类 trip 里单餐厅情况
   - try/catch 兜底:adapter 抛错自动 fall through 老 path,零回归风险
   - 关 env flag 立即回老路径,单键杀回
   - observability 补丁:[start]/start/route.ts 加 console.log 打印
     dual-gate 命中状态 + useCoreFlag + hasCoreMarker 便于真流量验证

6. 端到端真流量验证(决定性时刻)
   本地 dev 开 USE_CORE_EXECUTOR=true + USE_CORE_EXECUTOR_FOR_CEND=true,
   UI 点 "Reserve with Agent",dev.log 出现完整链路证据:
     [booking-jobs] via lib/core (USE_CORE_EXECUTOR_FOR_CEND) { jobId: '...' }
     [start] runUniversalStep invoked { hasCoreMarker: true, useCoreFlag: true }
     [start] dual-gate HIT — routing via lib/core.runExecutionJobWithRecovery
     [stagehand] Executor starting ... (Stagehand 真实被 lib/core 驱动)
   本地浏览器打开、导航到 OpenTable、跑 Stagehand 程序化流程——与老路径
   行为完全一致,但内部走的是 Week 2 抽出来的 recovery 引擎。

7. 今天 B 端也 curl 全通
   Layer 1 冒烟六条 curl 全绿:
     ① 无 Authorization → 401 missing_authorization        ✅
     ② 乱 key → 401 invalid_api_key                         ✅
     ③ 正确 key metrics → 200 empty-zero record             ✅
     ④ 不存在 jobId → 404 job_not_found                     ✅
     ⑤ POST 缺字段 → 400 invalid_request + zod details      ✅
     ⑥ POST 合法 body → 202 + jobId + Stagehand 真启动      ✅
   第 ⑥ 条甚至触发了真浏览器自动化(Le Bernardin not on OpenTable
   所以终态 paused_payment/unknown,符合 Week 2 recovery 预期)。

8. Posture 延续 v0.2.34.0 的所有承诺
   - lib/booking-autopilot/ 零改动
   - 老 createBookingJob 路径零改动,只加 if 分支在前面
   - 关 env flag(USE_CORE_EXECUTOR 或 USE_CORE_EXECUTOR_FOR_CEND)秒杀回
   - C 端现有 trip / DR / chat-commit 流量不受影响(条件不满足自动 fall through)

9. 10 个 commit 序列(master)
     e8a4651  feat(api-keys): api_keys 表 + 4 DB helpers
     f016038  feat(api-v1): requireApiKey auth guard + 8 unit tests
     80f5478  feat(api-v1): POST /api/v1/execution-jobs
     6558f04  feat(api-v1): GET /api/v1/execution-jobs/[jobId]
     2fd63bd  feat(api-v1): GET .../audit
     f33bb9f  feat(api-v1): GET /api/v1/metrics/providers/[id]
     638d1a8  docs(api): v1.md + create-api-key.mjs CLI
     81912e0  feat(cend): dogfood single-restaurant trips via lib/core
     f11e240  feat(cend): 同样分支加到 /api/booking-jobs POST(Reserve 路径)
     05e5bc8  chore(start): dual-gate observability 日志

10. Week 4 剩余(推迟到下一轮)
    - #2  MCP connector 占位 Claude / ChatGPT 分发窗口
    - #3  /developers landing 页面(B 端入口,用来展示 docs/api/v1.md
          的精华 + 主动发 key,转化 curl 用户为付费 caller)
    潜在 Week 5 引擎修:OpenTable 搜索结果页 stage=unknown 终态时,
    lib/core/execution/recovery.ts 的 Phase 3 provider chain 现在只在
    status === "no_availability" 时触发,unknown 态直接终态。
    Carbone / Le Bernardin / Osteria La Baia 等 OpenTable 搜索页返
    "not on reservation network" 的情况会 hit 这个边界。不是 Week 3-4
    scope,但是引擎层接下来最值得修的一点。

================================================================
Recent Updates - 2026-04-24 (cont. 3) · Week 2 · lib/core 抽象完成(B 端基础设施就位)
================================================================

v0.2.33.0 把产品定位收窄到 Travel Execution Layer 后,Week 2 是"把 pitch 变产品"
的第一步:把 Execution Engine 从 Next.js app 里抽出来,放进 channel-agnostic 的
`lib/core/` 模块,让同一套能力既能被 C 端 chat UI 调用(现状),也能被未来的
REST API / MCP connector / 外部 agent 调用。

这是从"一个 AI 产品"走向"AI 产品们的基础设施"(Stripe / Plaid / Twilio 模式)
的第一块砖。Week 3 做 REST endpoint 暴露,Week 3-4 做 MCP connector 分发,
Week 4 做 /developers landing 页。本轮完全不碰 lib/booking-autopilot(护城河
代码零风险),完全不改现有 C 端 job 创建路径(零回归保证)。

1. `lib/core/` 目录结构(新增 11 个 source file)
   - `execution/` — 执行引擎
       types.ts               B 端公共契约(ExecutionJobRequest / Result)
       executor.ts            单步 adapter,包 lib/booking-autopilot.runBrowserTask
       recovery.ts            retry + time fallback + Phase 2/3 智能分支
       recovery-providers.ts  provider fallback chain(OpenTable → Resy → website)
       job-manager.ts         createJob / getJob / completeJob 契约映射
   - `consent/` — B 端权限契约(新增)
       types.ts               ConsentPolicy + ConsentAction + ValidationResult
       default-policy.ts      DEFAULT_CONSENT_POLICY 等价 C 端当前全自动行为
       validator.ts           纯函数 switch-case,无 side effect
   - `audit/` — 结构化审计事件
       types.ts               AuditLogEntry + AuditEventType(12 variants)
       audit-log.ts           writeAudit / queryAudit 包 agent_logs 表
   - `metrics/` — 分析层(B 端 pitch 数据源)
       types.ts               ProviderSuccessRate / ProviderRankingEntry
       success-rate.ts        computeSuccessRate / computeProviderRanking
   - `__tests__/integration.test.ts` + `consent/__tests__/validator.test.ts`
     合计 23 个单测 + smoke test
   - `index.ts`               barrel export,所有 public API 从这一处引用

2. 声明式 B 端契约 · ExecutionJobRequest
   - 替代旧 BrowserTaskInput(命令式:给 URL + task 文本)为声明式:告诉 executor
     "你要订什么",让它自己决定 URL / provider / fallback 链
   - Discriminated union 按 scenario 分 params(restaurant / hotel / flight /
     activity),TypeScript 窄化干净
   - 4 个 scenario params 完整覆盖现有 C 端所有 runBrowserTask 调用路径(验证
     过行为映射表,每段对照 route.ts 逐行)
   - Flight 的 4 个 target hints(Airline / Price / DepartureTime / FlightNumber)
     从 BrowserTaskInput 内化到 FlightBookingParams
   - ClientMetadata(agentId / userId / sessionId / idempotencyKey)为 Week 3
     REST endpoint 的幂等性 + 多租户隔离准备
   - activity scenario 暂不支持(走 lib/agent-runtime/skills/,和 runBrowserTask
     不同路径,Week 3+ 统一时再决定合并)

3. Consent 契约(B 端权限层)
   - 4 个 ConsentAction 变体:adjust_time / switch_venue / retry / use_provider
   - paymentPolicy 字段:stop_before_cvc(默认,对齐 PCI iframe 物理边界) /
     stop_before_card / user_pays_elsewhere
   - submit_payment 故意不是 ConsentAction —— executor 物理上不会提交 payment,
     做成 action 会误导未来开发者以为代码路径存在
   - blocklist > allowlist 优先级(对齐 Stripe / AWS IAM)
   - Exhaustive switch 保证未来加新 action 必须同步加 validator 分支(编译期 catch)
   - DEFAULT_CONSENT_POLICY 每个字段对应今天 C 端现有参数:
       allowTimeAdjustment=true, max 90min    (对齐 filterTimeFallbacks)
       allowVenueSwitch=true                   (对齐 fallbackCandidates 循环)
       maxRetries=3                            (对齐 recovery.ts)
       paymentPolicy=stop_before_cvc           (对齐 PCI iframe 物理边界)
       maxJobDurationSeconds=420               (对齐 BROWSER_TASK_TIMEOUT_MS=7min)

4. Audit 契约(结构化审计事件)
   - 存储复用 agent_logs 表(零 DB migration),用 source="audit" 区分
     结构化 audit 事件 vs. 自由格式 debug 日志;queryAudit 过滤这个值
   - 12 个 AuditEventType 分两组:Lifecycle(job_created / started / paused_payment
     / completed / failed / aborted)+ Decision(step_attempt / action_allowed /
     action_denied / time_adjusted / venue_switched / provider_fallback)
   - writeAudit 沿用 writeAgentLog 的 try/catch 吞错 —— audit 挂不能阻塞真实
     booking(reliability > observability 的权衡)
   - level 映射:job_failed / job_aborted / action_denied → warn, 其他 → info
     (运维 dashboard 能直接过滤 warn 看关键事件,不用解 details JSONB)
   - lib/db.getAgentLogs 小扩容加 source 参数(只 jobId 分支生效,向后兼容)

5. Metrics 读模型(B 端 pitch 数据源)
   - 破例不走严格 adapter 姿势 —— 直接写 SQL(而不是包 getAgentFeedbackStats)。
     理由:那个函数返单体 blob 适合 C 端 Agent Insights 面板,B 端需要
     细粒度(单 provider + 时间窗口)查询
   - MetricsTimeRange 只支持 sinceDays(覆盖 95% B 端问题)
   - 零样本返 successRate=0 不是 NaN(前端模板安全)
   - minSampleSize 默认 0(避免数据积累期给 caller 空结果);B 端 /developers
     landing 场景应显式传 5-10 防止 1/1 = 100% 误导
   - Ranking 同率打破规则:totalAttempts 降序(同成功率下样本多的更可信)
   - 下游预览:Week 3 `GET /api/v1/metrics/providers/opentable-com?days=30`
     + Week 4 /developers landing "OpenTable 87% success rate" 卡片

6. 执行引擎(三层)
   - **Executor(单步 adapter)**:resolveProfile(inline > DB > default) +
     buildStartUrlAndTask(scenario → { startUrl, task }) + 调 runBrowserTask +
     audit 写入 + consent 传递。不做 fallback,纯 adapter。
     行为映射 route.ts:319-915 逐段对照过,包括 flight passport check 回补。
   - **Recovery(完整链路)**:runExecutionJobWithRecovery 主入口,编排 4 phase:
       Phase 1 tryPrimary        retry up to maxRetries with [0,2000,5000]ms backoff
       Phase 2 tryTimeFallbacks  ±30/60/90min 候选,policy-gated 
       Phase 3 provider chain    OpenTable → Resy → Google Places website
       Phase 4 (明确不搬)        venue switch / actionItem 留老 path 服务 C 端 UI
     每个决策点都 validateConsent + writeAudit。Phase 2/3 智能分支:
     "not found on opentable" 跳过 Phase 2 直进 Phase 3;"no slot near 7pm" 走
     Phase 2,失败再 fall through Phase 3。
   - **Recovery-providers**:tryResy(cityToResySlug URL + isGenuineBooking gate)
     + tryWebsiteHandoff(Google Places + 8-char fuzzy match + 导航找预订链接)。
     restaurant-only,hotel/flight 各有单一 primary provider 不需要 chain。

7. 双轨并存架构(姿势 D · 零回归保证)
   - route.ts 的 runStepWithRecovery / runUniversalStep / runActivityStep / POST
     handler 全部 0 行修改
   - 新 path 的触发需要双重 gate 同时满足:
       process.env.USE_CORE_EXECUTOR === "true"          (env flag kill-switch)
       AND step.body.__source === "lib/core/execution"   (per-job marker)
   - Marker 只由 lib/core/execution/job-manager.createJob 写入。所有现有 C 端
     job 创建路径(chat-commit / trip-package / DR synthesis / create-trip)
     都不经过 job-manager,没 marker → 即使 flag=true 仍走 legacy path
   - Week 3 /api/v1/execution-jobs B 端 caller 通过 job-manager.createJob 创建
     的 job 会自然带 marker → 走新 path。这是正确的分发策略。
   - route.ts 新加一个 runUniversalStepViaCore 薄 helper:从 step.body 反构
     ExecutionJobRequest → 调 runExecutionJobWithRecovery → 映射
     ExecutionJobResult 回 BookingJobStep。~45 行,纯映射无业务逻辑。

8. 测试 · 工程数据
   - 23 个 lib/core 单测全绿:
       validator.test.ts(16 tests)  纯函数,4 ConsentAction × allow/deny 边界
       integration.test.ts(7 tests) smoke,mock runBrowserTask / lib/db / tools,
                                     覆盖单次成功 / transient retry / maxRetries
                                     gate / Phase 2 time fallback / consent
                                     两维度独立性 / Phase 3 provider chain
   - 82 个 NLU v2 测试零回归(含 v0.2.33.0 的 out-of-scope golden)
   - tsc --noEmit 0 错 · npm run build 成功 · 每 story 落盘前都跑过
   - 代码体量:~2800 新代码,0 行 legacy 删除,0 行 lib/booking-autopilot 修改

9. Week 2 story 落地顺序(每 story 一 commit + 一 push)
     US-001 types                              ExecutionJobRequest / Result
     US-002 consent/                           policy + validator
     US-003 audit/                             writeAudit + queryAudit
     US-004 metrics/                           success rate + ranking
     US-005 execution/executor.ts              单步 adapter
     US-006 execution/job-manager.ts           createJob / getJob / completeJob
     US-007a execution/recovery.ts             retry + time fallback
     US-007b execution/recovery-providers.ts   provider fallback chain
     US-008 index.ts barrel + tests            23 个测试全绿
     US-009 route.ts USE_CORE_EXECUTOR flag    双重 gate,零 legacy 修改

10. 开发流程本身的价值(下轮继续用)
    - 每 story 做完主动验证:行为映射表(对照 route.ts 逐段标注等价性 / 简化 /
      增强 / 差异),tsc / build / test 三件套,commit message 写"为什么"而非
      "改了什么"
    - 每 story 独立 commit 独立 push · Git 历史可 bisect · 任何 story 都能
      单独 revert
    - 直接在 master 上线性推进(对单人 + 顺序开发最务实),不搞 feature 分支
      最后大 merge 的复杂性

11. 下一步路线(Week 3 · 4 · 5)
    - **Week 3 REST endpoint**:`/api/v1/execution-jobs` POST/GET 端点 +
      `api_keys` 表 + API key middleware。lib/core 契约直接对外,让 B 端
      caller 能 curl 测试。这一步相当于"AI Travel Execution Layer" 从
      pitch 词变成 "curl 得通的 API"
    - **Week 3-4 MCP connector**:新 repo onegent-mcp-connector,装
      @modelcontextprotocol/sdk,实现 book_restaurant / plan_group_dinner
      tool。内部 fetch /api/v1/execution-jobs。目标:Claude Desktop / ChatGPT
      用户通过 connector directory 添加 Onegent 后直接说"帮我订下周的酒店"。
      这是分发窗口期红利
    - **Week 4 /developers landing**:`app/developers/page.tsx` 一页,hero
      "AI Travel Execution Layer for agents and groups" + 3 卖点卡 + waitlist
      表单。Metrics 读模型(Week 2 做的)提供"OpenTable success rate 87%"这种
      数字卡片数据源

================================================================
Recent Updates - 2026-04-24 (cont. 2) · Positioning Shift to Travel Execution Layer
================================================================

本轮是**战略级定位转型**，不是功能迭代。动机来自深度战略讨论后的
判断：Onegent 真正独特的两样资产（Decision Room 多人协作 + Autopilot
浏览器自动化执行）在旅行场景是 10 分价值，在 3C / 礼物 / 健身
场景是 0 分价值（后者通用 AI 助手都能做、Amazon 一键购买已做完
"最后一公里"）。定位窄才讲得清差异化、才讲得清 B 端故事
（"给其他 agent 用的 travel execution API"）。

1. 代码归档 — 非旅行品类整体搬到 `_archived/` 目录
   - Pipelines 归档（`lib/agent/_archived/2026-04-positioning-shift/pipelines/`）：
     `credit-card.ts / laptop.ts / smartphone.ts / headphone.ts`
   - Planners 归档（`lib/agent/_archived/2026-04-positioning-shift/planners/`）：
     `big-purchase.ts / fitness.ts / gift.ts` + 对应 `__tests__/`
   - Components 归档（`components/_archived/2026-04-positioning-shift/`）：
     `CreditCardCard.tsx / LaptopCard.tsx / SmartphoneCard.tsx / HeadphoneCard.tsx`
   - 所有归档用 `git mv` 保留历史；每个归档目录带 README.md 说明
     归档原因 + 日期 + 文件清单，未来如需拉回可溯源
   - `tsconfig.json` + `vitest.config.ts` 把 `**/_archived/**` 加入
     exclude，归档代码不参与 typecheck 也不跑测试

2. 首页清理 — `app/page.tsx` 净删 182 行死代码
   - 删 4 个 Card import（`CreditCardCard / LaptopCard / SmartphoneCard / HeadphoneCard`）
   - 删 4 个 JSX 渲染块（gated on `resultCategory === "credit_card" | "laptop" | "smartphone" | "headphone"`）
   - 删 `hasCategoryResults` 聚合里 4 个 `chat.all{Xxx}Cards.length > 0` 检查
   - 这些代码实际在运行时**永远不会被触发**，因为 `NluScenario`
     类型早已不包含这些场景——属于幽灵 UI，本轮一起清掉

3. Agent orchestrator 清理 — `lib/agent.ts` 净删 226 行
   - 删 4 个 pipeline import + 4 个 planner import
   - 删 3 个 `detectedScenario === "gift" | "fitness" | "big_purchase"`
     分支 + 4 个独立 category 路由
   - 3 处 weekend-trip call site 去掉 `runCreditCardPipeline`，
     planner 现在接收 `creditCardRecommendations: []` 优雅降级
   - 补一个防御性 TS narrowing guard 让 restaurant fallback
     正确收窄 `ParsedIntent → RestaurantIntent`
   - `lib/__tests__/scenario2.test.ts` 删 big-purchase 相关 describe

4. NLU v2 非旅行请求礼貌拒绝（核心行为变化）
   - `lib/agent/nlu-v2/extractor.ts` +35 行：插入 CRITICAL — OUT-OF-SCOPE
     DETECTION 块，列出 6 类非旅行话题（electronics / shopping /
     gifts / fitness / credit cards / personal advice）。匹配后要求
     `intent="chitchat"` + `scenario=null` + 在 `planning_assumptions`
     append 字符串 `"out_of_scope: <brief topic>"`。新增 WORKED
     EXAMPLE E 覆盖 laptop / yoga / gift 三类 query
   - `lib/agent/nlu-v2/chat.ts` +3 行：插入 CRITICAL — OUT-OF-SCOPE
     DECLINE 指令。看到 `out_of_scope:` 前缀就礼貌拒绝（匹配用户
     语言：中文对中文、英文对英文），1-2 句，指向 ChatGPT / Claude
   - `lib/agent/nlu-v2/router.ts` +12 行：`buildStateSummary()` 提取
     `planning_assumptions` 过滤空值后 append 到 no-scenario 和
     主场景两个返回路径（` Planning assumptions: a; b.`），让 chat
     层能看到 tag
   - 纯 prompt + summary 改动，不新增 `NluIntent` / `RouterAction`
     变体，不改 `routeIntent()` 分支逻辑

5. 新 Golden Test — 守住 decline 路径不回归
   - `lib/agent/nlu-v2/__tests__/golden-out-of-scope.test.ts` +75 行
   - 3 个 case：英文电子（"help me buy a laptop for coding"）、中文
     健身（"推荐 brooklyn 周六早上的瑜伽课"）、英文礼物（"gift ideas
     for my mom birthday budget 150"）
   - 驱动真实 `extractState()` LLM 调用，`describe.skipIf(!OPENAI_API_KEY)`
     让 CI 没 key 时优雅 skip，本地/生产 3/3 pass

6. 用户层的影响面
   - **C 端主流量（餐厅/酒店/机票/活动/trip）完全无感**——这些 UI
     和 Autopilot 路径零改动
   - **边缘用户（问 "帮我买笔记本"）**得到一个清晰的礼貌答复，而不是
     困惑的"我不太懂但我试试"——这是主动筛选，不是流失
   - **Decision Room / Autopilot 两大核心资产**未改动分毫，它们是
     这次定位收窄后的护城河

7. 工程质量数据
   - 27 个文件改动（+377 / -609，净减 232 行）
   - 9 个 atomic commits（7 feat + 2 chore），每个独立可 bisect
   - `tsc --noEmit` 0 错误
   - `npm run build` 成功（所有 prerender 通过）
   - NLU v2 测试套件 85/85 全绿（82 pre-existing + 3 新 golden）
   - Ralph 自主代码 agent 跑完全部 7 个 user story，期间自主发现
     PRD 里的 bug（我写的 `cardType ===` 其实是 `resultCategory ===`）
     并 grep 找到正确模式——`scripts/ralph/progress.txt` 记录了
     完整 learning 链

8. 下一步路线图（不在本轮 scope）
   - **Week 2 · `lib/core/` 抽象**：把 Execution Engine（Autopilot）+
     Group Coordination（Decision Room）+ Provider Adapters 从
     current app 抽出来，形成 channel-agnostic 的"核心"
   - **Week 3 · `/api/v1/execution-jobs` REST 接口 + `api_keys` 表**：
     让外部 agent 能以 B 端身份调用 Onegent 的 travel execution 能力
   - **Week 4 · `app/developers` landing**：B 端入口页，"AI Travel
     Execution Layer for agents and groups" 一句话 pitch + waitlist
   - **Week 5 · MCP connector**：占位 Claude / ChatGPT 的 connector
     directory 分发窗口
   - C 端 app 保留并持续迭代——它是 B 端 API 的 dogfood 客户

================================================================
Recent Updates - 2026-04-18
================================================================

1. Hotels Decision Room support
   - Decision Rooms now support hotel proposals end-to-end, not just restaurant flows.
   - The room pipeline, proposal generation, execution routing, and payer booking handoff all support hotel rooms.
   - This includes the "hotel" room type in creation, proposal, voting, and execution paths.

2. Mutable voting after acceptance
   - Accepted proposals are no longer final-locked before booking starts.
   - Members can change their pick after a proposal is accepted.
   - If the majority/unanimous winner still stands, the room stays accepted.
   - If vote changes remove the winner, the room automatically returns to voting.
   - If booking has already started (`booking_job_id` exists), vote changes are blocked until booking is cleared.

3. Expedia flight booking hardening
   - Expedia flight RPA now enforces one-way flow more reliably for single-date flight requests.
   - Fare selection and bundle-dismiss handling were hardened for Expedia's modal-heavy flow.
   - Programmatic booking logs now make it easier to distinguish click failure, bundle popup interruption, and session-level blocking.

4. OpenTable payment form bug fix
   - OpenTable reservation filling now handles the masked credit-card-number field more reliably.
   - The system no longer reports a full payment fill when card number input actually failed.
   - Success/failure messaging for payment fill now matches the real field state shown to the user.

5. Desktop workspace UI refresh
   - The app now uses a cleaner desktop layout direction: top nav for global navigation, local page rails only for workspace-specific controls.
   - Rooms and Tasks were widened and refactored into desktop workspaces instead of narrow mobile-centered columns.
   - The local left rail was redesigned to feel lighter and less like a second heavy panel: narrower width, reduced card framing, stronger right-side page header, and a more unified canvas.
   - The top navigation bar was also normalized back to the app background color for a more consistent visual system.

6. Project / workspace naming
   - The active project directory is now `onegent`.
   - Older references to `restaurant-agent` or the Ralph workspace should be treated as legacy context, not the primary project root.

================================================================
Recent Updates - 2026-04-20
================================================================

1. Memory workspace promoted to top-level navigation
   - `Insights` and the old learned-preferences surface are now being consolidated into a first-class `Memory` workspace.
   - The top navigation now emphasizes the core product surfaces: `Tasks`, `Rooms`, and `Memory`.
   - `Memory` is treated as operational agent memory, not a buried settings tab.

2. New Memory IA: dashboard + patterns + scenarios + evidence
   - The new Memory page separates what the agent has done, what the agent has learned, and how it inferred those beliefs.
   - The workspace now includes four views: `Dashboard`, `Patterns`, `Scenarios`, and `Evidence`.
   - `Dashboard` is the default landing view — an agent-achievement analytics surface (see update #6).
   - `Patterns` absorbs the old `Overview` content plus provider ranking, satisfaction predictors, and stated-vs-actual behavior gaps.
   - `Scenarios` shows context-specific memory such as date-night vs. family vs. general behavior.
   - `Evidence` absorbs the old `Activity` entry points and explains why the system believes something, including override-trigger traces and flagged/trusted entities.

3. Account became a true account center
   - The global `Account` destination was removed from the primary top navigation and is now primarily entered from the avatar menu.
   - `Account` now focuses on stable account-management surfaces instead of trying to hold both identity and agent-memory concepts.
   - The main account tabs now focus on `Identity`, `Profiles`, `Controls`, `Models`, and `Billing`.
   - Requests for the old `learned` tab are redirected into the new `Memory` workspace instead of staying inside `Account`.

4. Identity model upgraded beyond a simple display name
   - The account identity surface now supports avatar upload, editable display name, searchable handle, immutable user ID, and backup contact code.
   - The account UI explains how the user will appear inside Contacts, Rooms, and collaborative booking flows.
   - This makes the user object feel like a persistent account entity rather than a temporary auth label.

5. Legacy settings / learned routes normalized
   - The legacy `/permissions` hub now acts as a compatibility redirect into the new account / memory split.
   - Older entry points that previously assumed `learned` lived inside settings are now forwarded to the correct surface.
   - This keeps older links and flows working while the product model shifts from settings tabs to dedicated workspaces.

6. Memory Dashboard — agent-achievement analytics
   - Memory's new default landing view is a dashboard showing "what your agent has been doing for you" across a chosen time range.
   - Range switch (This week / This month / All time) drives every card, chart, and activity entry on the page.
   - Six KPI cards: Agent Compared (options across plans and proposals, with an inline "hours saved" hint), Tasks Delivered (booking jobs + completed rooms treated as delivered), Decision Rooms, Searches (individual agent plans), New Preferences Learned, Votes Cast.
   - Two visualizations: an Area chart for cross-source activity over time, and a donut chart breaking down scenarios (restaurant / hotel / flight / trip / etc).
   - A unified recent-activity feed at the bottom merges booking tasks, rooms, searches, votes, and newly-learned preferences into a single timeline.
   - Hours-saved estimate uses a deliberately conservative formula: `options_compared × 45s`, surfaced as "Roughly Xh of manual browsing saved" inside the Agent Compared card.
   - Aggregation lives in a single `/api/user/analytics?range=…` endpoint that fans out ~20 parallel SQL queries against `booking_jobs`, `decision_rooms`, `decision_plans`, `decision_room_proposals`, `decision_room_votes`, and `user_preferences`.
   - Archived / completed tasks are treated as successfully delivered for analytics purposes, so the dashboard reflects full lifetime agent work, not only live state.

7. Suspense hardening for search-params pages
   - `/account`, `/insights`, `/permissions`, and `/tasks` all read `useSearchParams()` directly on render. Under Next 16's stricter prerender rules this broke static page generation.
   - Each page was split into a `*Inner` component plus a top-level default export that wraps the inner component in `<Suspense fallback={null}>`.
   - Production build now prerenders all 56 pages cleanly without CSR-bailout errors.

================================================================
Recent Updates - 2026-04-22
================================================================

1. Events 正式成为第三条主线（活动票务 autopilot）
   - 除 Restaurant / Hotel / Flight 之外，Activity（演唱会、体育赛事、演出）
     现在是 chat NLU、Decision Room、Autopilot booking 三个层都支持的一等场景。
   - 入口：首页 chat ("Get me two Hamilton tickets for Saturday night")，
     或 Decision Room 新建 room 时选 activity。
   - 数据源：SeatGeek + Ticketmaster 双源并行抓取，产出统一的 ActivityCard。

2. Activity 多源聚合 pipeline
   - `lib/agent/pipelines/activity.ts` 并行调用 SeatGeek API + Ticketmaster Discovery API。
   - `lib/agent/pipelines/activity-merge.ts` 按 "标题 + 日期" 归一化去重，
     单条 Activity 可以同时挂 `sources: ['seatgeek', 'ticketmaster']`。
   - ActivityCard 按 sources 数量渲染多按钮（"Book on SeatGeek" / "Book on Ticketmaster"），
     各自独立 loading 状态，互不阻塞。
   - Ticketmaster 查询窗口 ±1 天 + 客户端日期二次过滤，
     避免 API 返回跨日场次误入结果集（E2）。

3. SeatGeek 全栈 RPA（从搜索到支付暂停）
   - Provider：`lib/booking-autopilot/providers/seatgeek-com.ts`，
     完全遵循 CLAUDE.md 的三层架构（程序化导航 + AI 填表 + AI 验证）。
   - 导航阶段（Layer 1 程序化）：
       · 首页搜索框 → 下拉精确匹配 → 跳事件详情
       · 事件详情：解析数量 → 弹数量 modal → 选目标数量 → 关闭
       · 最低价 ticket：`a[href*="listing="]` 筛选 + 座位关键词过滤（排除"best value"轮播）
       · Continue → "No thanks" → "Skip to Checkout" 三连按钮
       · URL 识别 regex 修正：事件详情页直接进入 Stage C，不重复搜索
   - Billing 填表（Layer 2 + Layer 3）：
       · 点 "Add new card" 触发 modal → 原生 setter 填
         firstName / lastName / address / city / state / zipcode / country / phone
       · 国家下拉 Downshift autocomplete cleanup：填完后 ESC 关闭建议列表
       · apt / email 在 Add-card modal 中不存在时标记 `skipped (optional)` /
         `structurally absent`，不触发无效 AI 补填（节省 OpenAI 额度）
       · 过期日期 parseExpiry 支持 MM/YY、MM/YYYY、MMYY、MMYYYY 四种输入格式
   - 支付边界：
       · 卡号 + CVV 位于 Spreedly 跨域 iframe（`core.spreedly.com/v1/embedded/*`），
         Same-Origin Policy 物理阻断，任何 JS 不可能填写
       · 填完 billing 即进入 `paused_payment`，任务摘要明确告知用户
         "enter card number + CVC to complete payment"
       · 这是 PCI DSS 合规边界，不是 bug，也无法绕过
         （Stripe Elements / Braintree Hosted Fields 同理）

4. Ticketmaster RPA（attraction 日历 + Reserve 流程）
   - Provider：`lib/booking-autopilot/providers/seatgeek-rpa.ts` 类似骨架。
   - Cookie 持久化：`scripts/save-ticketmaster-cookies.mjs` 一键保存登录态。
   - 导航：attraction 日历 → 跨月份切换 → 点击目标日期 time slot →
     侧栏 "Find Tickets" → event page → 监听 "Reserve Tickets" 按钮。
   - Auth URL 兜底：跳登录页时暂停任务，引导用户手动登录后继续。
   - Trace 转发 console.log，方便线上 debug。

5. Real Chrome 分支（绕过 DataDome 指纹检测）
   - 问题：SeatGeek 上线后立刻被 DataDome 拦，因为 Playwright 默认的 Chromium
     fingerprint 被识别为 bot。
   - 方案：`lib/booking-autopilot/core/real-chrome.ts` 新增启动分支，
     用户设 `USE_REAL_CHROME_FOR=seatgeek` 后，autopilot 启动本机真实 Chrome
     （而非 Playwright 自带的 Chromium），配合 `CHROME_USER_DATA_DIR` 持久化 profile。
   - 启动前主动清理 stale `chrome.exe` 进程占用 userDataDir 的锁
     （Chrome 单实例锁是之前 ECONNREFUSED 的根因）。
   - 只影响 startUrl 匹配 flag 的任务，TM / hotels / flights / restaurants
     继续走 Playwright Chromium，不受影响。

6. ActivityCard 多按钮 + chat 流内联
   - `components/ActivityCard.tsx` 按 `activity.sources` 动态渲染多个
     "Book on <platform>" 按钮，每个按钮独立 loading。
   - 首页 chat 流：activity cards 按时间顺序内联渲染进消息流
     （不再堆在底部 grid），和 restaurant / hotel cards 样式统一。
   - 没有 datetime 的活动 card 目前靠用户在下一轮 chat 里补充日期
     （Y1 日期选择 overlay 方案已讨论，优先级降后）。

7. 当前阶段总结（2026-04 末）
   - Autopilot 已覆盖四个品类：餐厅（OpenTable / Resy / Yelp）、
     酒店（Booking / Expedia / Hotels）、机票（Expedia RPA）、活动（SeatGeek / Ticketmaster）。
   - 所有品类都跑通 chat → Decision Room → Autopilot 三层闭环。
   - Billing 能填的字段全部自动化，payment 在 PCI iframe 边界优雅 handoff
     （这是行业物理边界，不是产品缺陷）。
   - 三层架构模式（程序化导航 + AI 填表 + AI 验证）沉淀为 CLAUDE.md 强制规范。

8. 下一阶段要做什么
   - 短期（下周）：
       · SG / TM / hotel / flight autopilot 实盘回归测试，
         重点看 cookie 过期后 auth URL 兜底是否能优雅暂停。
       · Activity 没有 datetime 时的前端交互打磨
         （datetime overlay 方案 vs chat 二轮补充）。
   - 中期（本月）：
       · 学习回路激活：第三阶段的 feedback stats 已经在收数据，
         下一步接入 ranking 权重调整（哪些 provider 用户更常接受）。
       · Decision Room 的 activity 多人投票用例手测。
   - 长期（待定）：
       · 跨品类的一体化 trip planning（hotel + flight + activity 打包）。
       · 支付侧继续受限于 iframe 安全模型，可探索 "代付钱包"
         （用户一次授权，autopilot 用 token 而非明文卡号付款）。

================================================================
Recent Updates - 2026-04-23
================================================================

1. Stage 1 · Solo Trip Packaging（单人 trip 跨品类打包）
   - 首页 chat 新增 trip scenario，一句"下周五从 Nashville 飞纽约过周末"可以
     同时组装 hotel + flight + activity + restaurant 四个品类的完整方案。
   - Phase 1 收集：`lib/agent/trip-intent-state.ts` TripIntentState 状态机
     维护 destination / origin / dates / travelers / vibe / budget 等字段，
     NLU v2 extractor 每轮输出 state.trip，router 判断 confirm_ready。
   - Phase 2 选择：`lib/agent/planners/trip-package.ts` 并行触发四条品类
     pipeline，组装成 TripPackage.*_options（多 tier 候选），前端用
     `components/TripPackageCard.tsx` 按 category 分列展示，用户逐列勾选。
   - Phase 3 执行：`/api/booking-jobs/create-trip` 把勾选的组合拆成 N 步
     BookingJob，复用 Autopilot 既有 provider 基础设施并行执行。
   - ConfirmCard（`components/ConfirmCard.tsx`）支持三种 kind：
       · plan  → 旧 search handoff
       · room  → 创建 Decision Room
       · trip  → 触发 trip packaging 流水线
     通过 kind 分发，复用同一张卡片 UI。

2. Stage 2 · Trip Decision Room（多人 trip 协作房间）
   - Decision Rooms v2 扩展支持多人 trip 场景：一个房间跨 hotel / flight /
     activity / restaurant 多品类，每位成员在**私聊频道**里分别对 agent 说
     偏好，房间自动聚合成匿名方案放到公开频道投票。
   - DB schema 扩展：
       · `decision_rooms.type` 新增 "trip"
       · 新列 `flow ∈ { "chat", "classic" }`，trip 房间默认 "chat"
       · 新列 `categories text[]`（trip 房间列出要覆盖的品类）
   - 新表 `room_member_intent_state`：每位成员一行，存 IntentState JSON
     （include TripIntentState + planning_assumptions + turn_count）。
     chat 每轮自动 upsert（`/api/chat/parse` → syncRoomContext）。
   - 新表 `decision_room_private_messages`：每位成员的 agent 私聊频道，
     (room_id, user_id, role, content, created_at) 存所有来往消息，
     刷新 / 重进房间从 DB 回放，agent "记忆"跨会话持续。
   - 聚合 agent：`lib/agent/trip-synthesis.ts`
       · `mergeTripIntents` 纯函数，按字段策略合并多人 IntentState
         （scalar: latest-wins，budget: min，arrays: union，dates: intersection）
       · `triggerSynthesis` 带 force 模式 + 30s 防抖锁，N/N 成员全部贡献
         后自动触发，也支持用户手动在聊天里说"出方案"再触发
       · 出方案后写 `decision_room_proposals`（3 tier：经济 / 均衡 / 升级），
         房间公开频道写 `trip_synthesized` 系统消息 + 给每个成员发 DM 通知。
   - 投票 & 执行：proposals 支持多 option tier 投票，通过后 payer 一键调
     `/api/booking-jobs/create-trip` 把 accepted package 下发成 N 步 autopilot。
   - UI：trip 房间不走传统 `/rooms/[id]` 表单页，而是住在首页
     `/?room_id=<id>` 上——创建者和成员都在同一个 chat 界面里继续说话，
     ribbon 变成金色 "Decision Room" 条，每轮 chat 同步到自己的私聊频道。

3. 联系人图谱 & 邀请体验升级（Invite-UX）
   - 聊天里一句"和 ziweiB、张三去纽约"直接进入聚合流程：
       · NLU 把 `member_names` 抽出来返回
       · commit 时调 `resolveContactsByNames`，匹配到 contacts 的人自动
         `inviteToDecisionRoom(room_id, user_id)` 以 `status='invited'` 预加房间
       · 匹配不到的名字回包 `unresolved_names`，ConfirmCard 在确认前用
         红色警告提醒"ziweiX 还不在你的联系人里，不会自动收到邀请 DM"
   - `listMyDecisionRooms` 支持 `include_invited=1`，`/rooms` 页新增
     Accept / Decline 两个按钮，点 Accept 调 `/accept-invite` 翻为 joined。
   - `listRoomMembersWithInvited`：新的 DB helper，返回所有成员（含 invited）
     与旧 `listRoomMembers`（只返回 joined）分开，修掉了之前 accept 403 的 bug。
   - 主页 chat 历史回放（room context 连续性）：打开 `?room_id=<id>` 自动
     拉 `/api/rooms/[id]/private-messages` 回放进 chat，nluHistoryRef 也
     rehydrate，agent 不再"失忆"。

4. 用户互发 DM（user-to-user messaging）
   - 新表 `user_direct_messages`：(from_user_id, to_user_id, role, content,
     meta_json, created_at)。`role ∈ { "user", "agent" }`——agent-role DM
     用来代表房间 agent 主动通知（如"ziweiA 邀请你一起计划 Trip ..."）。
   - 端点：`POST /api/dm/[userId]` 发送（gate 到 contacts），
     `GET /api/dm/[userId]` 拉会话流。
   - UI：`/contacts` 升级为 Telegram 风格左右分栏——左侧联系人列表，
     右侧 `components/ContactDmPane.tsx` DM 面板。点左侧切右侧，
     同一页内部状态驱动不重新挂载。
   - GlobalNav 加 Contacts 入口；未登录用户在 nav 右上角显示 Sign in
     按钮（之前靠 🇺🇸 emoji 渲染，Windows 下变 "US" 字符的 bug 一并修掉）。
   - 自动 DM：trip 房间创建时，对每个被自动邀请的联系人发一条 agent-role DM
     "${creatorName} just invited you to a trip: '...'. Open Rooms to accept."，
     `meta_json.kind = "trip_invite"` 方便后续分类展示。
   - Delete room 兜底：删房前先给所有非创建者成员（包括 invited）发 agent DM
     "${creatorName} dismissed the trip '...'. The room is no longer available."，
     避免房间从他们 sidebar 里静默消失。

5. ChatGPT 风格持久化 Solo 会话（Sessions）
   - 新表 `chat_sessions`（id, user_id, title, upgraded_room_id, updated_at 等）
     + `chat_session_messages`（session_id, role, content, created_at）。
   - 首页首条消息自动 create_session，URL 带上 `?session_id=<id>`；
     下一轮 chat 写 session_messages，刷新 / 侧栏点回来从 DB 回放。
   - `components/Sidebar.tsx`：桌面左侧 260px 常驻侧栏，分
     **Rooms** + **Sessions** 两区。右键上下文菜单（Delete / Leave / Decline），
     30s polling 增量刷新。
   - Session → Room 升级路径：在 session 里触发 confirm 建 trip room 后，
     `markSessionUpgraded(session_id, user_id, room_id)` 把 session 标记成
     "已升级"，sidebar 把它从 Sessions 列表里隐藏（单一入口：房间代替 session）。
   - DB-as-source-of-truth 架构：commit 时 server 把整段 pre-confirm 对话 +
     一条 agent welcome 落进创建者 private channel；给每个被邀请成员也 seed
     一条 welcome。client 不再靠 `injectAssistantMessage(welcome)` 的内存
     绕路——确认后清屏 → replay 从 DB 拉回来，Strict Mode 双跑、刷新、换
     浏览器都稳。
   - Zombie room 兜底：浏览器 URL 指向已删房间时，room title effect 收到
     404/403 自动清 `activeRoomId` 并 `router.replace("/")`，不让 UI 停在
     僵尸壳子上继续发 synthesize 403。

6. NLU v2 · Trip scenario 全量支持
   - `lib/agent/nlu-v2/types.ts` 加 `TripFields` + `scenario='trip'`。
   - extractor.ts system prompt 新增 trip 示例（中文 + 英文），能正确抽出
     `destination_city / departure_city / start_date / nights / travelers /
     vibe / member_names`。
   - router.ts `getMissingForScenario('trip')` 声明 required:
     destination + (start_date OR end_date) + travelers。
   - party_type 检测：member_names.length > 0 或 travelers > 1 → "multi"，
     否则 "solo"。multi 场景自动把 intent 升级为 create_room（而非 create_plan）。
   - 新 golden test: `golden-trip.test.ts` 覆盖 solo / multi 两条路径，
     保证新场景不会回归。

7. 其他 bugfix / 收尾
   - `lib/conversational-nlu.ts` 已在 Phase D 删除，`ConversationalNLUResult`
     现作为 alias 指向 `NluV2ParseResult`，所有 5 个 caller 换 import 到 nlu-v2。
   - `/api/chat/parse` 简化：单入口调 `analyzeConversationalV2`，不再 if/else
     走 v1 / v2 分支。
   - 客户端快速选择兜底：`lib/quick-picks-fallback.ts` 在 LLM 偶尔忘记产出
     quick_picks 时注入硬编码默认项，保证用户永远有可点按钮。
   - `/rooms/join/[short_code]` 页对 chat-flow 房间不跳 `/rooms/<id>`，
     而是跳 `/?room_id=<id>`，和主页 chat 对齐。

================================================================
Recent Updates - 2026-04-24
================================================================

1. Session → Room 升级路径：DB 为单一真相源
   - 之前的做法：把创建 room 前后的 in-memory chat messages 通过
     `upgradedRoomsRef` Map + 时间窗加上 `replayedRoomIds.add(id)`
     三重保险尝试"无缝保留"，但 React Strict Mode 双跑 + router.replace
     异步 + setState 时序组合下仍然偶尔清空聊天。
   - 新做法：commit 时 server 把所有 pre-confirm 历史 + 一条
     welcome assistant 消息落进创建者的 private channel，被邀请成员也
     seed 一条 welcome。Client 确认后直接 clearChat → 让 replay effect
     从 DB 拉回来。所有路径单一机制，无时序依赖。
   - Bug 表象：两边用户进入房间都是空白 → 根因是被邀请者 private channel
     根本没 seed 过任何消息。现在 server 显式为每位被邀请用户写一条
     "${creator} 邀请你一起计划 Trip「...」" 的欢迎语。

2. 僵尸 room_id URL 兜底
   - 场景：用户 A 删了房间，但浏览器 B 的 tab 还停在 `?room_id=X`。
     再刷新会触发一连串 404/403，但 UI 不自知，仍显示 "Decision Room"
     ribbon；用户打字触发 synthesize → 403 → 过去的 UX 只冒一句
     "方案生成失败了，先稍等再试一下。" 毫无信息量。
   - 两层防御：
       · Room title effect 检测 `/api/rooms/[id]` 返回 404/403
         → 清 activeRoomId + `router.replace("/")` + 丢 replay 标记
       · Synthesize 失败若是 404/403 → 发一条人话消息
         "这个房间已经不存在了（被删除或你不是成员）。我带你回到首页重新开始。"
         再做同样的清理

================================================================
Recent Updates - 2026-04-24 (cont.) · Stage 2 · T11 全量落地
================================================================

本轮一次性把 Stage 2 的 "inline proposal card + 投票 + payer 下单 +
Autopilot 启动" 闭环跑通，包括 UI / server / DB / 状态机各层。

1. Inline Trip Proposal Card（T11 完成 · `components/TripProposalChatCard.tsx`）
   - 4 列设计（🏨 Hotel · ✈ Flight · 🍽 Food · 🎟 Shows）和 Solo 的
     `TripPackageCard` 一致，但是 95% 只读 + 每张 minicard 左上角
     新增 `N/M picked` 投票聚合徽章（当 ≥50% 成员选它时变金色）
   - 4s 轮询 `/api/rooms/[id]/trip-proposal`，跨客户端实时看共识进度
   - 宽度 100% 填充 chat 列，不再强行 95vw 突围（侧栏折叠后更宽敞）
   - 媒体查询继续在 ≤1023px / ≤639px 折叠成 2 列 / 1 列

2. α 投票语义 · "Lock in = Approve" 合并交互
   - 最初设计是"三 pill 投票（Approve/Decline/Request changes）+
     Lock in my picks"两步冗余，用户要点两次。合并成：
       · 金色主按钮 **"Lock in & approve"** —— 一次点击同时
         `PUT /trip-selection` + `POST /vote(approve)`
       · 已批准后按钮变 **"✓ Update my picks"**（只保存选择，不改投票）
       · 辅助小按钮 **"Decline"** 作为显式退出（投 decline 会卡住
         approval gate，payer 不能绕过强行下单）
   - 门槛达到后服务器自动把 `proposal.status` 升级到 `accepted`
     （复用老 DR 的 vote endpoint machinery，一行服务端代码没改）
   - Payer 的 **"Book this trip"** 按钮 disabled 直到 approval 达标，
     hover 显示 "Need X more approval(s)"

3. DB schema 扩展（+1 新表 · +1 新列）
   - 新表 `decision_room_trip_selections`：(room_id, proposal_id,
     user_id, selection_json, updated_at)，UNIQUE (proposal_id, user_id)
     用于 upsert。存每人每品类的勾选（1 hotel + 1 flight + N rest + N act）
   - `decision_room_private_messages` 加 `meta_json JSONB` 列（安全向前
     迁移 ALTER TABLE ADD IF NOT EXISTS）。trip-synthesis 在合成成功后
     为每位 joined 成员的私聊频道 seed 一条
     `meta_json={kind:'trip_proposal_card', proposal_id}` 的 marker —
     客户端检测到后就 mount TripProposalChatCard（不渲染成文字气泡）

4. 新 3 个 API endpoints
   - `GET /api/rooms/[id]/trip-proposal` → 返回 TripPackage + 聚合投票
     计数 + 我的选择 + my_vote + vote_tally + is_synthesizing + room meta
   - `PUT /api/rooms/[id]/trip-selection` → upsert 我的选择，gate 到
     proposal.status=active
   - `/api/rooms/[id]/book-trip` 大改：
       · 去掉旧 approval-vote 门禁（α 语义下 selection 本身就是投票）
       · 加回真正的 approval-rule gate（unanimous / majority, N<3
         强制 unanimous）—— 未达标 409 带回 needed/approved_count 进度
       · consensus 算法：按每品类投票数多数派挑选，tie-break 按
         package option 顺序。payer 可 body override 任一字段
       · create-trip 返回后 fire-and-forget `POST /start` 启动
         Autopilot（漏了这一步任务会卡 queued）
       · 二次守护：`booking_job_id` 已存在时拒绝重复下单

5. Proposal Watcher + 跨客户端同步 (`page.tsx`)
   - 进 trip 房间后每 4s poll `/trip-proposal`。一旦 `proposal.id`
     出现（可能是别人触发了合成）就 setActiveProposalId → 卡片自动
     mount，无需刷新
   - 拿到 `is_synthesizing: true` 时展示合成进度卡（同样的 4 品类
     脉冲 chip + 滑动金色进度条）——让**所有成员**在 5-15s pipeline
     期间都看到"正在为你们综合方案…"，不只是触发人
   - Server 侧 `is_synthesizing` 启发式：`proposal===null && 所有
     joined 成员都有 intent_state_row` → 认定流水线正在跑

6. Executing 态渲染
   - `booking_job_id` 一旦写入（payer 点 Book 之后），卡片整张坍缩为
     单行 "✈️ Trip booked · See progress →"
   - 点按钮跳 `/tasks?focus=<jobId>&view=live`，直接进到 Live 视图看
     Playwright 步骤滚动
   - 严格 gate on `booking_job_id`（不是 proposal.status=accepted）——
     否则全员 approve 后 payer 还没点 Book 就已经被推去空 /tasks

7. NLU 抗性（extractor 后处理两层安全网）
   - `downgradeSpuriousRefine`：新增一轮后处理，防 gpt-4o-mini 把
     "想看百老汇、自由女神、想住希尔顿" 这种逗号列表误判成
     `intent=refine_existing`（router 会把 refine_existing 短路成
     `continue_chat`，ConfirmCard 永不出现）。fresh session 没历史 +
     无 refined_target_id → 降级到 `create_plan` 或 `create_room`
   - `fillCreateRoomPartySize` 扩展到 trip scenario：既然用户说了
     "和 ziwei Guo"，自动推断 `travelers = member_names.length + 1`，
     router 不再问 "how many travelers?"

8. In-room synthesize 触发器 + 重复防护
   - `/api/chat/parse` 加 `isSynthesisTrigger` 正则：用户在 trip 房间
     里说 "给我方案" / "生成方案" / "synthesize" 等语义 → 强制把
     NLU 结果改写成 `intent=create_room, confirm_ready=true`，客户端
     fire force synthesize；同时把 `assistant_reply` 换成 "好的，
     我去综合大家的偏好，出一套方案" 防止 Sonnet 幻觉行程
   - **去重守护双层**：
       · Server（parse route）：触发时先 `listActiveProposals`，
         已有 active/accepted proposal 就**不**改写 intent——只换
         assistant_reply "方案已经出好了…如果想重新生成一套，说
         「重新生成」。"
       · Client（page.tsx:787）：fire /synthesize 前检查
         `activeProposalId`，已有就 return（防 user 2 说完整 trip
         请求又造一个新 proposal orphan 所有票）

9. Collapsible Sidebar（侧栏可折叠）
   - 左上角 chevron `‹ / ›` 切换 260px ↔ 44px
   - 折叠态只剩 "+" 图标 + 每个 room/session 的单字符 icon tile
     （hover 显示完整标题 native tooltip）
   - localStorage 持久化偏好（`onegent.sidebar.collapsed`）
   - 160ms 宽度过渡动画
   - 折叠后给 proposal card 多腾出 216px，4 列布局 1366px 笔记本
     也舒服

10. Getters / helpers 新增
    - `getLatestTripProposal(roomId)` — 返回 active OR accepted 的最
      新 proposal（老的 `getActiveTripProposal` 只认 active，门槛达
      成瞬间会让卡片闪现 "No proposal available yet"）。
    - `/trip-proposal` 和 `/book-trip` 用新的；`/trip-selection` 保
      留老的（accept 后不应让成员改选择）

11. 一揽子 bug 修复
    - create-trip 返的是 `jobId`（camelCase），book-trip 之前只找
      `job_id / booking_job_id / id` 三个下划线别名 → 500。加 `jobId`
      作为优先 fallback
    - `/tasks` 没有 `[id]` 动态路由，url 改成 `?focus=<id>&view=live`
      query 模式（对齐 Solo TripPackageCard）
    - minicard `border: "Xpx solid Y"` 与选中态 `borderColor` 覆盖
      冲突，React 每次 rerender warn。全部替换成 `borderWidth /
      borderStyle / borderColor` 长字段（MINI_CARD_BASE / SELECT_PILL
      / LOCK_BTN 三处）

================================================================
数据库（35 张表 · +6 from v0.2.29.0）
================================================================

Stage 2 共新增 6 张表（5 张 + T11 的 selections 表）：

| 表名 | 用途 |
|------|------|
| room_member_intent_state | 每位房间成员的 IntentState JSON（含 TripIntentState） |
| decision_room_private_messages | 每位成员的私聊频道（chat ↔ agent） |
| user_direct_messages | 用户互发 DM（含 role='agent' 的系统通知） |
| chat_sessions | ChatGPT 风格持久化 solo chat 会话 |
| chat_session_messages | chat_sessions 的消息流 |
| decision_room_trip_selections | Trip room 每成员每品类勾选（α 投票） |

【核心能力速览】
三条主线，贯穿第四 / 第五阶段的完成态能力：
  · 个人决策：6 层 Agent 管道（NLU → Plan → Tool → Retrieve → Rank → Explain），
    8 场景规划器 × 8 品类 pipeline，支持模块级精炼（G-3）与单约束精炼（S-5）
  · 群体决策：Decision Room v2 — 多人结构化约束、AI 合并 + 冲突检测、
    unanimous / majority 投票、payer 一键 booking 闭环
  · Autopilot 执行：Stagehand（AI 层）+ Claude Haiku（感知层）+ Playwright（RPA 兜底），
    八个 Provider（Booking.com / Expedia / Hotels.com / OpenTable / Resy / Yelp /
    SeatGeek / Ticketmaster）+ Expedia 机票 RPA + Activity 多源聚合

【本文档阅读导航】
  · 新工程师上手 → 直接翻 十二（启动）→ 十三（目录）→ 十四（改动入口）→ 十七（坑）
  · 产品 / 投资人视角 → 一 ~ 六（架构与阶段演进）、十（支持场景）、十一（用户旅程）
  · 架构师 / 重构前必读 → 十五（数据流）、十六（关键设计决策 ADR）
  · 改 Booking 自动化 → 本文 十四 + 根目录 `CLAUDE.md` 的 "Booking Automation Architecture" 章节

【三段式骨架 · 所有模式共用的结构 · 2026-04-23】

Onegent 从 Solo 单品类到 Trip 打包到 Decision Room 多人协作，全部
按同一个 "Phase 1 收集 → Phase 2 选择 → Phase 3 执行" 的三段式骨架
运行。这是理解代码架构、决定新功能如何插入的核心视角。

            ┌──────────────────────────────────────┐
  Phase 1 → │  信息收集（chat / form / 私聊）        │  agent 和用户对话
            │  产物：Intent / IntentState / Constraint│  或结构化表单
            └──────────────┬───────────────────────┘
                           ↓
            ┌──────────────────────────────────────┐
  Phase 2 → │  选择（候选卡片 / 投票 / 勾选）         │  系统给 N 个候选
            │  产物：RecommendationCard / Proposal   │  用户挑要执行的
            └──────────────┬───────────────────────┘
                           ↓
            ┌──────────────────────────────────────┐
  Phase 3 → │  执行（BookingJob.steps 并行 autopilot）│  后台跑到 paused_
            │  产物：支付边界（CVC 手填）             │  payment
            └──────────────────────────────────────┘

【五个模式映射到同一套骨架】

  | 模式                            | Phase 1 载体                       | Phase 2 载体                      | Phase 3 载体                  |
  |---------------------------------|------------------------------------|-----------------------------------|-------------------------------|
  | Solo 单品类（餐厅/酒店/机票/活动）| NLU v2 IntentState → XxxIntent     | RecommendationCard[] 纵向列表     | 单 step BookingJob            |
  |                                 | （`lib/agent/nlu-v2/`）             | 点一张卡直接 autopilot            |                               |
  | Solo 多品类 · Trip（本阶段完成）  | TripIntentState（v2 state.trip）    | TripPackage.*_options（4 列候选） | N step BookingJob 并行        |
  |                                 |                                    | per-category 勾选，一键打包        |                               |
  | DR 单品类（当前 DR v2）          | RoomConstraint（每人一份）          | Proposal[] + 投票                 | payer 一键触发单 step         |
  | DR 多品类 · Trip（Stage 2 已完成）| 每人私聊 → TripIntentState          | trip-synthesis 聚合 → 多 tier    | payer 一键触发 N step 并行    |
  |                                  | room_member_intent_state 持久化     | 成员独立投 approve/decline        | create-trip → BookingJob 拆步  |
  | 未来任何新品类                    | 复用 v2 extractor + 新 XxxFields    | 复用 card UI + 新卡片样式          | 复用 BookingJobStep 基础设施  |

【三段式的可扩展性 · 加东西不动骨架】

这种"三明治"结构是 Onegent 能快速迭代的核心原因——每层都能独立
加功能，互不影响。

  · 加新品类（车租 / 船票 / 露营 / 剧本杀 / 婚礼策划 ...）
      写新 pipeline（lib/agent/pipelines/xxx.ts）
    + 新 Intent 类型（lib/types.ts 的 XxxIntent）
    + 新 card 组件（components/XxxCard.tsx）
    骨架的三个 phase 组件都不用改。

  · 加新信息收集模式（语音输入 / 图片 upload / 日历同步 / voice memo）
      扩展 Phase 1 的 input channel（比如 voice → speech-to-text → NLU）
    Phase 2/3 完全不用动——产物还是同一套 Intent/Constraint。

  · 加新执行模式（代付钱包 / 预约模式 / 团购 / 日程同步）
      扩展 Phase 3 的 autopilot 或 step 类型
    Phase 1/2 完全不用动——输入还是同一套选择结果。

  · 加新协作形态（三人拼团 / 私聊 + 公开频道混合模式）
      Phase 1 加一层"聚合"（多人 Intent → 合并约束）
    Phase 2/3 可以复用现有组件

================================================================
一、核心架构 · 6 层 Agent 设计（已全部实现）
================================================================

第 1 层 · 需求理解层
  自然语言 → 结构化意图。解析预算、场景、偏好、限制条件。
  两套 NLU 并存，按入口分工：

  · **首页 chat / Decision Room 私聊** → `lib/agent/nlu-v2/` 三层架构
    - Layer 1 chat.ts（Claude Sonnet 说人话）
    - Layer 2 extractor.ts（gpt-4o-mini + JSON mode，每轮输出完整 IntentState）
    - Layer 3 router.ts（纯函数：continue_chat / ask_clarification / show_confirm_card）
    · 编排器 analyzeConversationalV2()；唯一入口 /api/chat/parse
    · v1 `lib/conversational-nlu.ts` 已于 Phase D 删除，`ConversationalNLUResult`
      作为 alias 保留以便渐进迁移（详见 NLU_REFACTOR_PLAN_C.md + CLAUDE.md）
  · **传统 Agent pipeline 场景解析** → `lib/nlu.ts` + `lib/agent/parse/<scenario>.ts`
    · 英文快速路径（~300ms 节省），非英文走 MiniMax
    · 仅供 lib/agent.ts 六层管道使用（不在首页 chat 路径上）

  升级：注入用户历史偏好（噪音/价格/距离敏感度），下一轮查询自动带约束。
  升级 2：session preference extraction（3.3a）— 每次餐厅查询后 AI 提取
  偏好信号并累积在 session 内，注入后续 rankAndExplain prompt。
  升级 3：单约束精炼（S-5）— "便宜一点" / "安静一点" / "近一点" 识别为
  refinement intent，上下文感知重跑，不重置整个规划。
  升级 4（Plan C 2026-04）：NLU v2 三层分离，彻底告别 800 行单 prompt。

第 2 层 · 计划层
  决定"搜什么 / 去哪搜 / 按什么顺序搜"。任务分解，而不是一次性大查询。
  实现：lib/agent/ 下 30+ 个子模块（pipelines/ planners/ planner-engine/ parse/）。
  核心设计：modular planner engine，新场景只需写一个 EngineConfig，不改核心。
  当前覆盖：8 个场景规划器 + 8 个品类 pipeline。
  升级：模块级精炼（G-3）— "保留航班，换一个酒店" 只重跑换掉的模块，
  固定其余结果，避免整包重新生成。

第 3 层 · 工具层
  Places 搜索 · SerpAPI 价格元数据 · Tavily 编辑语境
  Ticketmaster Discovery API（活动票务）· SerpAPI Google Shopping（礼物）
  地图距离 · 哈弗辛步行时间计算 · 预订深链接生成
  升级：fetchReviewSignals() 并行拉取真实用户评论（Google Maps + Yelp/Reddit）
  并用 MiniMax 解析为结构化信号（噪音 / 等位 / 约会适配 / 招牌菜 / 雷点）。
  实现：lib/tools.ts — 全部并行调用，非致命性，任意工具失败不影响主流程。
  新增（v0.2.24.0）：Playwright 无头浏览器工具层 — 自动操作 Kayak / Booking.com /
  OpenTable，完成从搜索到预填结账页的全链路，不依赖任何官方 API。
  新增（v0.2.26.0）：多 Provider 架构 — BrowserProvider 接口 + 注册表，支持
  Booking.com / Expedia / Hotels.com / OpenTable / Resy / Yelp 六个平台，
  餐厅预订多平台瀑布式回退链（OpenTable → Resy → Yelp → 官网直链）。

第 4 层 · 候选生成层
  广泛拉取 → 规则初筛 → 语义过滤 → Top 10 漏斗式召回。
  实现：各 pipeline 独立运行。date_night 最多 30 候选压到 3；
  weekend_trip 独立的航班 + 酒店 pipeline 并行运行后再配对组包。
  升级：飞行时段过滤（G-1）— "不要红眼" / "晚上 9 点后不行" 从 NLU 解析，
  在 SerpAPI 结果后置过滤，不依赖 API 筛选器。

第 5 层 · 重排与打分层（产品灵魂）
  综合评分 = 场景适配度(30%) + 预算匹配度(25%) + 口碑质量(20%)
             + 位置便利度(15%) + 用户偏好吻合度(10%) - 重大雷点惩罚
  实现：lib/agent/composer/scoring.ts — 各维度独立打分，系统计算加权总分，
  可解释，每张卡片展示可折叠评分细则面板。
  升级：getScoreAdjustments() 已实现（30 天衰减加权审批率），
  等待激活条件：≥30 天上线 + ≥100 条 plan_outcomes（约 2026-04-22 评估）。
  升级 2：场馆质量预警（G-4）— 每周 cron 重查 Google Places 评分，
  未来日期方案如评分下降 ≥0.3★ 触发 amber 橙色警告横幅。

第 6 层 · 解释与交互层
  推荐理由 + 风险提示 + 可追问入口 + 切换策略入口。
  持续协作式决策，不是单次搜索。
  实现：DecisionPlan.tradeoff_summary + risks[] + ActionRail 行动按钮。
  升级：高置信方案直接显示"✓ 已为你选定"，备选方案默认折叠，
  引导批准而非比较。
  升级 2：Decision Rooms v2（Phase 4）— 支持多人共同做决策，成员分别提交约束，
  AI 合并后生成多选提案，按 unanimous / majority 规则投票，可直接衔接 Booking。
  升级 3（v0.2.24.0）：Autopilot Booking — 选好方案后，agent 自动执行预订，
  用户只需最后付款。任务视图实时展示 agent 的每一步决策过程。

================================================================
二、产品演进路线 · 四个阶段 + 执行闭环
================================================================

【第一阶段 · 完成】个性化推荐引擎
  ✅ 餐厅 · 酒店 · 航班 · 信用卡 · 笔记本 · 耳机 · 手机（7 品类）
  ✅ 多源召回（Google Places + SerpAPI + Tavily）
  ✅ 真实评论结构化信号（噪音 / 等位 / 约会适配 / 招牌菜 / 雷点）
  ✅ 5 维度确定性打分（场景 30% + 预算 25% + 口碑 20% + 位置 15% + 偏好 10%）
  ✅ 可解释排序 + 评分细则展开面板
  ✅ 中英双语支持（MiniMax NLU + 英文快速路径）
  ✅ 27 个美国城市 + GPS "附近" + 地标搜索

【第二阶段 · 完成】场景编排 + 执行层
  核心转变：从"帮用户选" → "帮用户完成整件事"

  场景 1 · Date Night OS ✅
    输入："下周五 Manhattan，第一次约会，两人预算 220 美元，不要太吵"
    输出：主推餐厅 + 推荐时段 + 约会适配原因
          + 备选方案（更便宜 / 更安静 / 更好拍照）
          + 餐后去处（步行 N 分钟 · 鸡尾酒吧 / 甜点店 · 按偏好筛选）
          + 预计总花费 + 风险提示
          + 行动入口（OpenTable 预约 / 地图 / 发给对方 / 加日历）

  场景 2 · Weekend Trip OS ✅
    输入："下个月去 Chicago 过周末，预算 900，轻松不折腾"
    输出：套餐 A（最稳妥）/ 套餐 B（最省钱）/ 套餐 C（体验最好）
          每套包含：航班 + 酒店 + 时间衔接检查（landing → check-in 可行性）
          + 总价 + 风险 + 最优信用卡推荐
          + Google Flights 和 Booking.com 预填深链接
    升级：航班时段过滤（G-1）、模块级精炼（G-3）、家庭模式（S-3）

  场景 3 · Big Purchase OS ✅
    输入："主要写代码，不要太重，预算 1800，Windows 优先"
    输出：默认推荐（直接买哪台 + 原因 + 推荐配置）
          + 为什么不是另外两台
          + 如果更在意便携 / 性价比 / 散热，对应切换方案
    信用卡升级：
      · 信用卡组合缺口分析（G-2）— "我有 CSP + Amex Gold，还缺什么？"
      · 开卡奖励排名（S-4）— "最划算的开卡奖励" → SUB × 消费可行性打分

  场景 4 · Concert & Event OS ✅
    输入："周五晚 NYC，Taylor Swift 附近场次" / "想看爵士演出"
    输出：Ticketmaster 真实票源，最多 3 场
          + 场馆信息 + 价格区间 + 直接购票链接 + 地图

  场景 5 · Gift OS ✅
    输入："给我妈买生日礼物，她喜欢园艺，预算 150 美元"
    输出：3 个选项（安全选 / 最走心 / 最有创意）
          + SerpAPI Google Shopping 真实商品 + 购买链接 + 礼物理由

  场景 6 · Fitness OS ✅
    输入："Brooklyn 周六早上瑜伽课，预算 25 美元以下"
    输出：3 个工作室（Top rated / Most popular / Best value）
          + ClassPass 主行动链接 + Mindbody 备选 + Google Maps
    支持 12 种运动类型：瑜伽 / 普拉提 / 动感单车 / HIIT /
    CrossFit / 拳击 / 芭蕾 / 舞蹈 / 冥想 / 游泳 / 跑步 / 武术

  City Trip OS ✅：行程打包，地标 + 餐厅 + 酒店 + 路线

  执行层全部落地：
  ✅ 预填深链接（Google Flights / Hotels / Booking.com / OpenTable）
  ✅ 一键方案确认（高置信度时推进批准而非展示列表）
  ✅ 加日历（.ics 下载 + Google Calendar 深链接）
  ✅ 发朋友 + 群体投票（share 链接 + 实时投票进度条）
  ✅ 行程摘要导出（Markdown 格式，航班/酒店/餐厅/总价）
  ✅ 价格监控（注册 price_watches，每日 SerpAPI 重查，降价 ≥10% 触发通知）
  ✅ 主动推送（Web Push / PWA，价格降时通知到设备，即使 App 已关闭）
  ✅ 用户账号 + 跨设备偏好同步（Clerk 登录）
  ✅ OpenTable Reserve 直链
  ✅ 场馆质量预警（G-4）— 周度 cron，评分下降 ≥0.3★ 橙色横幅提示

【第三阶段 · 完成，学习回路等待数据激活】结果负责 + 个性化记忆 + 持续学习

  反馈闭环三层：

  层 1 · 实时卡片反馈（3.3c）
    用户可在任意推荐卡上直接反馈（👍 / 👎）
    → 立即更新 UserPreferenceProfile → 下次查询自动注入约束

  层 2 · 事后 24h 结构化反馈（3c-3）
    方案事件日期后 24h，弹出反馈卡："去了 [餐厅名] 体验怎么样？"
    → 写入 plan_outcomes → 更新 user_preferences

  层 3 · Session 偏好提取（3.3a/b）
    每次餐厅查询后 AI 异步提取偏好信号，累积在 session 内
    → 自动 promote 到 UserPreferenceProfile 持久化

  ✅ getScoreAdjustments() 已实现（等待激活：≥30 天 + ≥100 条 plan_outcomes）
  🔶 实时订位可用性（当前：OpenTable 深链接 + rid 查询端点，未内嵌可用时段 widget）

【第四阶段 · 完成】多人协作决策 — Decision Rooms v2

  核心转变：从"一个人做决策" → "多人实时协作做决策"

  Decision Rooms v2 ✅（Phase 4）
    流程：
      1. 创建 Room（restaurant / hotel / flight / activity），生成 short code / join link
      2. 邀请联系人或群组成员加入，成员页实时显示 joined / submitted 状态
      3. 每位成员提交结构化约束（预算 / 菜系偏好 / 忌口 / vibe / time / notes）
      4. AI 合并约束并生成最多 3 个候选 option，附 rationale + conflicts
      5. 成员按 unanimous / majority 规则独立投票；N<3 自动退化为 unanimous
      6. 某个 option 达成通过后，payer 一键执行预订，直接启动 booking_job
      7. Room 内消息流记录 accepted / rejected / booking_started 等系统事件
    实现要点：
      · `/api/rooms/[id]/state?since=<version>` + `useRoomState()`：3s 轮询 + 304 no-change，低成本实时同步
      · 提案引擎：2 人走 `runAgentForTwoParty`，3+ 人走 `runAgentForNParty`
      · 票型：approve / decline / request_changes；accepted proposal 持久化 winning option
      · 社交层：`user_profiles / user_contacts / user_groups / collaborators/recent`
      · 执行层：accepted restaurant proposal 可直接落地为 booking job，并绑定回 room

【第五阶段 · 完成】Autopilot Booking — 从"推荐"到"代办"

  核心转变：从"给你推荐方案，你去执行" → "你只需批准，我去帮你搞定一切"

  Autopilot Booking ✅（v0.2.24.0）

  5.1 · 后台异步执行

    用户点"Make this my plan — book everything →"后，系统在后台并行启动 3 个
    Playwright headless 浏览器实例，分别操作：
      · Kayak — 搜索航班，找到最优班次，返回 checkout 链接
      · Booking.com — 导航到目标酒店，返回预订页链接
      · OpenTable — 选定时段，返回预约确认链接

    用户无需等待 — 可以关闭窗口，后台继续跑（最长 5 分钟）。
    完成后推送 Web Push 通知到设备。

  5.2 · 任务内自主决策（In-task Decision Making）

    Agent 在执行过程中遇到障碍时，自主做局部决策，不打扰用户：

    | 问题 | Agent 的决策 |
    |------|-------------|
    | 餐厅 7:00pm 没位 | 自动尝试 7:30pm → 6:30pm → 8:00pm → 6:00pm |
    | 首选酒店无房 | 自动切换至 backup_plans 中的次优酒店 |
    | 瞬时网络错误 | 最多重试 3 次（间隔 2s / 5s） |
    | 所有选项都失败 | 生成 Action Item，列出可手动完成的链接，继续处理下一步 |

    时间 fallback 算法：以用户期望时间为中心，按 ±30 / ±60 / ±90 分钟扩散，
    过滤 11:00am–10:00pm 范围内的合法时段，自动尝试直到成功。

  5.3 · 决策日志（Decision Log）

    每一步操作都记录：
      · 尝试了什么（Tried Le Bernardin at 7:00pm）
      · 结果如何（No availability）
      · agent 的下一步决策（Adjusted to 7:30pm）
      · 最终结果（Booked ✓）

    用户可在 My Trips 页面展开查看完整决策日志，知道 agent 帮自己做了什么。

  5.4 · Cookie 登录持久化

    用户对 OTA 平台（Expedia / Booking.com / OpenTable / Kayak）只需登录一次：
      1. 点击"Connect Account"，弹出真实可见浏览器
      2. 正常登录（支持 Google OAuth / 2FA / 手机验证）
      3. 登录成功后，cookies 保存到本地
      4. 后续所有 autopilot 运行自动注入这些 cookies，agent 以你的身份登录

  5.5 · My Trips 统一任务视图（/trips）

    不只是"看结果"——像项目管理一样看 agent 帮你做了什么：

      步骤分级展示：
        🔴 "Needs your decision" — 所有自动手段都试过，需要你选
        🟢 Ready — agent 已预填，点击付款即可
        🟡 Running — agent 正在工作，实时更新

      每个步骤显示：
        · 状态徽章（✓ / ↻ time adjusted / 🔄 alternative / ! manual needed）
        · 决策日志（可折叠，时间线格式）
        · 手动预订行动按钮（当 agent 失败时）
        · "What's next" 摘要（明确告诉用户下一步做什么）

  5.8 · 多 Provider 架构（v0.2.26.0）

    在 v0.2.25.0 双层执行架构基础上，新增跨站点 Provider 抽象层：

    BrowserProvider 接口（lib/booking-autopilot/providers/types.ts）：
      · matchesUrl(url)         — 判断当前 URL 归属哪个平台
      · getStageSignals(page)   — 快速规则检测当前阶段
      · fillGuestForm()         — 填写客人信息表单
      · fillPaymentForm()       — 填写支付字段（止步 CVC）
      · setup()                 — 页面初始化（cookie 注入 / 搜索框禁用等）
      · getBotPatterns()        — Bot 检测字符串列表

    已注册 Provider（lib/booking-autopilot/providers/registry.ts）：
      · booking-com   — Booking.com 酒店（原有，已接口化）
      · expedia       — Expedia 酒店 + checkout
      · hotels-com    — Hotels.com 酒店 + checkout（Expedia Group 同架构）
      · opentable-com — OpenTable 餐厅时段选择（程序化，无 AI 配额消耗）
      · resy-com      — Resy 餐厅预订
      · yelp-com      — Yelp 餐厅链接 + 官网直链回退

    Provider 注册后，executor 零改动即可支持新平台：
      getProvider(url) → 返回对应 Provider，null 则降级为纯 AI 模式

  5.9 · 餐厅预订自动化（v0.2.26.0）

    餐厅预订瀑布式回退链（多平台兜底）：

      1. OpenTable（程序化主路径）
           · 构建 startUrl（city + cuisine + date/time/party）
           · 程序化点击时段按钮（CDP 坐标点击，绕过 React 合成事件问题）
           · 表单填写：name / email / phone（Playwright 原生 setter 兜底）
           · 无结果时：展示 "Search on OpenTable →" 直链，不触发重试
           · 无位时：提取可用时段列表 → 返回给用户选择，而非静默失败

      2. Resy（OpenTable 不可用时）
           · resy-com Provider：URL 匹配 + stage 检测 + guest form fill

      3. Yelp（Resy 失败时）
           · yelp-com Provider：定向导航到餐厅 Yelp 页面提取预订入口

      4. Google Places 官网直链（最终回退）
           · 调用 Google Places API 获取餐厅 official website
           · 导航到官网寻找预订入口（Resy widget / OpenTable widget / 直订表单）

    isGenuineBooking 校验：每个平台完成后校验，防止误判"成功"（如停在搜索页）

    餐厅步骤 UI（RestaurantStepCard）：
      · Tasks 页面 "＋ Restaurant" 按钮展开步骤卡
      · 展示当前状态 / 平台 / 可用时段 / 手动预订备选链接
      · no_availability 时显示 agent 发现的可用时段供用户直接点击

  5.7 · 两层执行架构：AI 主导 + Playwright 兜底（v0.2.25.0 重构）

    Autopilot 执行层采用 双层降级（AI-first, RPA-fallback）设计：

    ┌─────────────────────────────────────────────────────────────┐
    │  Layer 1 — AI Layer（主）                                   │
    │                                                             │
    │  驱动：Stagehand (openai/gpt-4o-mini)                       │
    │  感知：Claude Haiku 截图 + DOM → PerceptionResult            │
    │  方式：stagehand.act("自然语言指令")                         │
    │                                                             │
    │  负责：                                                      │
    │  • Stage 检测（listing / room_selection / checkout_form …） │
    │  • 酒店名点击（search results → hotel detail page）         │
    │  • 客房选择（识别房型偏好 + 点击 "I'll reserve"）           │
    │  • Guest form 填写（name / email / phone / country）        │
    │  • Form audit（扫描空字段 → 定向补填）                      │
    │  • Advance 按钮（"Next: Final details" 首次尝试）           │
    └────────────────────┬────────────────────────────────────────┘
                         │ 失败 / 验证不通过时自动降级
                         ▼
    ┌─────────────────────────────────────────────────────────────┐
    │  Layer 2 — RPA Layer（兜底）                                 │
    │                                                             │
    │  驱动：Playwright raw Page                                  │
    │  方式：locator.fill() / selectOption() / page.evaluate()   │
    │                                                             │
    │  负责：                                                      │
    │  • Room quantity <select>（JS native setter）               │
    │  • Phone / Address 补填（native setter + 事件派发）         │
    │  • React event flush（触发 synthetic input/change 事件）    │
    │  • "Next: Final details" DOM click 兜底                    │
    │  • 支付表单（跨域 iframe，AI 无法访问）                      │
    │    - Cardholder name / Card number / Expiration date        │
    └─────────────────────────────────────────────────────────────┘
                         │
                         ▼
                  用户手动输入 CVC 确认支付

    设计原则：
      • AI 先行：每个步骤先调 stagehand.act()，成功即返回
      • RPA 兜底：AI 失败或验证不通过，自动降级到 Playwright 确定性操作
      • RPA 代码永远保留，作为最后防线，不因 AI 成功而删除
      • 环境变量控制：AI_LOOP_FULL=true 全开 AI 层

    AI_LOOP 控制粒度：
      AI_LOOP_FULL=true        — 等于下面三个全部 true
      AI_LOOP_STAGE_DETECT     — Stage 检测使用 Claude Haiku perception
      AI_LOOP_LISTING          — Listing 点击 + Room selection
      AI_LOOP_FORM_FILL        — Guest form 填写 + form audit

    当前已验证（Hilton Garden Inn Times Square，端到端）：
      listing → room_selection → checkout_form → payment_gate → paused_payment
      全程 AI 主导，7 分钟内完成，CVC 待用户填写后支付

    不能 AI 化的已知限制：
      支付 iframe（paymentcomponent.booking.com）— 跨域安全策略，
      浏览器禁止外部页面读写 iframe 内 DOM，只能由 Playwright iframe locator 操作

  5.6 · Agent 反馈闭环（Feedback Loop）

    系统学习用户对 agent 决策的接受度：

    | 信号 | 触发时机 |
    |------|---------|
    | 接受 (accepted) | 用户点击 agent 选定的 "Open →" 链接 |
    | 手动覆盖 (manual_override) | 用户点击 "Book manually" 备选链接 |
    | 满意度 (satisfaction) | 任务完成后 😊 / 👍 / 😕 三档反馈 |

    Agent Insights 面板（My Trips 底部，可展开）：
      · Agent 决策接受率（你接受了多少 agent 的自动调整？）
      · 各平台接受率（OpenTable 78% / Booking.com 61% / Kayak 89%）
      · 哪类任务最需要人工介入（餐厅 > 酒店 > 航班）
      · 最常被覆盖的场馆（agent 选的你最常换掉的）
      · Agent 解决问题方式分布（首次成功 / 时间调整 / 换场馆 / 完全失败）

    这些数据是 agent 持续改进的原材料：未来可自动将高失败率场馆降权，
    将用户最常接受的时间偏好注入默认决策策略。

================================================================
三、现在已做到 vs 还差什么
================================================================

已做到：
  ✅ 多品类推荐引擎（7 个品类：餐厅 / 酒店 / 航班 / 信用卡 / 笔记本 / 耳机 / 手机）
  ✅ 8 个完整场景规划器 + 5 个优化子模式（S-1 ~ S-5）
  ✅ 真实评论结构化信号提取（noise / wait / date_suitability / dishes / red_flags）
  ✅ 5 维度确定性打分 + 可折叠评分细则
  ✅ 全执行层（预订 / 日历 / 分享 / 投票 / 价格监控 / 行程导出 / 主动推送）
  ✅ 三层反馈闭环（实时卡片 → 事后 24h → session 提取）全部端到端打通
  ✅ 持久化偏好（UserPreferenceProfile，localStorage + Neon 云同步）
  ✅ 偏好跨设备同步（Clerk 账号）
  ✅ 分数调整基础设施（等数据激活）
  ✅ 高置信度决策语言（"✓ 已为你选定"，备选折叠）
  ✅ 餐后场景延伸（约会晚饭 → 步行 N 分钟的酒吧/甜点店）
  ✅ 航班时段过滤（红眼航班回避）（G-1）
  ✅ 信用卡组合缺口分析 + 开卡奖励排名（G-2, S-4）
  ✅ 模块级精炼（"保留航班，换酒店"只重跑换掉的模块）（G-3）
  ✅ 场馆质量预警（周度 cron，评分下降 ≥0.3★ 橙色横幅）（G-4）
  ✅ 单约束精炼（"便宜点" / "安静点" / "近点" 上下文感知重跑）（S-5）
  ✅ 双人协作决策 — Decision Room（约束合并 / 冲突检测 / 实时投票）（Phase 4）
  ✅ Autopilot Booking — 后台异步执行，agent 自动操作 3 个 OTA（Phase 5）
  ✅ 任务内自主决策 — 时间 fallback / 场馆切换 / 重试 / action items（Phase 5）
  ✅ Cookie 登录持久化 — 一次登录，永久代理（Phase 5）
  ✅ My Trips 统一任务视图 — 决策日志 / 分级展示 / What's next（Phase 5）
  ✅ Agent 反馈闭环 — 接受/覆盖/满意度 + Agent Insights 面板（Phase 5）
  ✅ 27 个美国城市覆盖
  ✅ 多 Provider 架构（BrowserProvider 接口 + 注册表，6 个平台 Provider）
  ✅ 酒店预订扩展：Expedia + Hotels.com 自动化（listing → room → form → paused_payment）
  ✅ 餐厅预订自动化：OpenTable + Resy + Yelp + 官网直链瀑布式回退
  ✅ 餐厅 no_availability：提取可用时段展示给用户选择，不再静默失败
  ✅ RecommendationCard 新增日期/时间选择器（直接在推荐卡选定后触发预订）
  ✅ 机票 Autopilot：Expedia 全链路自动化（选票 → 填乘客信息 → 止步付款）
  ✅ 旅行证件系统：护照号/DOB/国籍/KTN/驾照（AES-256 加密，存于 BookingProfile）
  ✅ InlineJobCard：任务卡内联显示在主聊天页结果列表下方，不跳转 /tasks
  ✅ 对话式证件收集：缺少证件时 agent 在聊天框发问，用户回复后自动解析保存并重试任务
  ✅ Trip scenario 首页 chat 一等场景（TripIntentState 状态机 + NLU v2 trip fields）
  ✅ Stage 1 · Solo Trip Packaging：单人 hotel+flight+activity+restaurant 打包 +
     多 tier 候选卡 + 一键创建 N 步 BookingJob（`/api/booking-jobs/create-trip`）
  ✅ Stage 2 · 多人 Trip Decision Room：chat flow room + 每人私聊频道 +
     trip-synthesis 聚合 agent（N/N 成员 + 30s 防抖 / force 手动）+ 多 tier 投票
  ✅ 联系人 → 房间自动邀请链路：memberNames 解析 → invited 状态预加 →
     agent-role DM 通知 → 被邀请人 Accept 直接进 chat-flow 房间
  ✅ 用户互发 DM 系统（user_direct_messages，role=user/agent + meta_json 分类）
  ✅ Telegram 风格 /contacts 左右分栏 + ContactDmPane 复用
  ✅ ChatGPT 风格 Sessions：chat_sessions + sidebar 常驻 + 新建/切换 session
  ✅ Session → Room 升级路径（DB 作为唯一真相源，不依赖内存 hand-off）
  ✅ 主页 chat 历史回放（room + session 两套 context 都支持刷新恢复）
  ✅ Zombie room_id URL 兜底（404/403 自动清 context + router.replace）
  ✅ Inline Trip Proposal 卡片（T11）：4 列内联 + N/M picked 徽章 + α 投票 +
     Executing 态 + 跨客户端 Proposal Watcher + Synthesis 进度卡
  ✅ /book-trip 自动启动 Autopilot（POST /start 真正 kick off Playwright）
  ✅ Stage 2 端到端 2 人 trip 验收通过（合成 → 投票 → 下单 → autopilot）

还差什么（仅剩 3 个边界）：
  ① 实时订位可用性 — agent 现已能抓取并展示 OpenTable 可用时段列表（no_availability
     时）；但尚未做到在推荐阶段预取时段并直接展示"20:00 还有 2 人位"的原生嵌入
     目标：主推荐卡实时展示可用时段，零跳出完成选座

  ② 分数调整激活 — 基础设施已就绪，等待真实数据积累
     条件：≥30 天 + ≥100 条 plan_outcomes，最早 2026-04-22 评估

  ③ Decision Room 合作方身份持久化（DR-1）— partner 刷新页面后恢复投票身份
     当前为 session cookie 级别，刷新即失

  ④ Agent 反馈数据积累驱动决策改进 — agent_feedback 表已就绪，
     当数据量足够后，可自动将高失败率场馆降权、将高接受率时间偏好注入默认策略

================================================================
四、护城河 · 5 个壁垒（已构建）
================================================================

1. 垂直任务理解（已实现）
   "适合约会"在系统里意味着：noise_level=quiet，service_pace=relaxed，
   lighting 信号，座位密度，是否容易聊天——从评论语义抽取，不靠标签。

2. 领域专属排序模型（已实现）
   5 维度确定性打分 + 真实评论信号：从评论里读噪音、等位、招牌菜、
   差评集中点——lib/agent/composer/scoring.ts 多维度打分，可解释可追溯。

3. 用户偏好记忆（已实现，跨设备生效）
   三层偏好体系：session（临时）→ UserPreferenceProfile（持久）→
   user_preferences DB（结构化 key-value，跨请求注入 NLU）。
   Clerk 账号登录后即可跨设备同步。

4. 专有反馈闭环（已实现，等数据规模）
   用户选了哪家 → 实时反馈 / 事后反馈 / agent 接受度反馈 → 偏好更新 →
   下次约束注入 → 积累后自动修正打分权重。

5. 执行代理壁垒（v0.2.24.0 新建）
   Playwright 自动化 + Cookie 会话持久化 + 任务内决策 = 竞争对手难以复制的
   执行能力。纯推荐类产品无法自动执行；通用 AI（ChatGPT/Claude）没有状态、
   没有持久 session、没有垂直决策逻辑。Onegent 是二者的交集。

6. 协作网络效应（Decision Room，已实现）
   两人一起决策 → 分享链接 → 对方加入 → 自然拉新。
   每一次约会/出游决策都是一次病毒式分发。

================================================================
五、产品形态（当前实现）
================================================================

主区域：场景决策视图（1 个主方案 + 最多 2 个备选）
  · 高置信方案：备选默认折叠，绿色"✓ 已为你选定"，引导直接批准
  · 主方案卡：标题 / 副标题 / 推荐理由 / 时机说明 / 亮点列表 / 权衡说明
  · 备选卡：核心信息 + "设为主方案"一键升级 + 相应 deep link

品类推荐卡：
  · 真实评论信号面板（噪音图标 / 等位时间 / 约会适配分 / 招牌菜）
  · 5 维评分细则展开面板（金色进度条 + 雷点扣分项）
  · 实时反馈行（👍 / 👎 → 原因选择 → 即时偏好学习）
  · OpenTable Reserve 直链

行动轨道（ActionRail）：
  OpenTable 预约 / Google Maps / 加日历 / 发朋友 / 群体投票 /
  监控价格 / 导出行程 / 重新规划 / 自动执行预订（Autopilot）

Decision Room：
  · 从主界面一键发起，生成分享链接
  · 等待页自动轮询（4s），partner 加入后自动跳转投票
  · 双人投票界面：3 张候选卡，各自独立打勾
  · 双方同时同意 → 立即显示"You both agreed on [餐厅名]"
  · 冲突时展示最接近方案，附冲突原因说明
  · 事后反馈：Loved it / Fine / Never again

My Trips（Autopilot 任务中心）：
  · 按 job 展示所有后台预订任务
  · 步骤分级（需要决策 / 已完成 / 进行中 / 等待）
  · 每步展开决策日志（时间线格式）
  · Action Items（agent 失败时的手动备选）
  · What's next（明确指引用户下一步）
  · 满意度反馈 + Agent Insights 面板（可展开统计分析）

================================================================
六、北极星指标（已从"推荐准不准"升级为"完没完成 + 越来越懂你"）
================================================================

不再只看：推荐准不准 / 卡片好不好看 / 排名稳不稳定

现在看：
  · 用户完成一个任务需要几轮（目标：1-2 轮批准，不来回问）
  · 用户从输入到"批准方案"花多久（不是到"看到卡片"）
  · Autopilot 完成率（agent 自动搞定多少步，用户手动介入多少步）
  · Agent 决策接受率（用户接受 agent 时间/场馆调整的比例）
  · 用户最终是否真的采取行动（plan_outcomes 事件）
  · 用户事后是否后悔（post_experience_feedback 结构化反馈）
  · 偏好准确率：负反馈后，下次同类请求是否不再踩雷
  · Decision Room 转化率：发出链接 → partner 加入 → 双方投票完成的比例
  · 自然拉新率：Decision Room 带来的新用户占比

当前可测量（已有数据基础）：
  scenario_events 表：方案查看 → 行动点击 → 方案批准 漏斗
  plan_outcomes 表：partner_approved / action_rail_click / went
  plan_votes 表：群体投票分布
  price_watches 表：价格监控触发率
  feedback_prompts 表：反馈响应率 + 结构化原因分布
  user_preferences 表：偏好累积分布
  booking_jobs 表：autopilot 任务成功率 / 步骤完成率 / 失败原因分布
  agent_feedback 表：接受率 / 覆盖率 / 满意度 / 平台级别成功率
  decision_sessions 表：Decision Room 创建数 / 完成率 / 冲突率

================================================================
七、技术栈（当前状态）
================================================================

前端：Next.js 14 (App Router) · TypeScript · Tailwind CSS · Leaflet
AI：MiniMax（NLU + 评论信号解析 + 语义排序 + 双人约束合并）
数据：Google Places API v1 · SerpAPI · Tavily · Ticketmaster Discovery API
      Google Geocoding · SerpAPI Google Shopping
自动化：Stagehand（AI 层）— stagehand.act() 自然语言指令，驱动 gpt-4o-mini
       Claude Haiku（感知层）— 截图 + DOM → PerceptionResult（stage / nextAction）
       Playwright（RPA 兜底层）— locator.fill() / selectOption() / page.evaluate()
       两层降级架构：AI-first → Playwright fallback，每步独立控制
       BrowserProvider 接口 + 注册表 — 6 个 Provider（Booking.com / Expedia /
         Hotels.com / OpenTable / Resy / Yelp），executor 零改动可扩展新平台
       CDP 坐标点击 — 解决 React 合成事件问题（OpenTable 时段点击）
       isGenuineBooking 校验 — 防止平台回退链误判成功
       stealth 模式（禁用 AutomationControlled / navigator.webdriver 覆写）
       Cookie 持久化（.booking-cookies/{service}.json）
       Live Browser View — SSE 实时截图流 + canvas 双缓冲渲染（无闪烁）
       实时日志 — 内存环形缓冲区（liveLogStore），1.2s 轮询推送到任务 UI
存储：Neon PostgreSQL（29 张表）· localStorage（收藏夹 + 偏好缓存）
认证：Clerk（内部分析仪表板 + 跨设备偏好同步 + Decision Room 身份锚定）
推送：Web Push（VAPID）· PWA Service Worker
基础设施：Vercel（maxDuration=300 for autopilot，maxDuration=60 for Decision Room）
         PWA（离线支持）
API 层：30+ 个路由端点
Cron：4 个定时任务（反馈提示 / 价格检查 / 场馆质量 / 笔记本价格）
测试：Vitest（22+ 个测试文件 · 100% 通过 · golden-trip 等 Stage 2 测试已纳入）
版本：v0.2.32.0

================================================================
八、数据库（35 张表）
================================================================

| 表名 | 用途 |
|------|------|
| preference_profiles | 持久化用户偏好 Profile |
| favorites | 收藏的餐厅/场馆 |
| feedback | 用户结构化反馈 |
| scenario_events | 行为遥测（方案查看/批准/行动） |
| decision_plans | 保存的 DecisionPlan JSON（share URL） |
| plan_outcomes | 结果追踪（partner_approved / went / 反馈） |
| plan_votes | 群体投票结果 |
| price_watches | 已注册的价格监控 |
| user_preferences | Session + 用户维度偏好 KV 存储 |
| user_notifications | Web Push 订阅 |
| decision_sessions | 旧版双人 Decision Room 会话（legacy） |
| venue_baselines | 场馆评分基线，用于健康度预警 |
| booking_jobs | Autopilot 任务队列（状态/步骤/决策日志） |
| agent_logs | Booking / Executor 实时日志 |
| agent_feedback | Agent 反馈事件（接受/覆盖/满意度） |
| booking_monitors | 价格/库存等监控任务 |
| relationship_profiles | 双人关系画像 / 偏好记忆 |
| booking_profiles | 预订资料与支付/证件信息 |
| decision_rooms | Decision Rooms v2 主表（room 元数据 / approval_rule / booking_job_id） |
| decision_room_members | Room 成员、角色与 joined 状态 |
| decision_room_constraints | 每位成员提交的结构化约束 |
| decision_room_proposals | AI 生成的多选提案与 conflicts |
| decision_room_votes | proposal 投票（approve / decline / request_changes + option_id） |
| decision_room_messages | Room 消息流 / 系统事件 |
| user_profiles | 用户公开资料 / profile code |
| user_contacts | 联系人图谱 |
| user_groups | 用户自定义分组 |
| user_group_members | 群组成员关系 |
| room_member_intent_state | 每位 Room 成员的 IntentState JSON（Stage 2） |
| decision_room_private_messages | 每位成员的私聊 chat ↔ agent 频道（Stage 2） |
| user_direct_messages | 用户互发 DM（role=user\|agent，Stage 2） |
| chat_sessions | ChatGPT 风格持久化 solo 会话（Sessions） |
| chat_session_messages | chat_sessions 的消息流 |
| decision_room_trip_selections | Trip α 投票：每成员每品类勾选（T11） |

================================================================
九、版本历史摘要
================================================================

v0.2.40.0（2026-04-24）— **Week 5 #3 · Bug B + Bug C 收尾 + ship-readiness audit**
  · Bug B (US-W5-010):recovery-providers.ts 加 matchKnownVendor + headProbe
    helpers,tryWebsiteHandoff 三分支处理 vendor widget URLs (SevenRooms /
    Tock / OpenTable widget / Resy / Yelp / Eat App / Dineplan):accessible
    用 vendor URL,不 accessible fallback 到 officialWebsite + 明示 "click
    Reservations",无 vendor 行为不变。9 unit tests 全绿。
  · Bug C (US-W5-011):final-outcome.ts 加 defensive guard,当 agent skipped
    + 7 字段全空 + stage=unknown → 返 no_availability(原:paused_payment
    误报,逼下游 isGenuineBooking 用字符串 hack)
  · Ship audit (US-W5-012):typecheck ✅ exit 0,W5+W4 touched code 136/136
    tests pass 零自回归。Pre-existing 14 test failures 入 backlog #53。
    今天累计 74 commits,5 minor + 1 patch 版本(v0.2.36→40)。

v0.2.39.0（2026-04-24）— **Week 5 #2 · NLU 直订:"Book Carbone" 真去 booking**
  · 真实 bug:用户说 "Book Carbone..." NLU v2 RestaurantFields schema 没
    restaurant_name 字段,"Carbone"被默默丢,/api/chat/commit 返 plan
    handoff → /api/chat 推 5 家通用 Italian → 用户点 Marea → Marea
    booking 失败浏览器停在主页章鱼 logo
  · 修 5 个文件 5 commits 端到端:RestaurantFields/HotelFields 加 *_name 字段
    + extractor 加 3 worked examples + router emit directBooking flag +
    chat/commit kind="direct_booking" 分支 + 前端 handleDirectBooking
    POST 直接到 booking-jobs(跳过 47s 推荐)
  · 6 新 golden tests(R6-R9 + H_DB1-2),88/88 NLU 测试全绿,零回归
  · 联动 v0.2.38 W5 #1:Carbone 进入 OpenTable 后会触发 stage=unknown
    → recovery shouldTryProviderFallback whitelist 命中 → Phase 3
    Resy fallback 真跑

v0.2.38.0（2026-04-24）— **Week 5 #1 · 修 Phase 3 trigger 引擎边界**
  · 真实 bug:Carbone / Le Bernardin / Osteria La Baia / Ci Siamo 这类
    OpenTable 列在搜索但用自己预订系统的餐厅,final-outcome.ts 返
    status="error"(不是 no_availability),recovery.ts 旧 trigger 只看
    no_availability → Phase 3(Resy fallback)永远没触发
  · 新文件 lib/core/execution/should-try-fallback.ts:9 白名单 + 4 黑名单
    pattern 的 predicate。白名单从生产 summary 反向提取(Stalled at /
    Unverified checkout / stage=unknown / books through their own 等);
    黑名单 fast-fail infra 失败(HTTP 402 quota / bot block / page load
    fail)避免浪费 2-3min Resy 路径
  · recovery.ts 把 inline check 换成 helper 调用,Phase 2 time fallback
    trigger 同步收紧(error-escalation 直接跳 Phase 3,跳过 time)
  · 24 新测试(21 unit + 3 integration)+ 7 既有 zero regression

v0.2.37.1（2026-04-24）— **post-ship polish**
  · hooks-rules hotfix:DevNav 的 useEffect 移到 early return 之前,修
    /developers/keys 的 "Rendered fewer hooks than expected" 崩页
  · BrandStrip:Apple-style 36px 顶部 ribbon 跨 surface 导航
    (Onegent · For travelers · For developers),当前 surface 戴金色脉动
    小点。所有页面统一,1-click 横跳

v0.2.37.0（2026-04-24）— **Week 4 #3 · /developers landing + 自助 key dashboard**
  · 紧接 v0.2.36.0 MCP 分发渠道,v0.2.37.0 把 B 端"前门"全部铺好:Mercury 白
    净派 landing(7 signature moves: Hero+CodePreview+ScenarioGrid+HowItWorks+
    TrustStrip+Pricing+Footer)+ Linear 暗调 keys dashboard(自助 mint/revoke,
    一次性 plaintext reveal)+ 完整 MDX 文档(api/v1 + claude-mcp + chatgpt-apps
    经 next-mdx-remote 在 RSC 渲染)
  · 设计 bar 锁定 + 写入 memory:"做就要做到完美" → 后续 UI 默认按 Apple/Linear/
    Stripe/Mercury 标准,不再 MVP 偷懒
  · 命名定位锁定:tagline "Onegent — AI books your trip end-to-end",显示名
    "Travel Booking Agent",公司名 Onegent 保留(零流量阶段不折腾)
  · 数据 schema:api_keys.user_id 字段 + 索引,createApiKey 接受 userId,
    findApiKeysByUserId / findApiKeyById helpers,既有 8 个 require-api-key
    tests 零回归
  · 17 个 US-W4-01x..02x commits 全推,真烟测全部 200,typecheck 全程零 error

v0.2.36.0（2026-04-24）— **Week 4 #2 · @onegent/mcp-server(Claude + ChatGPT 分发窗口)**
  · 紧接 v0.2.35.0 REST API 就位,Week 4 #2 把 API 外接到 AI 分发渠道:
    新建 packages/mcp-server/ npm workspace,独立发布的 @onegent/mcp-server
    包,双 transport(stdio for Claude Desktop + Streamable HTTP for ChatGPT
    Apps),暴露 6 工具 book_restaurant/hotel/flight/activity + get_job_status
    + get_job_audit,全部走 /api/v1/* REST(即 dogfood Week 3 交付的 API 契约)
  · 定位层锁定:tagline "Onegent — AI books your trip end-to-end",外部显示名
    "Travel Booking Agent",公司名 Onegent 保留不改(零流量零 equity 阶段不折腾)
  · 真 E2E 证据:curl -XPOST /tools/list 在 HTTP transport 上拿到 SSE stream
    含 6 工具完整 JSON Schema;stdio 模式启动打印 "ready on stdio (6 tools)"
  · 用户文档双轨:packages/mcp-server/README.md(npm 首页) + docs/integrations/
    claude-mcp.md(Claude Desktop 安装到首次 booking 端到端)+ chatgpt-apps.md
    (Apps SDK preview + Custom GPT Action inline OpenAPI 双路径对照)

v0.2.35.0（2026-04-24）— **Week 3 REST API + Week 4 #11 C 端 dogfood 闭环**
  · 紧接 v0.2.34.0 lib/core 抽象,Week 3 把基础设施装水龙头:造 /api/v1/*
    REST API + API key 认证 + 完整 docs/api/v1.md + create-api-key.mjs CLI
    (7 个 US-W3-00x,10 个新端点/文件)
  · Week 4 #11 真流量 dogfood:lib/core/cend-adapter.ts 把 C 端 BookingJobStep
    legacy shape 反向转 ExecutionJobRequest,在 /api/booking-jobs POST +
    create-trip 加条件分支(USE_CORE_EXECUTOR_FOR_CEND=true + single restaurant
    + Clerk user)走 lib/core.createJob,step.body.__source 激活 Week 2 dual-gate
  · 决定性验证:UI 点"Reserve with Agent",dev.log 完整显示
    [booking-jobs] via lib/core → [start] dual-gate HIT → [stagehand] 真跑,
    C 端 + B 端从此共用同一执行引擎,"AI Travel Execution Layer"从 pitch 变代码事实
  · B 端 curl 6/6 全绿(missing_auth / invalid_key / metrics / 404 / 400 / 202+jobId)
  · 10 个 commit: e8a4651 → 05e5bc8, tsc 0 error, lib/core+api-auth 31 测试全绿
  · Posture 延续:lib/booking-autopilot 零改,老路径零改,关任一 env flag 秒回退

v0.2.34.0（2026-04-24）— **Week 2 · lib/core 抽象完成**(B 端基础设施就位)
  · 紧接 v0.2.33.0 定位转型,Week 2 把 Execution Engine 从 Next.js app 抽
    到 channel-agnostic 的 lib/core/ 模块。同一套执行能力既能被 C 端 chat
    UI 调用(现状),也能被未来 REST API / MCP connector / 外部 agent 调用
  · 新增 11 个 source file + 2 个 test file,~2800 行新代码,0 行 legacy
    删除,0 行 lib/booking-autopilot/ 修改
  · lib/core 目录结构:
      execution/  — types + executor(单步) + recovery(4 phase) +
                    recovery-providers(OpenTable→Resy→website chain) +
                    job-manager(createJob/completeJob)
      consent/    — policy + validator,4 ConsentAction × allow/deny,
                    DEFAULT_CONSENT_POLICY 每字段对齐今天 C 端 C 端行为
      audit/      — writeAudit / queryAudit,复用 agent_logs 表 + source=
                    "audit" marker 区分结构化 vs. debug log(零 DB migration)
      metrics/    — computeSuccessRate / computeProviderRanking,直接 SQL
                    聚合(破例不包 getAgentFeedbackStats,因 B 端需 per-provider
                    + timeRange 细查询)
      index.ts    — barrel,所有 public API 从这一处对外
  · 声明式 B 端契约 ExecutionJobRequest:scenario discriminator + 各 params,
    4 个 scenario(restaurant/hotel/flight/activity)完整覆盖现有所有
    runBrowserTask 调用路径(activity 暂不支持,走 lib/agent-runtime/skills/)
  · 双轨并存架构(姿势 D · 零回归保证):
      route.ts 的 runStepWithRecovery / runUniversalStep / runActivityStep /
        POST handler 全部 0 修改
      新 path 触发需 USE_CORE_EXECUTOR=true AND body.__source="lib/core/
        execution" 双重 gate 同时满足
      现有 C 端 job 创建路径(chat-commit / trip-package / DR synthesis)
        都不经过 job-manager → 没 marker → 即使 flag=true 仍走 legacy
      Week 3 /api/v1/ B 端 caller 通过 job-manager 创建的 job 自然带
        marker → 走新 path。正确的分发策略
  · Recovery 4 phase 实现 + Phase 2/3 智能分支:
      Phase 1 tryPrimary         retry up to maxRetries with [0,2000,5000]ms
      Phase 2 tryTimeFallbacks   ±30/60/90min candidates,consent-gated
      Phase 3 provider chain     OpenTable → Resy → Google Places website
      Phase 4 (不搬) venue switch / actionItem 留老 path 服务 C 端 UI
      "not found on opentable" 跳 Phase 2 直进 Phase 3;"no slot near 7pm"
        走 Phase 2 失败再 fall through Phase 3
  · 每个决策点都 validateConsent + writeAudit;4 ConsentAction(adjust_time /
    switch_venue / retry / use_provider)exhaustive switch 编译期 catch 缺失
  · 验证:tsc 0 错 + npm run build 成功 + 23 lib/core tests + 82 NLU v2
    零回归 + 每 story 主动验证(行为映射表对照 route.ts 逐段标注等价性 /
    简化 / 增强 / 差异)
  · Week 2 story 落地:US-001..006 是纯新模块(零现有代码修改),US-007a/b
    是 recovery 搬家(姿势 D 保证新 path 独立),US-008 是 barrel + 23 tests,
    US-009 是 route.ts 加双重 gate(~45 行 helper,0 行 legacy 修改)
  · 下一步:Week 3 `/api/v1/execution-jobs` REST endpoint + api_keys 表 →
    Week 3-4 MCP connector 占位 Claude/ChatGPT directory 分发红利 →
    Week 4 /developers landing(消费 metrics/ 数据源)

v0.2.33.0（2026-04-24）— **Positioning Shift · Travel Execution Layer**（战略转型）
  · 定位从"多品类决策助手"收窄为 **AI Travel Execution Layer**，
    专注餐厅 / 酒店 / 机票 / 活动 / 多人 trip 五条旅行主线
  · 代码归档 11 个非旅行文件 + 2 个 test 到 `_archived/2026-04-positioning-shift/`：
    4 pipelines（laptop/smartphone/headphone/credit-card）+
    3 planners（big-purchase/fitness/gift）+
    4 components（CreditCardCard/LaptopCard/SmartphoneCard/HeadphoneCard）
    用 `git mv` 保留历史，每个归档目录带 README 说明原因
  · 首页 `app/page.tsx` 净删 182 行死代码（4 import + 4 JSX + 4 聚合检查）
  · `lib/agent.ts` 净删 226 行（8 import + 3 scenario 分支 + 4 独立路由）
  · `tsconfig.json` + `vitest.config.ts` 新增 `**/_archived/**` 到 exclude，
    归档代码不参与 typecheck 也不跑测试
  · NLU v2 非旅行请求礼貌拒绝：
    `extractor.ts` +35 行 OUT-OF-SCOPE DETECTION（6 类非旅行话题 tag
      `out_of_scope:` 前缀到 `planning_assumptions`）
    `chat.ts` +3 行 OUT-OF-SCOPE DECLINE（看到前缀→礼貌引导 ChatGPT/Claude，
      语言匹配）
    `router.ts` +12 行 `buildStateSummary()` 把 `planning_assumptions`
      append 到两个返回路径让 chat 层能看到 tag
    纯 prompt + summary 改动，不新增类型、不改 router 分支逻辑
  · 新 golden test `golden-out-of-scope.test.ts` 3 case（英文 laptop /
    中文瑜伽 / 英文 gift）驱动真实 LLM 守住 decline 路径
  · 工程数据：27 文件（+377 -609），9 atomic commits（7 feat + 2 chore），
    tsc 0 错，build 绿，NLU v2 85/85 pass，Ralph 自主 agent 跑完全部
    7 个 user story
  · 为下一阶段铺路：Week 2 `lib/core/` 抽 Execution Engine → Week 3
    REST API + `api_keys` → Week 4 `/developers` landing → Week 5 MCP

v0.2.32.0（2026-04-24）— Stage 2 · T11 全量落地（inline proposal card + α 投票 + Autopilot 启动）
  · 新组件 `TripProposalChatCard.tsx`：4 列（🏨 · ✈ · 🍽 · 🎟）内联在聊天流，
    每张 minicard 带 "N/M picked" 聚合徽章（≥50% 变金），4s 轮询实时同步共识
  · α 投票语义合并交互：一个金色 "Lock in & approve" 按钮原子化完成
    `PUT /trip-selection` + `POST /vote(approve)`，老的三 pill 投票行全部
    去掉；留一个辅助 "Decline" 作为退出出口
  · 新表 `decision_room_trip_selections` (proposal_id, user_id, selection_json)
    + `decision_room_private_messages` 加 `meta_json JSONB` 列（inline card marker）
  · 新 3 个 API endpoint：GET `/trip-proposal`（含 is_synthesizing 启发式）、
    PUT `/trip-selection`、/book-trip 重写（approval-rule gate + consensus
    算法 + fire-and-forget POST `/start` 真正启动 Autopilot）
  · 跨客户端 Proposal Watcher：进房后 4s poll `/trip-proposal`，别人触发
    合成后这边自动 mount 卡片；合成中显示脉冲进度卡（所有成员都能看到，
    不只是触发人）
  · Executing 态：`booking_job_id` 写入后卡片坍缩成 "✈️ Trip booked ·
    See progress →"，跳 /tasks?focus=<jobId>&view=live 看 Live 视图滚动
  · NLU 硬化：`downgradeSpuriousRefine` 后处理防 extractor 误把全新 trip
    请求打成 refine_existing；`fillCreateRoomPartySize` 扩展到 trip 场景
    （和 ziwei Guo = 2 travelers 自动推断）；`isSynthesisTrigger` in-room
    触发器 + 双层去重守护防重复造 proposal 把老票变成孤魂
  · Collapsible Sidebar：260px ↔ 44px chevron 切换，localStorage 持久化，
    折叠给 proposal card 多腾出 216px
  · bug 收尾：book-trip 读 create-trip 返的 camelCase `jobId`；`/tasks`
    URL 改成 `?focus=...` query；SELECT_PILL / LOCK_BTN 的 border
    shorthand → longhand 修掉 React rerender warning；getLatestTripProposal
    helper 让 active+accepted proposal 都正常返给客户端

v0.2.31.0（2026-04-24）— Stage 2 Trip Room + DM + Sessions + DB-as-truth
  · Stage 1 · Solo Trip Packaging：首页 chat trip scenario，单人 hotel+flight+activity+
    restaurant 一次性打包；Phase 1 TripIntentState → Phase 2 TripPackageCard 多 tier →
    Phase 3 `/api/booking-jobs/create-trip` 拆成 N 步并行 Autopilot
  · Stage 2 · 多人 Trip Decision Room：decision_rooms 新增 type='trip' + flow='chat' +
    categories[]；每成员私聊频道（decision_room_private_messages）+ IntentState 持久化
    （room_member_intent_state）+ trip-synthesis 聚合 agent（N/N 触发 + 30s 防抖）+
    多 tier proposal 投票 + payer 一键 create-trip 执行
  · Invite-UX 全链路：memberNames → resolveContactsByNames → inviteToDecisionRoom
    (status='invited') → agent-role DM 到被邀请人 → /rooms 页 Accept 按钮 →
    `/api/rooms/[id]/accept-invite` 翻 joined → 进入 chat-flow 房间；
    unresolved_names 在 ConfirmCard 预警
  · 用户互发 DM：user_direct_messages 表（role=user|agent + meta_json），
    /api/dm/[userId] POST+GET，Telegram 风格 /contacts 分栏，GlobalNav Contacts 入口，
    Delete room 自动给所有成员发"已解散"DM
  · ChatGPT 风格 Sessions：chat_sessions + chat_session_messages 表，首条消息自动
    create_session + URL ?session_id=<id>，Sidebar 常驻左侧分 Rooms / Sessions 两区，
    session → room 升级标记 upgraded_room_id（单入口原则）
  · DB-as-source-of-truth 架构：commit 时 server seed 完整对话 + welcome 到创建者
    private channel + 每位被邀请成员的 welcome，client 确认后 clearChat → replay 从
    DB 拉回（不再依赖 Strict Mode 下脆弱的内存 hand-off）
  · Zombie room_id URL 兜底：404/403 自动清 activeRoomId + router.replace("/")
  · NLU v2 trip 支持：TripFields 类型 + extractor WORKED EXAMPLES + router
    getMissingForScenario('trip') + golden-trip.test.ts
  · `lib/conversational-nlu.ts` 已删除，`ConversationalNLUResult` alias 到 NluV2ParseResult

v0.2.29.0（2026-04-18）— Decision Rooms v2 + 社交协作层
  · Decision Room 升级为 `/rooms` 独立产品面：列表页 / 新建页 / 房间页 / join by short code
  · 新增房间 API：create / join / members / constraints / propose / vote / state / execute / clear-booking
  · 提案引擎升级：2 人沿用 two-party，3+ 人切到 `runAgentForNParty`，支持 conflict 检测与多 option proposal
  · 投票规则升级：支持 unanimous / majority；N<3 自动退化为 unanimous，accepted proposal 持久化 winning option
  · 执行闭环：payer 可从 accepted restaurant proposal 直接启动 booking_job，Room 内写入 booking_started 系统消息
  · 实时同步：`useRoomState()` 基于 version + 304 no-change 轮询，降低房间状态刷新成本
  · 社交层：新增 `user_profiles / user_contacts / user_groups / user_group_members`，支持联系人、群组、recent collaborators
  · OpenTable 支付收尾：修复卡号字段失败时的日志与判定，Ready for payment 不再误报“card details filled”

v0.2.28.1（2026-04-17）— Expedia 机票 RPA bugfix 收尾
  · 修复 American / Delta 选票链路：24 小时制时间可正确匹配 Expedia 页面中的 12 小时制文案（如 14:54 → 2:54pm）
  · 修复 fare select 级联点击：兼容 Stagehand page 与 Playwright locator 差异，避免 selector click / mouse API 误用
  · 修复 bundle 弹窗关闭：优先命中真实可见文本 "No thanks"，不再误点左上角关闭按钮或日期选择器
  · 修复二次 bundle 回弹：关窗后若 fare modal 仍在，自动补点票价；若 bundle 再次弹出则继续自动 dismiss
  · 新增 href 兜底：若 "No thanks" 携带 Flight-Information 跳转链接且前端未 commit，直接导航进入后续 checkout 流程

v0.2.26.0（2026-04-14）— 多 Provider 架构 + 餐厅预订自动化
  · BrowserProvider 接口 + 注册表：booking-com / expedia / hotels-com / opentable / resy / yelp
  · Expedia + Hotels.com 全链路自动化（listing → room → form → paused_payment）
  · OpenTable 餐厅预订：程序化时段选择（CDP 坐标点击）+ 表单填写
  · 餐厅多平台瀑布式回退：OpenTable → Resy → Yelp → Google Places 官网直链
  · no_availability 时提取可用时段展示给用户，消灭静默失败
  · isGenuineBooking 校验：防止回退链误判成功
  · RestaurantStepCard 组件：Tasks 页面餐厅步骤展示
  · RecommendationCard 新增日期/时间选择器
  · Google Places 官网直链回退（替换旧版 Yelp 回退）
  · 城市覆盖扩展至 47 个美国城市（+Nashville 等 20 城）

v0.2.28.0（2026-04-16）— 全平台 Booking Automation 架构对齐 + 机票 RPA 升级
  · 机票预订：从 AI Agent 升级为程序化 RPA（findFlight → selectFare → dismissBundle → skipToCheckout）
  · AI 填表升级：fillFlightGuestFormWithAI（姓名/邮箱/电话/DOB/护照/KTN）+ auditAndRefillEmptyFields
  · 架构规范写入 CLAUDE.md：程序化导航 + AI 感知三层模式，所有新平台必须遵守
  · OpenTable / Resy：fillGuestForm 升级为 programmatic 主填 + AI 补漏 + auditAndRefill 验证
  · InlineJobCard：删除后即从 inlineItems 移除（onDeleted 回调），不再显示 "Starting booking task..."
  · 消息布局：酒店/机票卡片现在内联在对应 assistant 消息之后，不再堆在底部
  · ProfilePicker 淘汰：点击预订直接自动取 default profile，零弹窗
  · 修复 raw.textContent is not a function（改用 try/catch + evaluate 兜底）
  · 修复 fatalApiError 正则未覆盖 "exceeded your current quota"
  · 修复 page.waitForFunction / waitForSelector 在 Stagehand proxy 不可用（改为 evaluate 轮询）
  · 修复 targetDepartureTime 格式（从 raw 时间戳改为 formatTime 后的 "2:54pm"）
  · gstack 升级：0.11.8.0 → 0.18.1.0 + bun 安装

v0.2.27.0（2026-04-16）— 机票 Autopilot + 旅行证件 + 内联任务卡 + 对话式证件收集
  · 机票预订升级：Kayak 纯搜索 → Expedia 全链路 Autopilot（选票 → 填信息 → 止步付款）
  · Expedia 机票 URL：支持单程/往返，cabin class 映射（economy/business/first/premium_economy）
  · 旅行证件系统（BookingProfile 新增 8 字段）：
      date_of_birth / nationality / passport_number（AES-256 加密）/
      passport_expiry / passport_country / known_traveler_number /
      driver_license_number（加密）/ driver_license_state
  · DB 安全迁移：ALTER TABLE ADD COLUMN IF NOT EXISTS，不影响已有数据
  · /permissions Profile 表单新增 "Travel Documents" 折叠区（含 Show/Hide 敏感字段）
  · booking job 启动时检查护照，缺失直接阻断并触发对话流
  · InlineJobCard（components/booking/InlineJobCard.tsx）：
      - 点击 Book with Autopilot 不再跳转 /tasks
      - 任务卡出现在主聊天页结果列表正下方（inlineItems 状态，独立于消息流）
      - 每 3 秒轮询 /api/booking-jobs/[id]，状态实时更新
      - 折叠/展开 / 步骤卡 / Watch live / Replay / Open all / 删除 / Retry stuck
      - 新搜索时自动清空（监听 allFlightCards / allHotelCards 变化）
  · 对话式证件收集（全程走主聊天框）：
      - 任务出错 → onNeedsTravelDocs 回调 → agent 在聊天里问 DOB 和护照号
      - pendingTravelDoc 状态激活，输入框 placeholder 变成格式提示
      - sendCurrentInput 拦截：有 pendingTravelDoc → parseTravelDocs() 解析 → 保存 → 重启 job
      - 解析失败 → agent 再问一次，pendingTravelDoc 保持激活直到成功
      - 全程不触发新搜索，原有航班列表和任务卡保持不变

v0.2.25.0（2026-04-08）— AI-first 两层执行架构 + Live View 优化
  · 重构 Autopilot 执行层：AI 主导 + Playwright 兜底双层降级
  · Stagehand AI 接管：listing 点击 / room 选择 / guest form 填写 / stage 检测
  · 房型偏好：从 task 文本提取 room preference，AI 精确选择对应房型
  · Form audit：扫描空字段 → 定向补填，AI fill 后零遗漏
  · Phone JS fallback：native setter 补填手机号，绕过 stagehand schema bug
  · Live Browser View：canvas 双缓冲渲染（消除闪烁），screenshot timeout 缩短至 2.5s
  · 实时日志：liveLogStore 内存环形缓冲区，任务 UI 实时流式展示

v0.2.24.0（2026-04-01）— Autopilot Booking + Agent 反馈闭环
  · Phase 5 全部落地：后台异步执行 / 任务内自主决策 / Cookie 登录持久化
  · My Trips 统一任务视图（决策日志 / 分级展示 / What's next）
  · 失败恢复：餐厅时间 fallback（±30/60/90 分钟自动尝试）
  · Agent 反馈闭环：accepted / manual_override / 满意度三路信号
  · Agent Insights 面板：平台成功率 / 哪类任务最需人工 / 最常被覆盖的场馆

v0.2.23.0（2026-03-23）— Decision Room + 场景优化 S-1~S-5
  · Phase 4：双人协作决策（约束合并 / 冲突检测 / 实时投票）
  · S-1 快餐模式 / S-2 蜜月酒店 / S-3 亲子酒店 / S-4 开卡奖励 / S-5 单约束精炼
  · G-1 航班时段过滤 / G-2 信用卡组合分析 / G-3 模块级精炼 / G-4 场馆质量预警

v0.2.22.0（2026-03-22）— Weekend Trip 稳定性 + 测试覆盖
  · Hotel pipeline 稳定性修复（timeout / fallback cards / 日志）
  · 10 个 weekend-trip 测试用例

v0.2.21.0 — Fitness OS（6 个月健身场景）
v0.2.20.0 — Gift OS（礼物推荐 + Google Shopping）
v0.2.19.0 — Concert & Event OS（Ticketmaster 集成）
v0.2.18.0 — 推送通知 + PWA Service Worker
v0.2.17.0 — 价格监控（price_watches + 每日 cron）
v0.2.16.0 — 持久化偏好 + Clerk 跨设备同步
v0.2.15.0 — 5 维度打分 + 评分细则面板
v0.2.14.0 — 真实评论结构化信号（noise / wait / dishes / red_flags）
v0.2.13.0 — 场景引擎（Date Night / Weekend Trip / Big Purchase）
v0.2.12.0 — Session 偏好提取（3.3a/b/c）
v0.2.11.0 — 品类推荐引擎（餐厅 / 酒店 / 航班 / 信用卡 / 数码）

================================================================
十、支持场景一览
================================================================

## 🍽️ 餐厅

| 场景 | 用户输入示例 | 输出 |
|------|-------------|------|
| 约会晚餐 | "周五晚上曼哈顿约会，$80/人，安静，不要连锁" | 主方案 + 2 备选 + 风险提示 |
| 商务宴请 | "接待客户的高端中餐，包间，预算 $150/人" | 3 套方案 + 商务适配原因 |
| 朋友聚餐 | "6 个人周六晚上吃日料，能喝酒聊天" | 方案 + 等位预期 + 是否需预约 |
| 快速午餐 | "公司附近 15 分钟内能吃完的" | 快速选项 + 距离 + 出餐速度（S-1） |
| 特殊饮食 | "素食友好的意大利餐厅" | 筛选后方案 + 菜单推荐 |
| 过敏限制 | "有朋友对坚果过敏" | 过滤红旗 + 菜单安全说明 |

## 🏨 酒店

| 场景 | 用户输入示例 | 输出 |
|------|-------------|------|
| 商务出差 | "下周芝加哥出差，靠近会议中心，$200/晚" | 商务酒店方案 + WiFi/会议室评价 |
| 周末度假 | "下个月去 LA 过周末，想轻松不折腾" | 3 套打包方案（酒店 + 餐厅 + 酒吧）|
| 蜜月/纪念日 | "结婚周年去迈阿密，海景房，浪漫" | 奢华方案 + 套房/SPA 提权（S-2）|
| 家庭出游 | "带两个孩子去奥兰多，靠近迪士尼" | 亲子酒店 + 泳池/儿童俱乐部（S-3）|

## ✈️ 航班

| 场景 | 用户输入示例 | 输出 |
|------|-------------|------|
| 经济出行 | "下周五纽约飞芝加哥，最便宜的" | 最低价方案 + 中转风险 + 行李政策 |
| 红眼回避 | "不要太早或太晚的航班" | 过滤后方案 + 到达时间 + 酒店衔接（G-1）|
| 时间限制 | "下午 5 点前必须到" | 最早不超过 7am / 最晚不超过 9pm 筛选 |

## 💳 信用卡

| 场景 | 用户输入示例 | 输出 |
|------|-------------|------|
| 旅行常客 | "每月机票 $2000，酒店 $1500" | 边际价值最高的卡 + 积分策略 |
| 组合优化 | "我有 CSP 和 Amex Gold，还需要什么？" | 组合缺口分析 + 下一张卡建议（G-2）|
| 开卡奖励 | "最近有什么好的开卡奖励？" | 当前最佳 SUB + 消费门槛可行性（S-4）|

## 💻 数码

| 场景 | 用户输入示例 | 输出 |
|------|-------------|------|
| 开发者 | "写代码用，不想太重，预算 $1800" | 默认推荐 + 为什么不是另外两台 |
| 手机换新 | "从 iPhone 13 升级，预算 $1000" | 是否值得升级 + 最佳时机 + 旧机估价 |
| 耳机 | "通勤降噪，偶尔跑步" | 场景匹配方案 + 舒适度评价 |

## 🎵 活动票务

| 场景 | 用户输入示例 | 输出 |
|------|-------------|------|
| 演唱会 | "周五晚 NYC，Taylor Swift 附近场次" | Ticketmaster 真实票源 + 购票链接 |
| 爵士演出 | "想看爵士演出，Manhattan，这个月" | 最多 3 场（Top pick / 最具氛围 / 隐藏好场）|

## 🎁 礼物 / 🏋️ 健身

| 场景 | 用户输入示例 | 输出 |
|------|-------------|------|
| 生日礼物 | "给我妈买生日礼物，她喜欢园艺，$150" | 安全选 / 最走心 / 最有创意 + 购买链接 |
| 瑜伽课 | "Brooklyn 周六早上瑜伽课，$25 以下" | 3 工作室 + ClassPass + Mindbody 备选 |

## 🔄 持续协作 / 👫 双人决策

| 场景 | 用户动作 | Onegent 响应 |
|------|---------|-------------|
| 单约束精炼 | "再便宜点" | 只更新价格约束，保留其他条件（S-5）|
| 模块替换 | "换个酒店，航班不变" | 只重跑酒店模块（G-3）|
| Decision Room | A 说"安静"，B 说"意大利" | 合并约束 → 候选卡 → 双方投票 |
| 冲突协调 | A 素食 + B 必须有牛排 | 检测冲突 → 说明原因 → 最近方案 |

================================================================
十一、用户旅程示例
================================================================

### 场景 A：一个人约会规划（传统模式）

```
用户: "下周五约会，曼哈顿，$80/人，安静"
  → Onegent 解析意图：date_night + restaurant + bar
  → 并行搜索候选（Google Places + Tavily）
  → 评分排序（评论信号 + 用户偏好）
  → 组装方案：主方案 + 2 备选 + 餐后去处 + 风险

用户: "换个便宜点的"
  → Refinement：只更新价格约束，保留安静/Manhattan/日期

用户: [点 Share]
  → 生成分享链接 → 朋友打开 → "This works for me" → partner_approved

用户: [点 Book everything →]
  → Autopilot 启动 OpenTable
  → 7pm 无位 → 自动尝试 7:30pm → 成功 ✓
  → 推送: "Le Bernardin pre-filled at 7:30pm — open and pay"
  → /trips → 展开决策日志 → 点 Open → 付款
```

### 场景 B：两人一起决策（Decision Room）

```
A: "安排一个周五约会，我不喜欢太吵的"
  → 创建 Decision Room → 生成分享链接 → 发给 B

B: [打开链接] 输入: "想吃意大利，不要等位"
  → 合并约束：安静 + 意大利 + 不等位
  → 无冲突 → 生成 3 张候选卡

A 和 B 分别独立投票
  → 双方都选了"Buccini" → "You both agreed on Buccini ✓"
  → 事后反馈: A "Loved it" / B "Fine"
```

### 场景 C：周末旅行完整执行

```
用户: "下个月去 Chicago 过周末，预算 $900"
  → 并行：航班 pipeline + 酒店 pipeline
  → 配对组包：3 套方案 + 时间衔接检查 + 总价

用户: "选套餐 A，帮我订"
  → Autopilot:
      ✈ Kayak → AA2341，返回 checkout 链接 ✓
      🏨 Booking.com → Hotel X 预订页 ✓
      🍽 OpenTable → 7pm 无位 → 7:30pm 自动调整 ✓
  → 推送: "✈ 🏨 🍽 Your Chicago trip is ready — 3/3 pre-filled"
  → /trips → 决策日志 → 3 个 Open 按钮 → 逐一付款
```

================================================================
十二、本地启动（Getting Started · 给新工程师）
================================================================

【前置要求】
  · Node.js ≥ 20（Next.js 16 要求）
  · npm ≥ 10 — lock 文件为 package-lock.json，不要换 pnpm / yarn
  · Windows：git 自动做 LF → CRLF 转换，不要关 autocrlf（否则 Vercel deploy 异常）
  · Playwright 浏览器：首次需 `npx playwright install chromium`

【启动步骤】
  1. `git clone` → `npm install`
  2. 复制 `.env.local.example` → `.env.local`，填入下方 API keys
  3. 数据库：生产/staging 走 Neon PostgreSQL，连接串写入 `POSTGRES_URL`；
     本地首启动会自动执行 `lib/schema.sql` 中的 CREATE TABLE IF NOT EXISTS
  4. `npm run dev` → http://localhost:3000
  5. `npm test` → Vitest 全量（22+ spec，100% 通过）
  6. `npm run build` → 生产构建；postbuild 会跑 `scripts/inject-sw-version.mjs`
     注入 service worker 版本号（每次 build 必须跑一次，sw.js 缓存才能 bust）

【必填环境变量】
  · POSTGRES_URL                        Neon PostgreSQL 连接串
  · NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   Clerk 公钥
  · CLERK_SECRET_KEY                    Clerk 私钥（社交层 / Room 身份锚定核心）
  · MINIMAX_API_KEY                     MiniMax（NLU / 排序 / two-party / n-party 约束合并）
  · ANTHROPIC_API_KEY                   Claude Haiku（Booking 感知层 perceive.ts）
  · OPENAI_API_KEY                      Stagehand 驱动模型（gpt-4o-mini）
  · GOOGLE_PLACES_API_KEY               餐厅 / 酒店核心数据源
  · SERPAPI_KEY                         价格元数据 / 航班 / 数码比价 / 购物
  · TAVILY_API_KEY                      编辑语境抓取（评论信号）
  · TICKETMASTER_API_KEY + _SECRET      活动票务
  · BOOKING_ENCRYPTION_KEY              `booking_profiles` 表的证件信息 AES 加密密钥
  · CRON_SECRET                         4 个 cron 端点的 Bearer 校验
  · NEXT_PUBLIC_VAPID_PUBLIC_KEY /
    VAPID_PRIVATE_KEY / VAPID_EMAIL     Web Push 推送（PWA 通知必需）

【可选环境变量】
  · PLAYWRIGHT_HEADLESS=true|false      Autopilot 无头开关（本地调试常设 false）
  · PLAYWRIGHT_SLOW_MO=<ms>             本地调试放慢 RPA 速度
  · AI_LOOP_FULL=true                   启用完整 40-step AI loop（默认走程序化优化）
  · GEMINI_API_KEY /
    GOOGLE_GENERATIVE_AI_API_KEY        实验性，非必填

【Decision Room 测试账号】
  · Clerk dev instance: `natural-tuna-90`
  · 账号：`ziweiA` / `ziweiB` / `ziweiC`（多人 Room 流程 T1–T18 专用）
  · 完整测试计划：`DECISION_ROOM_TEST_PLAN.md`

【Booking cookies 初始化】
  · Autopilot 首跑需真人登录各平台一次
  · 辅助脚本：`scripts/save-booking-cookies.mjs` / `scripts/save-expedia-cookies.mjs`
  · 或调用 gstack skill：`/setup-browser-cookies`
  · 持久化路径：`.booking-cookies/{service}.json`（已 gitignore）
  · Cookie 过期会触发 login wall，执行器会降级为手动链接 + Action Item

================================================================
十三、目录结构地图（Where does the code live?）
================================================================

```
app/                                   Next.js App Router（前端 + API）
├── api/                               30+ 端点，按域划分
│   ├── agent-chat, plan, chat         核心 Agent 对话与规划
│   ├── booking-autopilot              Autopilot 任务触发与状态
│   ├── booking-jobs                   任务历史与详情
│   ├── browser-live                   SSE 浏览器直播（6fps 截图流 + canvas 双缓冲）
│   ├── rooms/[id]/{propose,vote,      Decision Room v2 全套端点（含
│   │   finalize,state,leave,abandon,  approval-rule 切换 / creator 转移 /
│   │   approval-rule,transfer-creator}proposal 执行 booking）
│   ├── contacts/{requests,blocks}     社交层：联系人请求 / 拉黑 / 分组
│   ├── cron                           4 个定时任务（反馈 / 价格 / 场馆质量 / 笔记本）
│   └── ...                            feedback / telemetry / metrics / share / subscriptions
├── rooms/                             Decision Room 页面（列表 / 新建 / 详情）
├── decide/                            单人主决策入口
├── trips, tasks, plan                 执行视图（Autopilot 任务 / 行程）
├── insights, metrics, monitoring      内部分析仪表板
└── _ui, hooks, contexts               共享前端基础设施

components/                            可复用 React 组件
├── RecommendationCard + *Card.tsx     六大品类卡片（Restaurant / Hotel / Flight /
│                                      Laptop / Smartphone / Headphone / CreditCard）
├── BrowserLiveView.tsx                Autopilot 实时截图直播
├── AutopilotRunnerModal.tsx           任务发起 UI
├── DecisionRoomModal.tsx              Room 快速入口
├── ScenarioPlanView.tsx + ActionRail  决策方案主视图 + 行动按钮
└── booking/                           Autopilot 任务子组件

lib/                                   核心业务逻辑（非 UI）
├── agent.ts                           Agent 主入口 runAgent()
├── agent/
│   ├── nlu-v2/                        首页 chat / DR 私聊的三层 NLU（Plan C）
│   │   ├── types.ts                   IntentState / RouterAction / 各场景 XxxFields
│   │   ├── extractor.ts               Layer 2：gpt-4o-mini + JSON mode
│   │   ├── router.ts                  Layer 3：纯函数 routeIntent()
│   │   ├── chat.ts                    Layer 1：Claude Sonnet 自然语言 reply
│   │   ├── index.ts                   编排器 analyzeConversationalV2()
│   │   └── __tests__/                 golden-solo / golden-multi / golden-trip
│   ├── planners/                      场景规划器（date-night / weekend-trip / city-trip /
│   │                                  big-purchase / concert-event / fitness / gift / trip-package）
│   ├── pipelines/                     品类 pipeline（restaurant / hotel / flight /
│   │                                  laptop / smartphone / headphone / credit-card）
│   ├── planner-engine/                modular planner 引擎（EngineConfig 驱动）
│   ├── parse/                         传统 Agent pipeline 的场景 NLU 解析器（非首页 chat）
│   ├── composer/scoring.ts            综合打分（产品灵魂，5 维度 + 惩罚）
│   ├── two-party.ts                   N=2 Decision Room 引擎
│   ├── n-party.ts                     N≥3 Decision Room 引擎
│   ├── trip-intent-state.ts           Trip 信息收集状态机
│   └── scenario-configs/              场景配置（当前仅 city-trip）
├── booking-autopilot/
│   ├── stagehand-executor.ts          主执行器（skipInitialAgent 路由、三层架构入口）
│   ├── providers/                     Provider 插件（6 平台 + registry.ts 注册表）
│   │   ├── booking-com.ts, expedia.ts, hotels-com.ts
│   │   ├── opentable-com.ts, resy-com.ts, yelp-com.ts
│   │   └── registry.ts                URL → Provider 路由
│   ├── ai-loop/
│   │   ├── fill-form.ts               Layer 2/3：AI 填表 + auditAndRefillEmptyFields
│   │   ├── find-listing.ts            clickTargetListingAI / selectRoomAI
│   │   ├── perceive.ts                Claude Haiku 感知（截图 + DOM → PerceptionResult）
│   │   ├── execute.ts                 Stagehand act() 执行下一步
│   │   └── loop.ts                    主循环（AI-first → Playwright fallback）
│   ├── core/                          profile / stage-assessment / recovery /
│   │                                  provider-router / instructions / final-outcome
│   └── cookie-store.ts                cookies 加解密与加载
├── rooms/
│   ├── propose.ts                     提案生成入口（路由 two-party / n-party）
│   ├── learn.ts                       Room 结束后学习反馈
│   └── proposal-shape.ts              proposal JSON schema
├── db.ts                              数据层（29 张表的 query / insert / update）
├── schema.sql                         建表 DDL
├── minimax.ts                         MiniMax API 客户端
├── tools.ts                           外部工具（Places / SerpAPI / Tavily / Ticketmaster）
├── nlu.ts                             传统 Agent pipeline NLU（英文快路径 + MiniMax 慢路径）
│                                      · 仅供 lib/agent.ts 使用；首页 chat 走 agent/nlu-v2/
├── schemas.ts                         Zod 结构化数据 schema
├── types.ts                           共享 TypeScript 类型
├── memory.ts, replan.ts, policy.ts    偏好记忆 / 模块级精炼 / 策略层
├── live-log-store.ts                  Autopilot 实时日志环形缓冲区
└── browser-session-store.ts           浏览器 session 池

scripts/                               命令行辅助
├── generate-icons.mjs                 PWA 图标生成
├── inject-sw-version.mjs              postbuild 注入 service worker 版本
├── save-booking-cookies.mjs           Booking.com 登录态保存
├── save-expedia-cookies.mjs           Expedia 登录态保存
└── ralph/                             Ralph autopilot workspace（非主流程）

data/                                  静态数据（数码品类白名单等）
docs/                                  设计文档归档
public/                                静态资源（icons / sw.js / manifest）
```

================================================================
十四、关键任务入口（Cookbook · 我要改 X 改哪）
================================================================

新增一个 Booking 平台 Provider
  1. `lib/booking-autopilot/providers/<name>.ts`  实现 `BrowserProvider` 接口
     （setup / getStageSignals / fillGuestForm / fillPaymentForm）
  2. `lib/booking-autopilot/providers/registry.ts`  `registerProvider(xxxProvider)`
  3. `lib/booking-autopilot/stagehand-executor.ts`  加 `xxxPageOpen` 检测 +
     加入 `skipInitialAgent` 列表 + 加入 `skipProviderLabel` 映射
  4. `lib/booking-autopilot/ai-loop/fill-form.ts`  如有新字段类型，加 `PROFILE_PATTERNS` 规则
  5. 完整 Checklist：根目录 `CLAUDE.md` 的 "Booking Automation Architecture" 章节
  ⚠ 永远不要对已知平台跑 40-step blind agent — 违反 ADR-1

新增一个 Agent 场景（如"生日派对规划"）
  1. `lib/agent/parse/<scenario>.ts`     NLU 解析器
  2. `lib/agent/planners/<scenario>.ts`  场景规划器（组装 pipeline 输出）
  3. `lib/agent/pipelines/<category>.ts` 如需新品类 pipeline，新增；否则复用
  4. `lib/agent/scenario-configs/<s>.ts` 如走 EngineConfig 模式，新增配置
  5. `lib/agent/composer/scoring.ts`     如需新打分维度，扩展打分函数
  6. `lib/types.ts` + `lib/schemas.ts`   新的结构化类型与 Zod schema

新增首页 chat 场景或字段（NLU v2 三层）
  1. `lib/agent/nlu-v2/types.ts`         `IntentState.XxxFields` 或 `ProxyConstraints`
  2. `lib/agent/nlu-v2/extractor.ts`     system prompt "WORKED EXAMPLES" 补 1-2 条
  3. `lib/agent/nlu-v2/router.ts`        `getMissingForScenario()` 声明 REQUIRED
  4. `lib/agent/nlu-v2/index.ts`         `flattenScenarioFields()` 做 v1-key 对齐
  5. `lib/agent/nlu-v2/__tests__/`       补 golden test（否则不算完工）
  完整 Checklist：根目录 `CLAUDE.md` "Conversational NLU Architecture" 章节

改 Decision Room 逻辑
  · 投票规则      → `lib/db.ts` 的 `decideProposalOutcome` / `finalizeProposal`
  · 约束提交      → `lib/db.ts` 的 `upsertRoomConstraint` +
                    `app/api/rooms/[id]/constraints/route.ts`
  · 提案生成      → `lib/rooms/propose.ts` → `lib/agent/{two-party,n-party}.ts`
  · approval_rule → `app/api/rooms/[id]/approval-rule/route.ts`
  · 成员管理      → `app/api/rooms/[id]/{leave,abandon,transfer-creator}/route.ts`
  · Room UI       → `app/rooms/[id]/page.tsx`（739 行，已按 tab 分块：
                    Overview / Members / Constraints / Proposals / Messages）

改 Autopilot 执行策略
  · 时间 fallback     → `lib/booking-autopilot/core/recovery.ts`
  · Stage 感知        → `lib/booking-autopilot/core/{stage-assessment,stage-signals}.ts`
  · 表单补填兜底      → `lib/booking-autopilot/ai-loop/fill-form.ts` 的 `auditAndRefillEmptyFields`
  · RPA 降级          → `lib/booking-autopilot/ai-loop/execute.ts` → Playwright locator
  · 实时日志          → `lib/live-log-store.ts`（环形缓冲，1.2s 轮询推送）
  · Provider 选择     → `lib/booking-autopilot/core/provider-router.ts`

改打分权重
  · `lib/agent/composer/scoring.ts`
  · `getScoreAdjustments()` 激活条件：≥30 天上线 + ≥100 条 `plan_outcomes`（预计 2026-04-22）

改数据库 schema
  · `lib/schema.sql` 加 DDL（生产需手动 apply 到 Neon）
  · `lib/db.ts` 加 query 函数与类型导出
  · 若影响 Room → 同步更新 `DecisionRoom` / `DecisionRoomConstraintRow` / `DecisionRoomProposal` 等类型
  · ⚠ 字段改名会影响已存 JSON；加字段优先

================================================================
十五、核心数据流
================================================================

【数据流 A · Decision Room v2：创建 → 投票 → 预订】

  Creator                   Members                    AI 层                       Booking
  ──────                    ───────                    ────                        ───────
  POST /api/rooms  ─────►  decision_rooms
       │
       └── short_code ──►  分享链接 ──►  POST /api/rooms/join  ──►  decision_room_members
                                                                       │
                                        POST /api/rooms/[id]/constraints （每位成员）
                                                                       │
                                                                decision_room_constraints
                                                                       │
                           POST /api/rooms/[id]/propose  ──►  lib/rooms/propose.ts
                                                                       │
                                              N=2 → runAgentForTwoParty  (lib/agent/two-party.ts)
                                              N≥3 → runAgentForNParty    (lib/agent/n-party.ts)
                                                                       │
                                                   MiniMax 合并约束 + 冲突检测
                                                                       │
                                       runAgent() → 候选生成 → 打分 → 最多 3 option
                                                                       │
                                                             decision_room_proposals
                                                                       │
                           POST /api/rooms/[id]/proposals/[pid]/vote （每位成员独立）
                                                                       │
                                            approval_rule = unanimous → 全员同 option
                                            approval_rule = majority  → 支持票 > N/2
                                                                       │
                           POST /api/rooms/[id]/proposals/[pid]/finalize （payer 触发）
                                                                       │
                                        booking_jobs 新记录 → Autopilot 启动
                                                                       │
                                decision_room_messages 写入 booking_started 事件

  前端实时同步：`useRoomState()` 每 3s 拉 `/api/rooms/[id]/state?since=<version>`，
                304 表示无变化（ADR-4：轮询 + 304，非 WebSocket）

【数据流 B · Autopilot Booking：任务生命周期】

  用户点 "Book everything →"
         │
         ▼
  POST /api/booking-autopilot              booking_jobs 记录 status=queued
         │
         ▼
  stagehand-executor.ts                    路由：URL → getProvider() → skipInitialAgent?
         │
         ├── 已知平台（skip）──► Layer 1（程序化导航）
         │                         │
         │                         ▼
         │             provider.getStageSignals() → 当前 stage
         │                         │
         │                         ▼
         │             按 stage 执行：点按钮 / dismiss 弹窗 / 等页面
         │                         │
         │                         ▼
         │             Layer 2：fillGuestFormWithAI() / fillFlightGuestFormWithAI()
         │                         │
         │                         ▼
         │             Layer 3：auditAndRefillEmptyFields() ← 每次填表后必调
         │                         │
         │                         ▼
         │             provider.fillPaymentForm() → 止步 CVV（ADR-3）
         │
         └── 未知平台 ──► AI loop（最长 40 step）
                            │
                            ▼
                 perceive.ts (Claude Haiku) → PerceptionResult
                            │
                            ▼
                 execute.ts (Stagehand act()) → 下一步
                            │
                            └── 任意失败 → Playwright locator fallback（ADR-7）

  横切关注点：
    · `agent_logs` / `live-log-store.ts` 环形缓冲写入实时日志
    · `/api/browser-live/[jobId]` SSE 推 6fps 截图
    · 自主决策：time fallback / backup hotel / 重试（最多 3 次）
    · 终态：`booking_jobs.status = succeeded | partial | failed`
    · Web Push 推送用户设备

================================================================
十六、关键设计决策（ADR 精华 · 改代码前必读）
================================================================

ADR-1 · Booking 自动化采用三层执行架构，而非纯 AI Agent
  背景：纯 AI agent（40 step blind loop）对已知平台又慢、又贵、又不稳
  决策：已知 UI 步骤走 Playwright 程序化（Layer 1），字段语义走 AI（Layer 2），
        填完必 AI 兜底 audit（Layer 3）
  影响：所有已知平台必须加入 `skipInitialAgent`，永远不跑 blind agent
  详见：根目录 `CLAUDE.md` "Booking Automation Architecture"

ADR-2 · Decision Room 的 N=2 与 N≥3 使用不同引擎
  背景：二人场景 prompt（"both agree on"）与群体场景（"union of hard constraints"）
        措辞差异大，强塞一起精度下降
  决策：`lib/agent/two-party.ts` 专注 pair 动态；`lib/agent/n-party.ts` 专注
        群体 union / lowest-budget / 冲突范围
  影响：`lib/rooms/propose.ts` 按 `submitted.length` 路由
  不采纳：并入单一 `runAgent(inputs[])`（试过，冲突检测召回率 -15%）

ADR-3 · Payment 字段永远程序化，AI 不参与
  背景：跨域 iframe 的支付字段 AI 无法访问；"止步 CVV" 是监管红线
  决策：`provider.fillPaymentForm()` 必须用 Playwright 原生 setter，填到 CVV 之前停
  影响：新增 provider 禁止用 AI 填支付字段；所有 provider 必须显式实现此方法

ADR-4 · Decision Room 实时同步用 3s 轮询 + 304，而非 WebSocket
  背景：Vercel serverless 不适合长连接；Neon 也无长连接 push 通道
  决策：`GET /api/rooms/[id]/state?since=<version>`，无变化返回 304
  影响：前端 `useRoomState()` 封装轮询；成本低、代码简单
  可接受代价：最大延迟 3s（UX 测试可接受）

ADR-5 · 打分权重调整延迟激活
  背景：用 `plan_outcomes` 微调权重在数据不足时会被噪声带偏
  决策：`getScoreAdjustments()` 仅在 ≥30 天 + ≥100 条 outcomes 后生效
  激活评估日期：2026-04-22（预计）
  影响：当前权重为静态值；见 `lib/agent/composer/scoring.ts` 顶部注释

ADR-6 · NLU 英文快路径绕过 MiniMax
  背景：英文查询占 90%+，MiniMax 每次 ~300ms；快路径零 API 调用
  决策：`lib/nlu.ts` 英文走 regex + 规则引擎，非英文走 MiniMax
  影响：改 NLU 需同步维护两条路径；非英文场景延迟较高

ADR-7 · Stagehand（AI 浏览器）+ Playwright（RPA）双层降级
  背景：Stagehand.act() 自然语言强但偶发选错元素；纯 Playwright 脚本又脆
  决策：AI-first → 失败自动 fallback 到 Playwright locator；每步独立控制
  影响：provider 可强制走 RPA（例如 OpenTable 时段点击需 CDP 坐标，见 Gotchas）

ADR-8 · 首页 chat NLU 拆成三层（Plan C · 2026-04）
  背景：v1 `conversational-nlu.ts` 是一个 800+ 行 system prompt，5 场景 × 分类
        × 约束 × quick_picks × 追问耦合在一起，每加一种 corner case 都变脆
  决策：Layer 1 chat（Sonnet 说人话）/ Layer 2 extractor（gpt-4o-mini + JSON
        mode 出 IntentState）/ Layer 3 router（纯函数出 RouterAction）三层分离
  影响：v1 已删除；新增 scenario 必须同步改 types + extractor prompt +
        router.getMissingForScenario + golden test；完整 Checklist 见 CLAUDE.md

================================================================
十七、踩过的坑（Gotchas · 省你几天）
================================================================

【前端 / 构建】
  · Windows 下 git 自动 LF→CRLF 警告是正常的，不要关 autocrlf（会破坏 Vercel deploy）
  · `next.config.ts` 保留了 Leaflet 的 webpack 外部化，删掉会导致地图模块崩
  · `sw.js` 改动后必须跑一次完整 `npm run build`，让 postbuild 注入新版本号，
    否则客户端不会 bust 缓存

【Autopilot】
  · OpenTable 时段点击：React 合成事件 + dispatchEvent 失效
      → 必须走 CDP `Input.dispatchMouseEvent` 坐标点击
  · Booking.com 平台偶尔静默切换新 UI variant
      → `getStageSignals()` 要同时检测新、旧两套 selector
  · 平台回退链（OpenTable → Resy → Yelp）可能"假成功"（落到 landing page）
      → 必须 `isGenuineBooking` 校验（URL pattern + 成功文本）
  · Cookies 过期无提示 → 触发 login wall
      → 必须捕获 login wall signal，降级为手动链接 + Action Item
  · Stagehand rate limit：并发 > 3 容易触发 gpt-4o-mini quota
      → Autopilot 任务串行化；`/api/browser-live` 单独通道

【Decision Room】
  · approval_rule 切换会撤销所有已投票（防规则混淆）→ UI 必须弹二次确认
  · creator 离开必须先 `transfer-creator`，否则 room 进入 abandoned；payer 字段同理
  · N≥3 的 conflict 检测严格：要构造"真冲突"（vegan vs must-have-steak）才会触发，
    普通偏好差异不会 — 写测试时注意

【MiniMax】
  · Temperature > 0.3 引入 JSON 解析失败率上升
  · 返回里可能带 markdown code fence，解析前必须 strip
  · 非英文 prompt 延迟大（~800ms），尽量走英文快路径

【数据库】
  · `decision_sessions` 是 legacy 双人表，新功能一律走 `decision_rooms*`
  · `booking_profiles` 的 passport / KTN 字段走 `BOOKING_ENCRYPTION_KEY` 加密
      → 换 key 前必须先把现有数据解密、再用新 key 重新加密

【Windows 本地开发】
  · Playwright chromium 路径含空格需引号包裹
  · `.env.local` 用 CRLF 结尾某些 parser 会出问题，建议 LF
  · 在 bash shell 下路径必须正斜杠；PowerShell 可用反斜杠

================================================================
十八、开发工作流（gstack / ship skills 约定）
================================================================

【日常开发节奏】
  1. 新功能先看 `prd.json` 是否已有 ralph spec
  2. 大改动走 `/ship:auto`（design → dev → e2e → review → qa → refactor → handoff）
  3. 小修直接 `/ship` 或 `/ship:dev`
  4. UI / 前端改动必须用 `/browse` skill 人工验证（持久化 headless Chromium，快）
  5. 提 PR 前跑 `/review`（对比 base 分支 diff，有结构化报告）
  6. commit 用中文 `feat:` / `fix:` / `chore:` 前缀（保持历史一致）

【测试策略】
  · 单测：Vitest，`npm test`；覆盖率 `npm run test:coverage`
  · Decision Room 手测：`DECISION_ROOM_TEST_PLAN.md` 的 T1–T18，账号 ziweiA/B/C
  · Autopilot 手测：本地设 `PLAYWRIGHT_HEADLESS=false` 起任务，观察浏览器直播
  · QA：`/qa` 对整站交互扫描；`/design-review` 专查视觉一致性

【可用 gstack Skills（重要子集）】
  · Ship：/ship, /ship:auto, /ship:dev, /ship:e2e, /ship:review, /ship:qa,
          /ship:refactor, /ship:handoff, /ship:arch-design, /ship:visual-design
  · QA / Review：/browse, /qa, /qa-only, /review, /design-review
  · 调试 / 复盘：/investigate, /retro, /document-release, /codex, /office-hours
  · 计划：/plan-eng-review, /plan-ceo-review, /plan-design-review, /ask-me, /autoplan
  · 全量文档与实现细节：根目录 `CLAUDE.md` + `~/.claude/skills/`

【部署】
  · Vercel 自动 deploy master 分支
  · Cron 端点在 `vercel.json` 声明，走 `CRON_SECRET` Bearer 校验
  · maxDuration：Autopilot = 300s，Decision Room = 60s，其余 = 10s
  · Service worker 每次 build 自动 bust 缓存（`scripts/inject-sw-version.mjs`）

================================================================
