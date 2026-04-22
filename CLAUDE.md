
## gstack

Use /browse from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.

Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /retro, /investigate, /document-release, /codex, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade

If gstack skills aren't working, run: cd .claude/skills/gstack && ./setup

## Language

Always respond in Chinese. Never respond in Korean.

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

