# E2E Source Audit — Pre-Walkthrough Verification

> **生成时间**: 2026-05-03 15:35 UTC
> **状态**: 🔴 5 处与源码不符 / ✅ 多数验证通过
> **作者**: Claude (Track B)
> **目的**: codex 跑 `PHASE_1_FOUNDER_E2E.md` no-token walkthrough 时，
> 用这份对照表立刻判断"报的 bug 是真 bug 还是 spec 写错"

---

## TL;DR — 5 个发现，按严重度排

| # | 严重度 | 发现 | 域 | 修法 |
|---|---|---|---|---|
| 5 | 🔴 HIGH | `POST /api/v1/execution-jobs/:jobId/cancel` 删 job 但不更新 `task.state` 到 `cancelled`，polling 不停，UX 显示 cancel 没生效 | codex | codex 加 `updateTravelTaskState(taskId, "cancelled", ...)` |
| 1 | 🟠 MED | `app/dev/page.tsx` STRATEGY_DOCS 链接指向已 abandon 的 `claude/festive-pare-f27273` 分支 | Claude | 改成 `master` |
| 4 | 🟠 MED | E2E spec § 4.2 让用户 `curl GET /api/v1/users/me/profile`，但**只实现 PATCH，没有 GET** | Claude (spec) | 改 spec：用 PATCH 自验证 / 或 codex 加 GET endpoint |
| 2 | 🟡 LOW | E2E spec § 2.4 写 demo-ready 文案是 "One tap from confirmed."，实际是更长的解释 | Claude (spec) | 改 spec |
| 3 | 🟡 LOW | E2E spec § 2.4 期望 "Confirm reservation" 按钮，UI 实际无任何确认按钮（**设计意图**：让用户在自己浏览器确认） | Claude (spec) | 改 spec |

---

## 逐节对照

### § 1 /dev landing（健康检查）

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| 看到 5 个 route groups | `app/dev/page.tsx` 有 PHASE_0_ROUTES (1) + NLU_PROFILE_ROUTES (2) + TASK_TIMELINE_ROUTES (2) + TASK_DETAIL_DEMOS (5) + STRATEGY_DOCS | ✅ 实际 4 个 dev route group + STRATEGY_DOCS list（spec 写 "5 个" 略不准但接近） |
| status 徽章（live / mock / spec） | `interface DevRoute { status: "live" | "mock" | "spec" }` | ✅ |
| Strategy docs 链接可点 | STRATEGY_DOCS array 渲染 | ⚠️ **Finding 1**：链接指向 `https://github.com/.../claude/festive-pare-f27273/...`（dead branch） |

### § 2.1 `demo-executing`

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| 标题 "Buvette in West Village next Thursday 8pm solo dinner" | `DEMO_TASKS["demo-executing"].task.title` 一致 | ✅ |
| 状态徽章 "Running"（active 蓝） | `STATE_LABEL["executing"] = "Running"` + `STATE_TONE["executing"] = "active"` | ✅ |
| TaskTimelinePanel 渲染 | `<Body>` 渲染 `<TaskTimelinePanel demo={timelineDemoProp} />` | ✅ |
| Cancel 按钮可见 | `isCancelable("executing") = true` → 渲染 `task-detail__btn--danger` | ✅ |

### § 2.2 `demo-awaiting-profile`（核心）

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| 状态徽章 "Need details"（blocked 橙） | `STATE_LABEL["awaiting_profile"] = "Need details"` + `STATE_TONE["awaiting_profile"] = "blocked"` | ✅ |
| ProfileGapCard 渲染 2 个空字段（DOB + phone） | `_fixtureProfileGap.missing = ["date_of_birth", "phone"]` | ✅ |
| 文案 "Carbone uses Resy and needs verified contact details." | `_fixtureProfileGap.reason` 一致 | ✅ |
| "Saving and resuming…" 在 mutating | `mutating === "continue"` 时渲染 hint | ✅ |
| 点 Save → alert + JSON | Demo 路径：`window.alert(\`Demo mode — would POST to ...\`)` | ✅ |

