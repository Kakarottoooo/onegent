================================================================
Onegent · AI 决策代理 · 项目总结 · v0.2.26.0
================================================================

【项目定义】
不是"让用户自己搜、比、选"的传统 App，也不是"联网搜一搜再总结"的通用 AI。
而是：把"搜索 → 比较 → 筛选 → 排序 → 推荐 → 执行 → 反馈 → 学习"
整条链路交给 agent 自动完成，用户只做最终批准。

核心标签：决策平台 · 场景编排 · 自主执行 · 个性化记忆 · 持续学习 · 双人协作决策

产品地址：https://onegent.one/

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
  升级 2：Decision Room（Phase 4）— 两人共同做决策，各自提交约束，
  AI 合并后投票，全程实时同步，支持冲突检测。
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

【第四阶段 · 完成】双人协作决策 — Decision Room

  核心转变：从"一个人做决策" → "两个人一起做决策"

  Decision Room ✅（Phase 4）
    流程：
      1. A 创建 Decision Room，获得分享链接
      2. 发给 B（iMessage / WhatsApp / 复制链接）
      3. B 加入后自动跳转投票页（4s 轮询）
      4. AI 合并双方约束（MiniMax）→ 冲突检测
      5. 展示最多 3 张候选卡，双方独立投票
      6. 双方同时点 ✓ 的第一张卡 = 最终决定
      7. 事后反馈（Loved it / Fine / Never again）
    实现要点：
      · 服务端角色推断：Clerk userId > HttpOnly Cookie > 默认 partner
      · 投票写入后重新拉取，避免脏读竞态（re-fetch after write）
      · 55s 双重超时保护（Promise.race + maxDuration = 60）
      · 会话 24h 过期，设计用于"当晚就决定"场景
      · 单次 DB 批量 UPDATE 替代原始 N+1 串行写入

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
存储：Neon PostgreSQL（12 张表）· localStorage（收藏夹 + 偏好缓存）
认证：Clerk（内部分析仪表板 + 跨设备偏好同步 + Decision Room 身份锚定）
推送：Web Push（VAPID）· PWA Service Worker
基础设施：Vercel（maxDuration=300 for autopilot，maxDuration=60 for Decision Room）
         PWA（离线支持）
API 层：30+ 个路由端点
Cron：4 个定时任务（反馈提示 / 价格检查 / 场馆质量 / 笔记本价格）
测试：Vitest（22+ 个测试文件 · 100% 通过）
版本：v0.2.26.0

================================================================
八、数据库（12 张表）
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
| booking_jobs | Autopilot 任务队列（状态/步骤/决策日志） |
| agent_feedback | Agent 反馈事件（接受/覆盖/满意度） |

================================================================
九、版本历史摘要
================================================================

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
