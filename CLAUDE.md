
## gstack

Use /browse from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.

Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /retro, /investigate, /document-release, /codex, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade

If gstack skills aren't working, run: cd .claude/skills/gstack && ./setup

## Language

Always respond in Chinese. Never respond in Korean.

---

## Booking-autopilot 架构 — worker 是唯一执行路径（B+B2，2026-05-01）

**单一执行源**：`worker/src/booking-autopilot/`。所有 booking job（restaurant /
hotel / flight / activity）都通过 Railway/local worker 跑。lib/booking-autopilot
是 deprecated dead code，运行时不会被调用。

**路由**：`/api/booking-jobs/[id]/start` 检测 step 类型 → 自动 stamp
`__source = "lib/core/execution"` marker → 留 status=pending → 返回 202。
worker poll Neon `booking_jobs.status='pending' AND steps->0->'body'->>'__source'='lib/core/execution'`，
通过 FOR UPDATE SKIP LOCKED 抢占，然后跑 stagehand。USE_WORKER_FOR 只是
operator override（缩小 scenario 范围用于灰度）。

### 改动规矩（B+B2 之后）

| 改动类型 | 改哪边 |
|---|---|
| 新增 provider / 新功能 / bug fix（任何 scenario） | **只改 `worker/src/booking-autopilot/`** |
| `lib/booking-autopilot/` | **不要再动**。它是 deprecated；运行时不会被调用 |
| `lib/db.ts` / schema 变化 | **两边都改**（同一个 Neon DB） |
| `lib/core/cend-adapter.ts` / `lib/core/execution/types.ts` | 两边都改（worker/src/core 是 fork；这俩文件 vercel 端也用来 mark step） |
| `lib/encryption.ts` / `lib/autonomy.ts` / `lib/agent/planners/booking-links.ts` | **两边都改**（worker/src 有 fork） |
| NLU / chat / UI / API routes | 只在 root（这些**不在** worker 里） |

### dev workflow

dev 必须**同时**起两个进程：
```bash
# 终端 1：Next.js dev
cd /c/Users/Gzw19/onegent && npm run dev > ./dev.log 2>&1

# 终端 2：worker (tsx watch，改 worker/src/* 自动 reload)
cd /c/Users/Gzw19/onegent/worker && npm run dev > ../worker.log 2>&1
```

两个进程都连同一个 Neon DB；POSTGRES_URL 从 `.env.local` 读。

prod：worker **还没部署到 Railway**（之前 memory 里写的"Sprint 1 #1 shipped"是
false memory，Railway 上只有 `@onegent/mcp-server`）。prod booking 目前是死的，
反正没付费用户。需要时把 worker 部署到 Railway 即可。

### lib/booking-autopilot/ 物理删除（DEFERRED）

物理删除涉及 ~1000 行 in-process fallback path 在
`app/api/booking-jobs/[id]/start/route.ts` + `lib/core/execution/{executor,recovery,recovery-providers}.ts`
+ `lib/booking-autopilot/` 本身。当前 deprecation header 已经标了，dead code 不
影响 runtime。下次集中清理时做：
- 删 `lib/booking-autopilot/` 整个目录
- 删 `app/api/booking-jobs/[id]/start/route.ts` 的 `runStepWithRecovery` /
  `runUniversalStep` / `runUniversalStepViaCore` in-process 段（保留 worker
  dispatch gate + 202 enqueue）
- 删 `lib/core/execution/{executor,recovery,recovery-providers}.ts`（worker 有 fork）
- `BookingProfile` type 从 `lib/booking-autopilot/types.ts` 移到 `lib/core/booking-types.ts`
- 删 `vercel.json` 的 retry-jobs cron 条目 + `app/api/cron/retry-jobs/route.ts`
- typecheck + smoke test 一遍才能 ship

---

## Dev Server 重启提示规则

每次改完代码后，必须主动判断改动是否需要用户重启 `npm run dev`。**只要需要重启，就必须在回复里明确告诉用户"此改动需要重启 dev server"并说明原因**，不要让用户自己猜。

### 需要重启的改动（必须提示）
- `next.config.ts` / `next.config.js`
- `package.json`（新增/升级/移除依赖）
- `.env` / `.env.local` / `.env.*`（环境变量）
- `middleware.ts`（有时需要）
- `tsconfig.json` 的 `paths` / `baseUrl` / `compilerOptions`
- `tailwind.config.*` / `postcss.config.*`
- `instrumentation.ts`
- 任何 Next.js build-time 配置文件
- 模块级 registry 注册 / singleton 初始化（HMR 不会重跑 module-level 副作用）

### 不需要重启的改动（不用提示）
- React 组件（`components/**`、`app/**/*.tsx`）
- 普通 TS 模块（`lib/**/*.ts`）
- API routes（`app/api/**/route.ts`）
- CSS / Tailwind class 改动
- 图片、静态资源

### 回复格式示例

改了需要重启的文件时，在总结段里加一行：