### § 2.3 `demo-awaiting-otp`

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| 状态徽章 "Awaiting code"（blocked） | `STATE_LABEL["awaiting_otp"] = "Awaiting code"` + tone "blocked" | ✅ |
| 文案 "Resy is asking for the verification code from your inbox." | `task.terminalReason` 一致 | ✅ |
| "我去手动接力" 提示 | **没有专门 OTP 卡片 UI**；只显示 terminalReason | ⚠️ Spec 写"警惕：没有提示" — 实际就没有，spec 跟实际是一致的（Phase 0 § 7.5 transitional） |

### § 2.4 `demo-ready-for-confirmation`

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| 状态徽章 "Ready to confirm"（done 绿） | `STATE_LABEL["ready_for_confirmation"] = "Ready to confirm"` + tone "done" | ✅ |
| 文案 "Reservation form is filled. One tap from confirmed." | 实际：`"Reservation form is filled. Onegent has paused before the final confirm tap — review the latest snapshot and confirm in your own browser when you're ready."` | ⚠️ **Finding 2**：spec 太短/不准 |
| 大型确认卡片 + "Confirm reservation" 按钮 | 实际：`<div className="task-detail__confirm-card"><h3>Ready to confirm</h3><p>...</p></div>` — **没有按钮**，故意让用户去自己浏览器确认 | 🟠 **Finding 3**：spec 期望按钮，实际无 |

### § 2.5 `demo-failed`

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| 状态徽章 "Failed"（fail 红） | `STATE_LABEL["failed"] = "Failed"` + tone "fail" | ✅ |
| Failure 卡片显示 terminalReason | `<div className="task-detail__failure-card"><h3>Couldn't complete this booking</h3><p>{task.terminalReason}</p></div>` | ✅ |
| "Try again" 或 "Back to tasks" 按钮 | **实际无**，只有 breadcrumb `← Tasks` 在 Header | ⚠️ Spec 提了"警惕：没有 CTA" — 实际没 CTA，spec 跟实际一致 |

### § 2.6 Demo not-found 兜底

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| Demo not found 卡片 + 5 个有效 ID 链接 | `state.kind === "demo-not-found"` 渲染 `Object.keys(DEMO_TASKS).map(...)` | ✅ |

### § 3.x 真实流程

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| 5s polling | `setInterval(() => void fetchTask(), 5000)` | ✅ |
| `credentials: "include"` | `fetch(\`/api/v1/travel-tasks/${...}\`, { credentials: "include" })` | ✅ |
| 401 → "Sign in to view this task" | `if (res.status === 401 || res.status === 403) setState({ kind: "needs-sign-in" })` | ✅ |
| 404 → "Task not found" | `if (res.status === 404) setState({ kind: "not-found" })` | ✅ |
| Cancel POST 无 body | `fetch(.../cancel, { method: "POST", credentials: "include" })` | ✅ |
| **Cancel 后 task 状态变 "Cancelled"** | 实际：cancel 端点删 booking_jobs row，**不调 `updateTravelTaskState(taskId, "cancelled")`** | 🔴 **Finding 5 — codex 域 bug** |
| Polling 在 cancel 后停 | 因 task.state 没变 cancelled，polling 不会停 | 🔴 同上，由 Finding 5 引发 |

### § 4 PATCH endpoint

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| GET `/api/v1/users/me/profile` 返回 profile JSON | **只实现 PATCH**，没 GET | 🟠 **Finding 4** |
| PATCH partial update | `parseProfilePatch` 只更新 source 里有的 key，未提供的 key 不动 | ✅ |
| PATCH 拒绝 payment 字段 | `PAYMENT_FIELDS = new Set(["card_number", "card_expiry", "card_name", "billing_address"])` → 400 with explicit error | ✅ |
| 401 if not signed in | `if (!userId) return 401` | ✅ |
| Email 校验 | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | ✅ |
| Phone 校验 | `replace(/\D/g, "").length < 7` 拒绝 | ✅ |
| DOB 必须过去日期 | `new Date(...).getTime() > Date.now()` 拒绝 | ✅ |

