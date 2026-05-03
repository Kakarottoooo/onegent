
## gstack

Use /browse from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.

Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /retro, /investigate, /document-release, /codex, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade

If gstack skills aren't working, run: cd .claude/skills/gstack && ./setup

## Language

Always respond in Chinese. Never respond in Korean.

---

## 协作协议 — codex (Track A) ↔ Claude (Track B)

两个 agent 并行开发时，用户曾经手动在两边复制粘贴状态——容易丢信息、产生
代差、导致冲突。**改用 git 仓库里两个状态文件做单向消息总线**，零新基础设施。

### 文件位置

```
.coordination/
  codex.md      ← codex 写（在 master 分支）
  claude.md     ← Claude 写（在 claude/festive-pare-f27273 分支或后续替换分支）
```

每一边只写自己那个文件，只读对方那个。永远不会冲突。

### Session start ritual（强制；每次开新对话都跑）

```bash
git fetch origin
echo "═══ codex 当前状态 (origin/master) ═══"
git show origin/master:.coordination/codex.md 2>/dev/null || echo "(codex.md 还不存在)"
echo
echo "═══ Claude 当前状态 (本分支) ═══"
cat .coordination/claude.md 2>/dev/null || echo "(claude.md 还不存在)"
```

读到的内容是判断"对方现在在干嘛 / 给我交付了什么 / 我有没有 unblock 他"
的唯一可靠依据。**不要凭记忆判断**——上一轮 session 的状态可能已经过时。

### 何时更新自己的 `.coordination/claude.md`

必须更新的时机（任一即触发）：
1. **开始一个新任务**——把 "Currently doing" 改成新任务标题
2. **完成一个任务**——把对应行从 "Currently doing" 移到 "Recently shipped"
3. **发现一个 blocker**——加到 "Blocking on codex"
4. **解锁了对方**——记入 "Recently shipped" 并在 commit 用 `[handoff]` tag
5. **收到对方的产出**——更新 "Blocking on codex" 把已解的项删掉

更新即 commit。每次 push 代码时把 `.coordination/claude.md` 一起带上。
**不要单独 push 状态文件**——和当时的代码改动绑在同一个 commit。

### 必须保留的章节（schema 契约）

`.coordination/claude.md` 必须有这 5 个 section（H2）。codex.md 镜像。

```
🟢 Currently doing             # 当前任务一句话；空闲时写 "Idle"
⏳ Blocking on codex           # 我在等对方什么；空时写 "(none)"
📦 Recently shipped            # 最近 5-10 个 commit 表，含给对方的备注
🤝 Open questions for codex    # 给对方的问题；空时写 "(none)"
🚧 Hold rules I'm respecting   # 当前我承诺不碰的范围
🗂 Track B file ownership      # 我的文件域（变化时更新）
```

顶部必须有 metadata 行：
```
> Branch: <branch-name>
> Last updated: YYYY-MM-DD HH:MM UTC
> Last commit: <short-sha>
```

### Commit message tag 约定（C — 强信号补充）

写 git log 时给跨边相关的 commit 加 prefix tag，让 `git log --oneline -20`
扫一眼就能看到 handoff / blocker 信号：