> ⚠️ **需要重启 dev server**：改动了 `next.config.ts`，请 Ctrl+C 停掉 `npm run dev` 再重新跑。

如果同时还改了不需要重启的文件，只提需要重启的那几个即可。

---

## Booking Automation Architecture — 必须遵守的设计原则

每次新增预订平台、修改现有 provider、或实现任何自动化填表功能时，必须遵循以下模式。**不允许绕过此规范。**

### 核心模式：程序化导航 + AI 感知，分工明确

```
❌ 错误：用一个 40-step AI agent 包办所有事情
✅ 正确：程序化处理已知 UI 步骤 + AI 只在"需要理解页面"时介入
```

### 标准三层执行架构

```
Layer 1 — 程序化导航（不消耗 AI 额度，速度快，稳定）
  └─ 跳过 40-step agent（加入 skipInitialAgent 列表）
  └─ 用 Playwright page.evaluate() / waitForFunction() 处理：
       - 已知的按钮点击序列（Select fare → No thanks → Skip to Checkout）
       - 已知的弹窗 dismiss
       - 已知的页面跳转等待
       - 已知的 URL 变化检测

Layer 2 — AI 表单填充（仅在需要理解字段含义时使用）
  └─ fillGuestFormWithAI(stagehand, effectiveProfile, trace)
       - 餐厅：name / email / phone
       - 酒店：name / email / phone / address
       - 机票：name / email / phone / DOB / passport / KTN
  └─ fillFlightGuestFormWithAI(stagehand, effectiveProfile, trace) 仅用于机票

Layer 3 — AI 验证（每次填表后必须调用）
  └─ auditAndRefillEmptyFields(stagehand, rawPage, effectiveProfile, trace)
       - 扫描所有可见 input 字段
       - 对仍为空的字段自动 AI 补填
       - 保证零遗漏
```

### 当前各平台实现状态（新增平台必须对齐）

| 平台 | 跳过 Agent | Layer 1 程序化 | Layer 2 AI 填表 | Layer 3 AI 验证 |
|------|-----------|--------------|----------------|----------------|
| Booking.com 酒店 | ✅ | ✅ | ✅ fillGuestFormWithAI | ✅ auditAndRefill |
| Expedia 酒店 | ✅ | ✅ clickTargetListingAI | ✅ fillExpediaGuestForm | ✅ auditAndRefill |
| Hotels.com | ✅ | ✅ Stage B sidebar | ✅ 复用 Expedia | ✅ auditAndRefill |
| OpenTable 餐厅 | ✅ | ✅ 原生 setter 主填 | ✅ AI 补漏 | ✅ auditAndRefill |
| Resy 餐厅 | ✅ | ✅ 原生 setter 主填 | ✅ AI 补漏 | ✅ auditAndRefill |
| Expedia 机票 | ✅ | ✅ bookExpediaFlightProgrammatic | ✅ fillFlightGuestFormWithAI | ✅ auditAndRefill |

### 新增平台时的 Checklist

1. **新建 `lib/booking-autopilot/providers/<name>.ts`**
   - 实现 `BrowserProvider` 接口
   - `setup()` — 注入 cookies、禁用干扰元素
   - `getStageSignals()` — 程序化检测当前阶段（search / detail / form / payment）
   - `fillGuestForm()` — 程序化主填充（原生 setter），然后从 helpers 提取 stagehand 调 AI 补漏 + audit
   - `fillPaymentForm()` — 程序化填支付字段（止步 CVV）
   - `registerProvider(xxxProvider)` — 注册到全局注册表

2. **在 `stagehand-executor.ts` 中**
   - 加入 `xxxPageOpen` 检测（类似 `bookingComPageOpen`、`expediaFlightPageOpen`）
   - 加入 `skipInitialAgent` 列表，**永远不允许对已知平台运行 40-step 盲目 agent**
   - 加入 `skipProviderLabel` 映射
   - 如有特殊流程（如机票 RPA），在 early return block 中实现

3. **在 `lib/booking-autopilot/ai-loop/fill-form.ts` 中**
   - 如需新字段类型（如机票旅行证件），新增对应 `build*Fields()` 函数和 `fill*FormWithAI()` 导出

4. **`PROFILE_PATTERNS` 数组**（`fill-form.ts`）必须包含新字段的匹配规则，确保 `auditAndRefillEmptyFields` 能识别并补填

### 关键文件位置

```
lib/booking-autopilot/
  stagehand-executor.ts     — 主执行器，skipInitialAgent + early return 逻辑
  providers/
    expedia.ts              — Expedia 酒店 + 机票 RPA + 支付表单
    booking-com.ts          — Booking.com 酒店
    opentable-com.ts        — OpenTable 餐厅
    resy-com.ts             — Resy 餐厅
    hotels-com.ts           — Hotels.com（复用 Expedia）
    registry.ts             — Provider 注册表（getProvider(url) 入口）
    types.ts                — BrowserProvider 接口定义
  ai-loop/
    fill-form.ts            — fillGuestFormWithAI / fillFlightGuestFormWithAI / auditAndRefillEmptyFields
    find-listing.ts         — clickTargetListingAI / selectRoomAI
  core/
    profile.ts              — buildEffectiveProfile（把 raw profile 转换为填表用 EffectiveProfile）
    stage-assessment.ts     — assessBookingStage（AI 感知当前页面阶段）
```