### § 5 Benchmark dashboard

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| 4 个 metric 卡片 | `<MetricCard>` 渲染 booking-ready / safe-outcome / severe-failure / taxonomy-coverage | ✅ |
| GateBreakdown 4 行 threshold 表 | `<GateBreakdown>` 138-line 完整组件 | ✅ |
| Validator paste panel | `<Validator>` 实现 | ✅ |
| 失败 case drawer | `<CaseDetailDrawer>` 实现 | ✅ |
| GET `/api/dev/benchmark-runs` 列表 | `useEffect → fetch("/api/dev/benchmark-runs")` | ✅ |

### § 6 Mock profile-gap-flow

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| 左 chat / 右 inspector 双面板 | `app/dev/profile-gap-flow/page.tsx` 981 行 | ✅ |
| `apply_profile_patch` dispatch | `mock-pipeline.ts` 用 real `coerceIntentState` + `routeIntent` | ✅ |
| ProfileGapCard 在缺字段时 inline 出现 | mock 流程触发 `needs_profile_data` → 渲染 `<ProfileGapCard>` | ✅ |

### § 7 Decision Room regression

| Spec 期望 | 源码实际 | 状态 |
|---|---|---|
| Multi-member 邀请 + chat | `app/rooms/[id]/page.tsx` 已有功能（已在 master 长期） | ✅ 未深入 audit（regression 区域） |

---

## 我建议 codex 在 walkthrough 时怎么用这份 audit

1. 跑到任何一步发现 UI 跟 PHASE_1_FOUNDER_E2E.md 期望不符 → 先查这份 audit 表
2. 如果是**Finding 1-4** → spec 写错，**不是 bug**。我会修 spec
3. 如果是**Finding 5** → 真 bug，codex 加 `updateTravelTaskState(taskId, "cancelled")` 到 cancel route
4. 如果发现新的偏差不在这份 audit 里 → 是潜在 bug，按 PHASE_1_FOUNDER_E2E.md § 8 模板记下来

---

## Claude 后续要做的事（codex E2E 跑完之后）

| Item | 时间 | 优先级 |
|---|---|---|
| 修 PHASE_1_FOUNDER_E2E.md：Finding 1, 2, 3, 4 | ~10 分钟 | 等 codex E2E 反馈后再动（避免改一半 codex 又报新 bug） |
| 修 `app/dev/page.tsx` STRATEGY_DOCS 链接（Finding 1）→ master | ~3 分钟 | 同上 |
| Phase 1 #7 spec（PHASE_1_7_SPEC.md）— 本轮 B 阶段产出 | ~15 分钟 | 进行中 |
| Phase 1 #7 implementation | ~30 分钟 | 等用户/codex 拍板后开新 branch |

---

## 引用源文件（codex 复核可直接 grep）

- `app/tasks/[taskId]/page.tsx` — DEMO_TASKS / STATE_LABEL / Body / handleCancel
- `app/dev/page.tsx` — STRATEGY_DOCS 链接
- `app/api/v1/users/me/profile/route.ts` — 只 PATCH
- `app/api/v1/execution-jobs/[jobId]/cancel/route.ts` — 删 row 不改 state
- `lib/profile-patch.ts` — parseProfilePatch / PAYMENT_FIELDS
- `lib/core/tasks/task-store.ts:14` — TravelTaskState 含 "cancelled" 但无人使用
- `app/page.tsx:4291` — homepage 仍用 InlineBookingProfileGate（Phase 1 #7 待做的证据）