| Tag | 含义 |
|---|---|
| `[handoff]` | 这个 commit 完成了对方在等的事——交付方应该立即更新自己的 `.coordination/*.md` 把对应项移出 Blocking 并写到 Recently shipped 的"Notes for codex/claude"列 |
| `[blocked]` | 这个 commit 创造了一个我等对方的 blocker——要同时更新 `.coordination/claude.md` 的 Blocking on codex 列 |
| `[unblocked]` | 对方刚 push 的东西解了我的某个 blocker，本 commit 是对应的消费/接入 |
| `[shared]` | 改了 shared file（lib/db.ts, schema, 协议 doc 等）——对方需要看一眼 |
| `[coord]` | 纯协调——只更新 .coordination/*.md，没有代码 |

不强制——零 tag 也行；加上等于额外加固。多数 commit 不需要 tag。

### Conflict resolution

理论上不会冲突（两个文件，两个分支）。如果出现：
- 自己的 .coordination/claude.md 跟 master 上的 codex.md 不矛盾——它们各自独立，无 merge 概念
- 我 merge master 时，只会接收对方的 codex.md（它在 master 上），不会动我的 claude.md（它只在我分支上）

如果未来切分支（比如 Phase 1 完成后开新 feature branch），把 `.coordination/claude.md`
跟新分支一起带过去；codex 那边知道分支名变了即可（在 codex.md 顶部 metadata 写
"Claude branch: <new-branch-name>"，对方会看到）。

### 失败模式

- **codex 不更新**：我 fetch 后看 codex.md 时间戳老于 24h → 在回复里
  flag 给用户，问 codex session 是否活着，不强行假设
- **我自己忘记更新**：用户读 `.coordination/claude.md` 看到时间戳 / 状态过时
  → 用户提醒；视作 bug 修复
- **两边状态对不上**：以 git log 实际 commit 为准（事实），状态文件是
  解读层（注释）

---

## Booking-autopilot 架构 — 双份代码并存（B+B2，2026-05-01；修正 2026-05-01 PM）

**事实校正（2026-05-01 audit）：之前说 lib/booking-autopilot 是 "deprecated dead code"
是错的。** lib/booking-autopilot 仍被以下文件 import：
- `app/api/booking-jobs/[id]/start/route.ts:58` —— `runBrowserTask`（M5 force-gate
  之外的 fallback in-process path 还会调）
- `lib/core/execution/executor.ts:19` —— `runBrowserTask` + 多个 task-builders
  + `BrowserTaskInput` / `BookingProfile` 类型

所以 lib/booking-autopilot **目前不是 dead code，物理删除会编译失败**。

**主执行路径**：worker/src/booking-autopilot/（Railway/local worker 跑）。
M5 force-gate 让 `/api/booking-jobs/[id]/start` 把 restaurant/hotel/flight/activity
都路由到 worker（自动 stamp `__source = "lib/core/execution"` marker → 202 返回）。
worker poll Neon + FOR UPDATE SKIP LOCKED 抢占。USE_WORKER_FOR 是 operator
override（缩小 scenario 范围用于灰度）。

**Fallback 路径**：lib/booking-autopilot/ 仍是 Vercel in-process executor 的
执行体（lib/core/execution/executor.ts → runBrowserTask）。这条路径仅在
M5 gate 路由失败 / 非 worker scenario 时触发。

### 改动规矩（双份共存期间）

| 改动类型 | 改哪边 |
|---|---|
| 新增 provider / 新功能 / bug fix（实际 prod scenario） | **优先 `worker/src/booking-autopilot/`**；如果 lib/core/execution 也走这个 provider，**两边都改** |
| 已有 provider 的 fallback / scoring / error 逻辑 | **两边都改**（lib 和 worker 必须功能对齐 —— 漂移=哪边跑出来不一样） |
| `lib/db.ts` / schema | **两边都改**（同一个 Neon DB） |
| `lib/core/cend-adapter.ts` / `lib/core/execution/types.ts` | **两边都改**（worker/src/core 是 fork；这俩文件 vercel 端也用来 mark step） |
| `lib/encryption.ts` / `lib/autonomy.ts` / `lib/agent/planners/booking-links.ts` / `lib/booking-errors.ts` / `lib/live-log-store.ts` | **两边都改**（worker/src 有 fork） |
| NLU / chat / UI / API routes | 只在 root（这些**不在** worker 里） |

### Drift 检测（自动化）

每次改完 booking-autopilot / booking-errors / live-log-store / encryption /
autonomy / types / browser-session-store / monitors / memory / lib/core 之后跑：

```bash
npm run check-drift
```

脚本：`scripts/check-drift.ts` —— 跑 `diff -rq` 一组指定的 lib ↔ worker 配对，
任何 byte-level 差异都会 fail 退出 1。CI 也会跑（`.github/workflows/check-drift.yml`，
push to master + PR 触发），漏 drift 的 PR 进不去 master。

修复 drift 的标准动作：选定 canonical 一边，`cp <canonical> <other>`，再跑
`npm run check-drift` 直到通过。

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

### lib/booking-autopilot/ 物理删除（DEFERRED — 仍载货）

**前提：先把所有 import lib/booking-autopilot 的地方迁移到 worker 路径或者
inline 化。** 当前阻塞物理删除的 import：
- `app/api/booking-jobs/[id]/start/route.ts:58` — `runBrowserTask`
- `lib/core/execution/executor.ts:19` — `runBrowserTask` + task-builders + types

物理删除步骤（仍未做）：
- 删 `lib/core/execution/{executor,recovery,recovery-providers}.ts`（worker 有 fork，但
  Vercel 也用，得先证明 M5 gate 永远 hit）
- 删 `app/api/booking-jobs/[id]/start/route.ts` 的 `runStepWithRecovery` /
  `runUniversalStep` / `runUniversalStepViaCore` in-process 段
- `BookingProfile` type 从 `lib/booking-autopilot/types.ts` 移到 `lib/core/booking-types.ts`
- 删 `lib/booking-autopilot/` 整个目录
- 删 `vercel.json` 的 retry-jobs cron 条目 + `app/api/cron/retry-jobs/route.ts`
- typecheck + smoke test 一遍才能 ship

触发删除的真实条件（任一）：
- M5 force-gate 在 prod 运行 N 天，0 次 fallback 触发，证明 in-process 路径无人走
- Browserbase Pro 升级 → 所有 scenario 都通过 worker 跑，无需 Vercel 端 chromium

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