### 设计原则总结

- **程序化导航 = 已知 UI 流程**（点哪个按钮、等什么文本出现、dismiss 什么弹窗）
- **AI = 理解页面内容**（哪个字段是 First Name、哪个空着、哪个填错了）
- **永远不用 40-step blind agent** 来做已知平台的自动化
- **payment 字段永远程序化**（跨域 iframe，AI 无法访问；且止步 CVV 规则必须确定性执行）
- **每次填表后必须调 `auditAndRefillEmptyFields`**，保证零遗漏

---

## Conversational NLU Architecture — 首页 chat 的三层架构

Homepage `/` 和 Decision Room 私聊复用同一套 NLU v2 管道。**新增场景 / 加约束字段 / 调 router 行为时必须遵守这个分层，不允许把逻辑回流到单一 prompt。**

### 核心模式：对话 + 提取 + 路由 三职责分离

```
❌ 错误：一个 800 行的 system prompt 同时管分类、约束、quick_picks、追问
✅ 正确：chat 说人话 / extractor 出 JSON / router 决定下一步
```

### 标准三层

```
Layer 1 — Chat（Claude Sonnet 4.6）
  └─ lib/agent/nlu-v2/chat.ts · chatTurn()
       输入：history + new_user_message + state_summary + router_action
       输出：纯文本 assistant_reply（只负责"说人话"）

Layer 2 — Extractor（gpt-4o-mini + JSON mode）
  └─ lib/agent/nlu-v2/extractor.ts · extractState()
       输入：prev_state + new_user_message + history
       输出：完整 IntentState（schema 校验过的结构化记忆）
       每轮对话跑一次，merge 进旧 state

Layer 3 — Router（纯函数，不是 LLM）
  └─ lib/agent/nlu-v2/router.ts · routeIntent(state)
       输入：IntentState
       输出：RouterAction
         · continue_chat — 闲聊或还在信息收集早期
         · ask_clarification { missing, suggested_quick_picks }
         · show_confirm_card { kind: "plan" | "room" | "trip" }
       纯函数 → 可单测 → 行为确定性
```

### 新增场景 / 约束字段时的 Checklist

1. **`lib/agent/nlu-v2/types.ts`** — 在 `IntentState` 上加对应 scenario 的 `XxxFields` 接口；如是 room 场景的 per-member 约束加到 `ProxyConstraints`
2. **`lib/agent/nlu-v2/extractor.ts`** — 在 system prompt 的 "WORKED EXAMPLES" 里加 1-2 条该场景/字段的示例（必须含中文 + 英文输入）
3. **`lib/agent/nlu-v2/router.ts`** — 在 `getMissingForScenario()` 里声明 REQUIRED keys；scenario 转 kind 的 mapping 加对应分支
4. **`lib/agent/nlu-v2/index.ts · flattenScenarioFields()`** — 如果字段名跟 `/api/chat/commit` 老的 key 不对齐，在这里做 rename（如 `star_rating → stars`）
5. **golden test** — 在 `lib/agent/nlu-v2/__tests__/golden-*.test.ts` 补一个覆盖该字段的 case

### 关键文件位置

```
lib/agent/nlu-v2/
  types.ts              — IntentState / RouterAction / 各场景 XxxFields
  extractor.ts          — Layer 2，system prompt + JSON mode
  router.ts             — Layer 3，纯函数 + routeIntent + getMissingForScenario
  chat.ts               — Layer 1，自然语言 reply
  index.ts              — 编排器 analyzeConversationalV2() + v1-compat shape
  __tests__/            — golden-solo / golden-multi / golden-trip 等

app/api/chat/parse/route.ts     — 唯一入口，调用 analyzeConversationalV2
app/api/chat/commit/route.ts    — 消费 NluV2ParseResult，commit 到 DB
lib/quick-picks-fallback.ts     — 客户端兜底 quick_picks（LLM 偶尔忘）
```

### 设计原则总结

- **chat / extractor / router 三职责严格分离**，不允许 router 里调 LLM，也不允许 extractor 出自然语言
- **Extractor 每轮都要产出完整 IntentState**（不是 delta）— 新老 state merge 在 extractor 内部完成
- **Router 是纯函数** — 任何"看 state 决定 UI"的逻辑都放这里，不放进 extractor prompt
- **v1 `conversational-nlu.ts` 已删除**，`ConversationalNLUResult` 现在只是 `NluV2ParseResult` 的别名
- **新增 scenario 必须补 golden test**，否则不算完工

