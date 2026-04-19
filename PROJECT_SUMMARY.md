================================================================
Onegent · AI 决策代理 · 项目总结 · v0.2.29.0
================================================================

【项目定义】
不是"让用户自己搜、比、选"的传统 App，也不是"联网搜一搜再总结"的通用 AI。
而是：把"搜索 → 比较 → 筛选 → 排序 → 推荐 → 执行 → 反馈 → 学习"
整条链路交给 agent 自动完成，用户只做最终批准。

核心标签：决策平台 · 场景编排 · 自主执行 · 个性化记忆 · 持续学习 · 双人协作决策

产品地址：https://onegent.one/

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

【核心能力速览】
三条主线，贯穿第四 / 第五阶段的完成态能力：
  · 个人决策：6 层 Agent 管道（NLU → Plan → Tool → Retrieve → Rank → Explain），
    8 场景规划器 × 8 品类 pipeline，支持模块级精炼（G-3）与单约束精炼（S-5）
  · 群体决策：Decision Room v2 — 多人结构化约束、AI 合并 + 冲突检测、
    unanimous / majority 投票、payer 一键 booking 闭环
  · Autopilot 执行：Stagehand（AI 层）+ Claude Haiku（感知层）+ Playwright（RPA 兜底），
    六个 Provider（Booking.com / Expedia / Hotels.com / OpenTable / Resy / Yelp）+ Expedia 机票 RPA

【本文档阅读导航】
  · 新工程师上手 → 直接翻 十二（启动）→ 十三（目录）→ 十四（改动入口）→ 十七（坑）
  · 产品 / 投资人视角 → 一 ~ 六（架构与阶段演进）、十（支持场景）、十一（用户旅程）
  · 架构师 / 重构前必读 → 十五（数据流）、十六（关键设计决策 ADR）
  · 改 Booking 自动化 → 本文 十四 + 根目录 `CLAUDE.md` 的 "Booking Automation Architecture" 章节

================================================================
一、核心架构 · 6 层 Agent 设计（已全部实现）
================================================================

第 1 层 · 需求理解层
  自然语言 → 结构化意图。解析预算、场景、偏好、限制条件。
  实现：lib/nlu.ts — 英文快速路径（~300ms 节省），非英文走 MiniMax。
  升级：注入用户历史偏好（噪音/价格/距离敏感度），下一轮查询自动带约束。
  升级 2：session preference extraction（3.3a）— 每次餐厅查询后 AI 提取
  偏好信号并累积在 session 内，注入后续 rankAndExplain prompt。
  升级 3：单约束精炼（S-5）— "便宜一点" / "安静一点" / "近一点" 识别为
  refinement intent，上下文感知重跑，不重置整个规划。

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
测试：Vitest（22+ 个测试文件 · 100% 通过）
版本：v0.2.29.0

================================================================
八、数据库（29 张表）
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

================================================================
九、版本历史摘要
================================================================

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
│   ├── planners/                      场景规划器（date-night / weekend-trip / city-trip /
│   │                                  big-purchase / concert-event / fitness / gift）
│   ├── pipelines/                     品类 pipeline（restaurant / hotel / flight /
│   │                                  laptop / smartphone / headphone / credit-card）
│   ├── planner-engine/                modular planner 引擎（EngineConfig 驱动）
│   ├── parse/                         每场景 NLU 解析器
│   ├── composer/scoring.ts            综合打分（产品灵魂，5 维度 + 惩罚）
│   ├── two-party.ts                   N=2 Decision Room 引擎
│   ├── n-party.ts                     N≥3 Decision Room 引擎
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
├── nlu.ts                             NLU 入口（英文快路径 + MiniMax 慢路径）
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
