# Phase 1 — founder E2E walkthrough

> **For**: 用户（创始人）— 手动验证 Phase 1 的全部 user-facing surface
> **作者**: Claude (Track B)
> **状态**: 🟢 ready to run — Phase 1 ~95% shipped (per `PHASE_STATUS.md`)；这条 walkthrough 是 declared 前的最后一道门
> **两条路径**: 10 分钟 quick path（first-pass smoke）/ 60-90 分钟 full path（sign-off 用）—— 见下面 § 选哪条

> 🆕 **2026-05-04**: 这套流程现在有了运行态 ——
> [`/dev/founder-e2e`](http://localhost:3000/dev/founder-e2e) 把下面每个 step 变成
> 一个可勾选的行，每行可以 fail/blocker + 填 actual / screenshot / taskId，
> 一键 Export Markdown 直接给 codex/Claude 当 bug ticket。
> 详见 `FOUNDER_E2E_BUG_TRIAGE.md`。
> Preflight: `npm run preflight:founder-e2e` （需要 dev server 在跑）。

这个文档是 PHASE_1_PLAN.md #8 — Founder E2E walkthrough。目标是在用户视角
**手动**走完 Phase 1 的每个用户路径，找出 UX 缺口、复现 bug、签字 Phase 1
是否真正"产品就绪"。

每个步骤都有：
- **怎么做**（精确点击/输入）
- **预期看到**（什么算正确）
- **要警惕**（什么算 bug，要记下来）

底部有 **bug 记录模板** + **已知不在 Phase 1 范围内的事情**（不要花时间纠结这些）。

> **R-003 live smoke 不在这个文档范围内**。那是 Phase 0A 的 Computer Use 真跑流程，
> 由 codex 执行 + 烧 OpenAI token；checklist 在 `R003_LIVE_SMOKE_RUNBOOK.md`，不要把
> 这条 founder walkthrough 跟 R-003 live 混做一锅。

---

## 选哪条路径？

| 场景 | 路径 | 时间 | 覆盖 |
|---|---|---|---|
| First pass / 想快速验证今天的 build 没崩 / 拍 release video 前 sanity check | **§ A — Quick path** | ~10 分钟 | 自动 smoke + 3 个 cookie-auth 闭环关键流 |
| 准备签字 Phase 1 declared / 给团队 demo / 签字进 Phase 0B | **§ 0–§ 11 Full path** | 60-90 分钟 | 12 段全部，含每个 demo 状态、真实 task 流程、PATCH 端点 curl、benchmark dashboard、DR 多人 |

**推荐顺序**: 先跑 Quick；Quick 全过 → 再决定要不要 Full。Quick 抓到任何 🔴/🟠
issue → 走 § 🛑 停测条件 决定是修后再继续还是先记账。

---

## 🛑 什么时候停止不要继续测

不是所有 bug 都该让 walkthrough 继续。这一节列**停**的条件 vs **记下继续**的条件。
目的是不浪费 60 分钟在已经塌了的地基上找小 bug。

### 🔴 立刻停 — 这些是 Phase 1 ship blocker

| 症状 | 为什么停 | 下一步 |
|---|---|---|
| `npm run smoke:phase1` 任意 route FAIL | 渲染都没过，下面 60 分钟全是噪音 | 把 fail 列表 + console error 贴给 Claude；等修完再跑 walkthrough |
| Cookie-auth 失效（`/api/v1/*` 任意 endpoint 401，但用户已登录）| Phase 1 整套用户路径就靠 cookie；cookie 没生效 → 下面所有真实流程都过不了 | 立即 ping codex（auth domain）；Phase 1 declaration 卡死直到这条修 |
| ziweiB 能看到 ziweiA 的 task 内容 | 安全 / 隐私漏洞，比 ship Phase 1 更重要 | 立即 ping codex；P0 bug；标记禁止 ship |
| `PATCH /api/v1/users/me/profile` 接受 payment 字段（card_number / cvv 等）写入 | 监管风险 + 安全漏洞 | 立即 ping codex；P0 bug |
| Path B path 不工作：缺 profile 字段时弹的还是老 `InlineBookingProfileGate` modal 而不是 inline `ProfileGapCard` | Phase 1 #7 path B 没生效 → declared 不成立 | 检查 `NEXT_PUBLIC_PROFILE_GAP_INLINE` env；如果 flag 是 ON 但还走老路径，ping Claude |
| Hydration mismatch 红错警告**漫天**（不是个别页面）| Next.js 生产部署后 SEO/SSR 都会爆 | 报给 Claude（component 域）|

**触发任一 🔴 → 不要继续 Quick / Full path。先解决，再重跑。**

### 🟠 记下来继续 — 这些是 Phase 1.5 polish 而不是 ship blocker

| 症状 | 为什么继续 | 出 bug ticket 但不阻塞 |
|---|---|---|
| 单一页面 UI 字符不对齐 / 字号偏小 / 颜色弱了点 | 不影响功能；Apple-tier polish 是 Phase 1.5 任务 | ✅ 记 bug template § 8 |
| 某个文案在 emerging 状态下有歧义 | UX gap，可改但不致命 | ✅ 记 |
| Failure card 里有原始 URL 没翻译人话 | 已经在 Phase 1.5 polish 队列 | ✅ 记 |
| Cancel button 点完后 polling 多跑 1-2 拍才停 | UX 不完美；功能正确（state 真切到 cancelled） | ✅ 记 |
| /dev/profile-gap-flow inspector 颜色不好看 | 是 dev surface，founder 不直接用；polish 优先级低 | ✅ 记，标 P3 |
| Console 出现一两个 warning（不是 error）| 大概率第三方 lib 噪音 | ✅ 记，annotate 来源 |

**触发只有 🟠 → 继续走完，最后一并整理。**

### 🟡 不计入这次 walkthrough 的内容

看到下面这些**不要记**（已知不在 Phase 1 范围内）—— 详见 § 9：
- 任何 hotel / flight / activity 场景报错
- Inspire / Daydream / 30-template gallery 缺失
- Stripe live 支付（sandbox 是设计意图）
- Worker 没部署到 Railway（prod booking flow 还没开）
- "Try again" 按钮没真重试

记这些是浪费 review 时间，不会进 ticket。

---

## A. Quick path — 10 分钟自查

> **目标**: 用最短时间确认 Phase 1 today's build 在三件事上没崩——渲染 / cookie-auth / 边界。
> 自动化 + 浏览器混合；不签字 Phase 1，只验证"今天的 master 没塌"。

### A.1 起 dev server（1 分钟）

```bash
# 终端 A
cd /c/Users/Gzw19/onegent
git fetch origin
git log --oneline origin/master -3

# 在 detached / Codex worktree 里如果 npm run dev Turbopack panic → 用 webpack：
npx next dev --webpack > ./dev.log 2>&1
# 否则：
# npm run dev > ./dev.log 2>&1
```

### A.2 自动 smoke (30 秒)

```bash
# 终端 B
npm run smoke:phase1
```

**通过条件**: `All 6 routes passed.` + exit 0
**失败**: 见 § 🛑 第一条 🔴

### A.3 真实 task 创建 + cookie-auth 闭环（4 分钟）

1. 浏览器登录 ziweiA，访问 `http://localhost:3000`
2. Chat 输入: `Buvette next Thursday 8pm solo dinner`，confirm 创建 task
3. 跳转到 `/tasks/<uuid>` 自动发生
4. DevTools → Network: 看到 `/api/v1/travel-tasks/<uuid>` 周期性 200 响应（cookie 自动带）
5. 点 "Cancel task" → confirm → 看到 status pill 变 **"Cancelled"** + polling 停 + 按钮消失

**通过条件**: cookie-auth 成功 + cancel state transition 生效（codex `7289ba0` fix 在线）
**失败**: cookie 没生效 / cancel 后 state 不变 → 见 § 🛑 第二条 🔴

### A.4 ProfileGapCard 路径 B（2 分钟）

1. 还是登录 ziweiA（或换 ziweiB 触发空 profile）
2. 在首页 chat 输入需要 DOB / phone 等字段的 booking 请求（比如 Carbone tonight 7pm party of 2）
3. **预期**: 缺字段时直接在 chat 流里 inline 渲染 ProfileGapCard（橙色卡），**不是** modal `InlineBookingProfileGate`

**通过条件**: 看到 inline ProfileGapCard
**失败**: 看到 modal → 见 § 🛑 第五条 🔴

### A.5 Ownership 边界（2 分钟）

1. 复制 A.3 创建的 task UUID
2. 退出 → 用 ziweiB 登录
3. 在地址栏粘 `/tasks/<那个 UUID>`

**通过条件**: 看到 "Sign in to view this task" 401 卡（不泄露内容）
**失败**: 看到 ziweiA 的 task 内容 → 见 § 🛑 第三条 🔴

### A.6 Profile PATCH guard（30 秒，可选）

```bash
# 拿浏览器登录后的 cookie
curl -X PATCH http://localhost:3000/api/v1/users/me/profile \
  -H "Cookie: __session=<paste>" \
  -H "Content-Type: application/json" \
  -d '{"card_number": "4111111111111111"}'
```

**通过条件**: HTTP 4xx + body 提到 "payment fields not allowed"
**失败**: HTTP 200 → 见 § 🛑 第四条 🔴

---

### Quick path 通过判定

| Step | 通过条件 |
|---|---|
| A.1 + A.2 | smoke 6/6 PASS |
| A.3 | task 创建 + cookie polling + cancel transition all green |
| A.4 | Inline ProfileGapCard，不是 modal |
| A.5 | 401 不泄露 |
| A.6 | payment 字段被拒 |

**全 ✅ → today's build 没塌**，可以决定要不要继续走 Full path 签字。
**任一 ❌ + 是 🔴 类** → 见 § 🛑 立刻停。
**任一 ❌ + 是 🟠 类** → 记 bug template，继续 Full path（或 ship 后修）。

---

## ────────────────────────────────────
## 以下为完整 60-90 分钟 Full walkthrough
## ────────────────────────────────────

## 0. Pre-flight（5 分钟）

### 0.1 环境

```bash
# 在 onegent 项目根
cd /c/Users/Gzw19/onegent

# 1. 同步到最新 master
git fetch origin
git log --oneline origin/master -3
# Phase 1 #7 path A + B + hardening + smoke 都已 merged 到 master 这边；
# 不需要 cherry-pick 任何 Claude branch。

# 2. 跑 dev server（落盘日志便于事后查问题）
# ⚠️ 在 Codex detached worktree / symlinked node_modules 环境下，
# Turbopack 可能 panic；用 webpack 兜底：
npx next dev --webpack > ./dev.log 2>&1 &
# 在主 worktree（正常 node_modules）下也可以 npm run dev。

# 3. 跑 worker（restaurant 走 worker 路径；不跑则真 task 会卡 queued）
cd worker
npm run dev > ../worker.log 2>&1 &
cd ..

# 4. 浏览器打开
open http://localhost:3000          # 或 Chrome 手动开
```

### 0.2 账号准备

测试账号位于 `MEMORY.md` → `test_accounts.md`：
- `ziweiA@onegent.dev` — 主账号，profile 完整（用于 happy path）
- `ziweiB@onegent.dev` — 空 profile（用于触发 ProfileGapCard）
- `ziweiC@onegent.dev` — 中间状态（用于多用户 DR 测试）

> 三个都在 Clerk natural-tuna-90 dev instance 上，密码同 password manager。

### 0.3 浏览器开发者工具

- 打开 DevTools → Network tab，过滤 `/api/v1/`
- 打开 Console tab，留意红色错误
- DevTools 保持开着整个 walkthrough，事后好回放

### 0.4 自动 smoke 预热（30 秒 · 推荐先跑）

在花 60-90 分钟手动 walkthrough 之前，先跑一次自动 render-level smoke：

```bash
npm run smoke:phase1
```

这会用 headless chromium 串行访问 6 个核心 surface
(`/dev/path-b-demo` / `/tasks/demo-*` / `/dev/benchmark-runs` / `/dev/profile-gap-flow`)
并断言每个页面渲染出关键文案。**全过 (`exit 0`)** 才值得继续手动走 walkthrough；
有 route fail 就先修页面再继续。

详见 `PHASE_1_E2E_SMOKE.md`（覆盖范围、失败排查、设计选择）。

---

## 1. /dev landing 索引页（2 分钟 · 健康检查）

```
URL: http://localhost:3000/dev
```

**怎么看是好的**：
- ✅ 看到 5 个 Phase 0 / NLU / Timeline 路由卡片，每个有 status 徽章（live/mock/spec）
- ✅ "Strategy docs" 区块列出 8 个 .md 文件链接
- ✅ "Coordination" 区块的 codex.md / claude.md 链接可点
- ✅ 没有红色 console 错误

**警惕**：
- ❌ 任何路由卡片报 404
- ❌ Hydration mismatch warning（"Text content does not match server-rendered HTML"）
- ❌ Server Component 异常

记下来 → bug template 一格。

---

## 2. Phase 1 task surface — 5 demo states（10 分钟 · UI 质感）

**核心目标**：每个 demo 状态在 UI 上分别长什么样，色调对不对、文案有没有歧义。

### 2.1 `demo-executing`（运行中）

```
URL: http://localhost:3000/tasks/demo-executing
```

**预期看到**：
- 标题: "Buvette in West Village next Thursday 8pm solo dinner"
- 状态徽章: **"Running"**（蓝色 / "active" 色调）
- 主区: TaskTimelinePanel 显示空 events（fixture 没事件）
- 侧栏: Task meta 显示 createdAt / updatedAt / scenario "restaurant"
- "Cancel task" 按钮可见（task is cancelable）

**警惕**：
- ❌ 状态徽章颜色跟"运行中"不匹配（应该是 active 蓝，不是 done 绿）
- ❌ "Cancel task" 按钮被禁用
- ❌ TaskTimelinePanel 报错 / 不渲染

### 2.2 `demo-awaiting-profile`（缺 profile 字段，**核心**）

```
URL: http://localhost:3000/tasks/demo-awaiting-profile
```

**预期看到**：
- 标题: "Carbone tonight 7pm party of 2"
- 状态徽章: **"Need details"**（橙色 / "blocked" 色调）
- 主区: **ProfileGapCard 渲染** — 显示 2 个空字段（date_of_birth + phone）
- ProfileGapCard 文案: "Carbone uses Resy and needs verified contact details."
- 字段输入框: DOB 用 date picker，phone 用 tel input
- "Save and continue" 按钮: 默认禁用（直到至少填一个字段）
- "Maybe later" 链接 / 跳过选项可见

**操作 — 填表**：
1. 在 DOB 输入框输入一个日期（比如 1990-01-01）
2. 在 phone 输入框输入 +1 555 555 5555
3. 看到 "Save and continue" 变可点
4. 点 "Save and continue"

**预期看到**：
- 弹出 alert: `Demo mode — would POST to /api/v1/travel-tasks/demo-awaiting-profile/continue` 后跟 JSON payload
- 这个 alert 表示 mutation handler 正确接到了 GapSavePayload

**警惕**：
- ❌ "Save and continue" 按钮在没填字段就可点
- ❌ 输入 DOB 用 text input 而不是 date picker
- ❌ Alert 里 JSON payload 缺字段或字段名跟 canonical 13 不对齐
- ❌ payment 字段（card_number 等）被 inline 收集了（违反规则；应该重定向到 /permissions）
- ❌ "Maybe later" 跳过后没有合理 fallback

### 2.3 `demo-awaiting-otp`（等验证码）

```
URL: http://localhost:3000/tasks/demo-awaiting-otp
```

**预期看到**：
- 标题: "Don Angie next Friday 7:30pm party of 2"
- 状态徽章: **"Awaiting code"**（橙色）
- 主区: 提示性文案 "Resy is asking for the verification code from your inbox."
- 侧栏: Cancel 按钮可见

**警惕**：
- ❌ 没有"我去手动接力"的提示（Phase 0 § 7.5 说 OTP 是 transitional 状态）

### 2.4 `demo-ready-for-confirmation`（待用户最后一击）

```
URL: http://localhost:3000/tasks/demo-ready-for-confirmation
```

**预期看到**：
- 标题: "TAO Downtown tomorrow 7pm 2 people for date night"
- 状态徽章: **"Ready to confirm"**（绿色 / "done" 色调）
- 主区: 大型确认卡片 — "Reservation form is filled. Onegent has paused before the final confirm tap — review the latest snapshot and confirm in your own browser when you're ready."
- **没有 confirm 按钮** — **这是设计意图**：让用户在自己浏览器里确认，避免 Onegent 代为最后一击导致幻觉确认 / 法律风险
- 卡片下方有 snapshot 链接（`data._links.snapshots`）方便用户去看 agent 填了什么

**警惕**：
- ❌ 确认卡片视觉权重不够（按 UI quality bar，应该是页面焦点）
- ❌ 卡片里**多了**一个 confirm 按钮（**反设计**：Onegent 永远不替用户做最后确认）
- ❌ 没有 snapshot 链接 / 链接死掉

### 2.5 `demo-failed`（失败）

```
URL: http://localhost:3000/tasks/demo-failed
```

**预期看到**：
- 标题: "Atomix 2 Saturdays out 8pm 2 people"
- 状态徽章: **"Failed"**（红色 / "fail" 色调）
- 主区: 失败原因卡片 — terminal_reason 文案 "Computer Use stopped at https://resy.com/cities/ny/search?query=Atomix&time=2100"
- 一个 "Try again" 或 "Back to tasks" 行动按钮

**警惕**：
- ❌ 失败原因文案里有原始 URL，没翻译成人话（"agent got stuck at..."）
- ❌ 用户没有"下一步该做什么"的 CTA
- ❌ 没有"contact support"链接（Phase 1 不强制，但 nice-to-have）

### 2.6 Demo not-found 兜底

```
URL: http://localhost:3000/tasks/demo-bogus-state
```

**预期看到**：
- "Demo not found" 卡片
- 列出 5 个有效 demo ID
- 每个 ID 是可点链接

**警惕**：
- ❌ 直接 500 错误而不是友好的 not-found 卡片

---

## 3. Phase 1 task surface — 真实流程（20 分钟 · 端到端）

> ⚠️ 这一节会真的创建 booking job 但不会真预订（Computer Use force-gate
> 路由到 worker；worker 没部署到 Railway，所以 job 会卡在 pending 直到
> 你本地 worker 抢占。如果不想跑 worker，看到 task=executing → 卡住属于
> 预期行为，不是 bug）。

### 3.1 注册 / 登录

```
URL: http://localhost:3000
```

**操作**：
1. 右上角 "Sign in"
2. 选 ziweiA 账号登录（密码在 password manager）

**预期看到**：
- ✅ 跳回首页，右上角变成头像/邮箱
- ✅ DevTools Network tab 看到 Clerk session cookie 设置

**警惕**：
- ❌ Clerk OAuth 页面 401 / 502 / 报错
- ❌ 跳回首页后右上角还是 "Sign in"

### 3.2 创建一个新 task（chat 入口）

**操作**：
1. 首页输入框输入：`Buvette next Thursday 8pm solo dinner`
2. 按 Enter
3. 看 chat 面板的反应

**预期看到**：
- ✅ Agent 回复：理解了（restaurant + date + time + party_size）
- ✅ 跳出 quick_picks 或 confirm_card（取决于场景的字段全不全）
- ✅ 当用户 confirm 后，POST /api/chat/commit 创建 task

**警惕**：
- ❌ NLU extractor 把 scenario 识别错（restaurant 识别成 hotel）
- ❌ Confirm card 显示的日期跟用户输入对不上
- ❌ Console 报 NLU JSON parse error
- ✅ **Phase 1 #7 已 ship**：缺 profile 字段时**应该看到 inline ProfileGapCard**（橙色卡片渲染在 chat 流里），不是 modal `InlineBookingProfileGate`。如果看到 modal，说明 `NEXT_PUBLIC_PROFILE_GAP_INLINE=0` 或 backend 漏 emit `payload.profile_gap`（fallback path）。

### 3.3 跳到 /tasks/[taskId] 看真实状态

**操作**：
1. Confirm 创建 task 后，应该跳转到 `/tasks/<uuid>`，或在 chat 里有"View task"链接
2. 点过去

**预期看到**：
- ✅ URL 是真实 UUID，不是 demo-*
- ✅ 状态徽章可能是 "Running"（worker 还没抢）或 "Executing"
- ✅ 5s 一次的 polling — DevTools Network tab 看到 `/api/v1/travel-tasks/:taskId` 周期性请求
- ✅ Cookie 自动携带（每个请求 Headers 看到 `Cookie: __session=...`）

**警惕**：
- ❌ 跳转后 401 — cookie auth 没生效（这是 codex `48c80b2` 的核心 fix，必须 work）
- ❌ Polling 速率不对（>5s 或 <5s）
- ❌ Task 状态卡死不变（如果 worker 在跑，应该会进入 awaiting_* 或 ready_for_confirmation）

### 3.4 Cancel 真实 task

**操作**：
1. 在 task 还在 non-terminal 状态时，点 "Cancel task"
2. Confirm 弹窗

**预期看到**：
- ✅ DevTools Network tab 看到 `POST /api/v1/execution-jobs/<jobId>/cancel`
- ✅ 请求带 cookie，无 body
- ✅ 响应 200 with `{ jobId, cancelled: true, priorStatus }`
- ✅ Booking job row 从 DB 删除（cancel endpoint 直接删行）
- ✅ **Refetch 后 task.state 变 `cancelled`**（codex `7289ba0` fix）
- ✅ Polling 自动停（terminal state）
- ✅ "Cancel this task" 按钮消失

**警惕**：
- ❌ Cancel endpoint 401 / 403 — 这是 codex `48c80b2` 的 fix 应该 work
- ❌ task.state 没变 cancelled / polling 不停（codex `7289ba0` 已修，如果回归请 flag）

### 3.5 测试 ownership 边界

**操作**：
1. 复制刚才的 task UUID
2. 退出 ziweiA → 登录 ziweiB
3. 在浏览器地址栏粘 `http://localhost:3000/tasks/<刚才的UUID>`

**预期看到**：
- ✅ 看到 "Sign in to view this task" 卡片（codex 故意 401，不泄露 ownership）
- ✅ 没有 task 信息泄漏（连 task title 都看不到）

**警惕**：
- ❌ 看到了 ziweiA 的 task 内容（**严重 bug — 安全漏洞**）
- ❌ 看到了 "Task not found"（应该是 401 sign-in，不是 404 not-found；
  分得清两种 case 才 OK）

---

## 4. Profile PATCH endpoint（10 分钟 · 后端契约）

> 这一节用 curl 直接打 API，验证 codex `48c80b2` 的 PATCH 端点。

### 4.1 拿 cookie

```bash
# 在浏览器里登录 ziweiA 后，DevTools → Application → Cookies →
# 找 __session 或 __clerk_db_jwt（视 Clerk 版本）
# 复制完整 cookie 值
```

### 4.2 验证当前 profile（PATCH 自反射法）

> ⚠️ `GET /api/v1/users/me/profile` 不存在 — 端点只实现了 PATCH（见
> `app/api/v1/users/me/profile/route.ts`）。要验证当前 profile，发一个
> 空 PATCH 让它 echo 回当前状态。

```bash
# 发空 patch 强制 400 — 错误响应里包含端点活着的证明
curl -X PATCH http://localhost:3000/api/v1/users/me/profile \
  -H "Cookie: __session=<paste-here>" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -w "\nHTTP_STATUS=%{http_code}\n"
```

**预期看到**：
- ✅ HTTP 400 + `{ "error": { "code": "empty_profile_patch", ... } }` — 证明端点活着 + 校验工作
- ❌ HTTP 401 → cookie 没生效
- ❌ HTTP 404 → endpoint 没注册（codex 域问题）

或者直接跑 PATCH 一个无副作用字段（比如 label）然后看响应里 `profile` 字段：

```bash
curl -X PATCH http://localhost:3000/api/v1/users/me/profile \
  -H "Cookie: __session=<paste-here>" \
  -H "Content-Type: application/json" \
  -d '{"label": "Personal"}' \
  | jq '.profile'
```

返回的 `profile` 对象就是用户当前 profile 的完整快照（含 first_name / last_name / email / phone 等，但 **不含** card 字段 — payment 永远不走 profile API）。

### 4.3 PATCH 一个字段

```bash
curl -X PATCH http://localhost:3000/api/v1/users/me/profile \
  -H "Cookie: __session=<paste-here>" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15555550199"}' \
  | jq
```

**预期看到**：
- ✅ 200 响应
- ✅ 响应 JSON 显示新 phone 已生效
- ✅ 重新 GET 验证 phone 落库

**警惕**：
- ❌ 401 — cookie auth 没生效
- ❌ 422 / 400 — schema 校验意外严格（Phase 1 期间应该宽松）
- ❌ 修了 phone 但其他字段被清空（PATCH 应该是 partial update，不是 PUT）

### 4.4 PATCH 一个非法字段

```bash
curl -X PATCH http://localhost:3000/api/v1/users/me/profile \
  -H "Cookie: __session=<paste-here>" \
  -H "Content-Type: application/json" \
  -d '{"card_number": "4111111111111111"}' \
  | jq
```

**预期看到**：
- ✅ 4xx 拒绝（payment 字段永远不能通过这个 endpoint 写入）
- ✅ 错误 body 提到 "payment fields not allowed here"

**警惕**：
- ❌ 200 — payment 数据进了 profile 表（**严重 bug — 安全漏洞 + 监管风险**）

---

## 5. Benchmark dashboard（10 分钟 · Phase 0 飞轮）

```
URL: http://localhost:3000/dev/benchmark-runs
```

**操作 1 — 浏览历史 runs**：
- 看左栏 list of runs（如果 codex 跑过 R-003 live smoke，应该有几个 entries）
- 点一个进去看 detail drawer

**预期看到**：
- ✅ Run detail 显示 4 个 metric 卡片（booking-ready / safe-outcome / severe-failure / taxonomy-coverage）
- ✅ GateBreakdown 4 行 threshold 表，每行有 "met" / "short" 徽章
- ✅ "Top recommended fixes" 面板按优先级列出建议
- ✅ Per-case drawer 列出 R-001 ... R-025（如果是 25-case suite）或单 R-003

**操作 2 — Validator paste 测试**：
- 准备一段假 JSON（参考 `benchmark/runs/phase0-resy-*.json` 格式但故意残废一个字段）
- 粘到 ValidatorPanel 输入框
- 看 errors / warnings 列表

**预期看到**：
- ✅ Validator 报出残废字段名 + 期望 shape
- ✅ § 7.5 OTP 软警告（如果故意造一个 F-PROVIDER-OTP + safe_handoff case）

**警惕**：
- ❌ Dashboard 直接报 console error
- ❌ GateBreakdown 算错（手算一遍 ≥80% / ≥95% / =0 / 100% 看是否一致）
- ❌ Validator 漏检一个 schema 字段

---

## 6. Profile gap mock pipeline（5 分钟 · Phase 1 #7 预演）

```
URL: http://localhost:3000/dev/profile-gap-flow
```

> 这一节是 Phase 1 #7（homepage chat 接 ProfileGapCard）的**预演**。真实
> 接线还没做，但这个 dev route 用 mock backend 跑通了完整 chat → NLU →
> ProfileGapCard → mock PATCH 的循环，可以验证产品 UX 是不是合理的。

**操作**：
1. 左栏 chat 输入框输入：`my email is foo@example.com and phone is 555-1234`
2. 按 Enter

**预期看到**：
- ✅ 右栏 inspector 显示：
  - **Last action**: `apply_profile_patch`
  - **Mock backend profile**: 现在含 email + phone
  - **IntentState**: scenario = "profile_edit"
  - **Raw extractor JSON**: extractor 抽出来的 patch 内容

**操作 2**：
1. chat 输入：`book me a restaurant tonight 7pm party of 2`
2. 应该触发 needs_profile_data（mock backend 缺了 first_name / last_name / DOB）
3. 看 ProfileGapCard 弹出来

**预期看到**：
- ✅ ProfileGapCard 渲染在 chat 流里（inline，不是 modal）
- ✅ 缺字段 first_name / last_name / DOB 高亮
- ✅ 用户填完点 "Save and continue" → inspector 显示 mock PATCH dispatch

**警惕**：
- ❌ ProfileGapCard 弹出来时挡住了之前的 chat 历史
- ❌ ProfileGapCard 字段顺序违和（first_name 应该在 last_name 前面，DOB 在后面）
- ❌ Mock pipeline 报错（如果报错说明 NLU v2 production code 有问题，因为这条路用 real coerceIntentState + routeIntent）

---

## 7. Decision Room（10 分钟 · 多人协作）

> Phase 1 期间 DR 是已有功能，这次主要做 regression check。

### 7.1 创建 DR

```
URL: http://localhost:3000
```

**操作**：
1. 登录 ziweiA
2. Chat 输入: `让我和小明小红一起决定周末去哪吃饭`
3. NLU 应该识别成 multi_member_room（scenario）
4. 创建 DR，跳转到 `/rooms/<id>`

### 7.2 邀请 ziweiB

**操作**：
1. 在 DR 页面点 "Invite member"
2. 输入 ziweiB 的邮箱

**预期看到**：
- ✅ ziweiB 在 member 列表
- ✅ 用 ziweiB 账号登录（incognito 或不同浏览器）打开 DR 链接，能看到对话
- ✅ ziweiB 的 chat 输入栏可见

### 7.3 多人 chat

**操作**：
1. ziweiA 打: "我想吃日料"
2. ziweiB 打: "我想吃中餐"
3. 等 NLU 推荐 / quick_picks

**预期看到**：
- ✅ Typing indicators 工作
- ✅ Member avatars 渲染
- ✅ 每条消息有发送者标签

**警惕**：
- ❌ 实时同步丢失（B 的消息 A 看不到）
- ❌ NLU 在多人语境里崩
- ❌ 谁是 payer 显示错乱

---

## 8. Bug 记录模板

发现 bug 用这个 template，能让 Claude 或 codex 1 分钟内 reproduce。
分级跟 § 🛑 停测条件 对齐：🔴 = 立刻停 / 🟠 = 记下继续 / 🟡 = polish / 🟢 = nice-to-have。

```markdown
### [BUG-XXX] 标题（一句话）

**严重程度**: 🔴 P0 ship-blocker / 🟠 P1 phase-1.5 / 🟡 P2 polish / 🟢 P3 nice-to-have
**Surface**: 比如 /tasks/demo-awaiting-profile, /api/v1/users/me/profile PATCH
**Phase 域**: Phase 1 #N (e.g. Phase 1 #7 path B) / Phase 0 / Phase 1.5 polish

**用户路径**:
1. ...
2. ...
3. (期望) ... (实际) ...

**Reproducibility**: 100% 必现 / X 次中 Y 次 / 偶发
**触发账号**: ziweiA / ziweiB / ziweiC
**触发时间** (UTC): 2026-MM-DD HH:MM —— 配 worker.log / dev.log timestamp 找上下文
**浏览器**: Chrome 120 / Firefox / Safari (含版本)

**截图 / 录屏**: <贴图>
**Console error** (DevTools Console tab): <贴 stack>
**Network request** (DevTools Network tab): URL + status + response body
**Server log 摘录** (`./dev.log` / `worker.log` 对应时间窗): <贴行>

**怀疑根因** (可选): codex 域 (api / lib/core / lib/execution-v2 / worker) / Claude 域 (components / app / lib/agent) / 不确定
**Reference commit**: 触发时 master 的 short SHA（`git rev-parse --short origin/master`）
```

**提交去向**:
- 🔴/🟠 → 直接在 chat 贴给 Claude，Claude 决定 Track A 还是 Track B + 转 GitHub issue 或 inline fix
- 🟡/🟢 → 集中收一批；Phase 1 declared 后批量进 Phase 1.5 polish queue（写进 `.coordination/claude.md`）

发到 GitHub issue 或直接在 chat 里贴给 Claude。

---

## 9. 已知不在 Phase 1 范围内（不要花时间纠结）

> 这些是**故意没做**的事。看到了不是 bug — 是 Phase 2-3 计划。

| 现象 | 状态 |
|---|---|
| ~~Homepage chat 缺 profile 时弹的是 InlineBookingProfileGate~~ | ✅ **已修**：Phase 1 #7 path B shipped (`4cdaa36`)。现在缺字段直接 inline ProfileGapCard 在 chat 里 |
| 任何 hotel / flight / activity 场景的真实预订 | Phase 2 |
| Inspire mode / Daydream Explorer 入口 | Phase 3，30-template gallery |
| 推荐 / referral / payer discount / completion credit | Phase 2-3 |
| Public Social Feed | Phase 3 |
| ChatGPT Apps 主动推送 | Phase 3 |
| Stripe live key（目前是 sandbox） | 等付费用户后再切 |
| Worker 部署到 Railway（prod booking 走真实环境） | 等真付费用户后 |
| 失败 task 的 "Try again" 按钮真的重试 | Phase 1 #5 OTP resume + 通用重试，conditional |
| Browserbase Pro 升级（warm session 持久化） | ≥ 500 paying users 才考虑 |

---

## 10. Phase 1 #8 完成判定（exit criteria）

✅ 全部 5 demo 状态 UI 看起来 Apple/Linear/Stripe 级
✅ 真实 task 创建 → polling → cancel 全 flow 跑通
✅ Cookie auth 在 ziweiA / ziweiB 之间正确隔离 task 可见性
✅ Profile PATCH endpoint 接受 partial update + 拒绝 payment 字段
✅ Benchmark dashboard 渲染历史 runs + Validator paste 工作
✅ Mock profile-gap-flow 跑通（验证 Phase 1 #7 接线 spec 正确）
✅ DR 多人 chat regression 没坏
✅ 0 个 🔴 严重 bug；🟠 中 bug ≤ 3 个

如果 ≥ 6 项打勾且严重 bug = 0 → **Phase 1 #8 通过，可以 Ship Phase 1**。

---

## 11. 走完之后

1. 把 bug 列表发给我
2. 我整理成 GitHub issues / .coordination/claude.md 任务
3. Codex 审核哪些是 codex 域的（auth / API / executor）
4. Track A + Track B 修完后再走一次 walkthrough
5. 第二次干净 → ship Phase 1（在 PROJECT_SUMMARY.md 写 launch announcement）
6. 进入 Phase 2 计划

---

## 12. 引用文档

- `PHASE_STATUS.md` — 8 phase 总览（先看这个；Phase 1 在哪、相对其他 phase 关系）
- `PHASE_1_PLAN.md` — 8 deliverables 顺序 + 当前 status snapshot
- `PHASE_1_UI_MERGE_NOTES.md` — Track B 88 文件 inventory（merge 视角）
- `PHASE_1_E2E_SMOKE.md` — `npm run smoke:phase1` 自动 smoke 的 runbook + 失败排查（A.2 / § 0.4 用到）
- `R003_LIVE_SMOKE_RUNBOOK.md` — Phase 0A R-003 live smoke 的 codex 执行 checklist；**这条 walkthrough 不跑 R-003 live**，但如果 founder walkthrough 全过 → R-003 live 是下一步 Phase 0A 闭环动作
- `UI_MIGRATION_MAP.md` — 旧 UI vs 新 UI 对照（解释"我以前的页面去哪了"）
- `BENCHMARK_RESTAURANT_100.md` § 7.5 — OTP transitional rule
- `WARM_SESSION_STRATEGY.md` — Phase 0 OTP path D（BLOCKED 状态）
- `PROJECT_SUMMARY.md` § Recent Updates 2026-05-03 — 完整战略上下文
- `CLAUDE.md` § 协作协议 — codex / Claude 分工 + commit 协议
- `.coordination/claude.md` / `.coordination/codex.md` — 跨边状态同步
