# UI Migration Map — old surfaces vs new surfaces

> **For**: 用户问"原来的 UI 会不会没用？" + 任何接手代码的人需要知道哪个 UI 还活着、哪个在被淘汰
> **Last updated**: 2026-05-03 (post Phase 1 #7 path B + hardening + smoke harness)
> **作者**: Claude (Track B)

---

## TL;DR

> **没有任何"原来的 UI"被一刀切删除**。Phase 1 是 **加法 + 渐进式淘汰**。
> 旧 UI 要么继续保留（核心入口），要么被新 UI 覆盖后保留 fallback flag，要么明确进入 deprecation 队列。每个 deprecated entry 都有显式删除条件，不是凭感觉砍。

3 类:
- **🟢 保留**: 用户每天看的核心入口；改进但不替换。
- **🔵 演进**: 旧入口存在，但实际被新组件覆盖；保留是为了 feature flag fallback。
- **🟠 淘汰**: 已经没人用 OR 被新方案覆盖；列出删除条件。

---

## 完整对照表

### 🟢 保留 — 用户日常入口，新功能加在旁边不替换

| 表面 | 文件 | 状态 | 改了什么 |
|---|---|---|---|
| **Homepage chat** | `app/page.tsx` | 🟢 保留 | 加了 path A `apply_profile_patch` dispatcher（`8500af3`），加了 path B inline `ProfileGapCard`（`4cdaa36`），底层 NLU v2 + 三层架构（`lib/agent/nlu-v2/`）保持 |
| **Tasks workspace** | `app/tasks/page.tsx` | 🟢 保留 | 列表入口不变；点进去现在是新 `/tasks/[taskId]` 详情页 |
| **Decision Room** | `app/decision-room/[roomId]/page.tsx` 等 | 🟢 保留 | 多人协作 + 私聊 NLU 不变；profile-edit 派发同步走 path A |
| **booking_jobs concept** | DB 模型 + `app/api/booking-jobs/[id]/start` | 🟢 保留 | M5 force-gate 让 worker 优先抢，Vercel in-process 当 fallback；mental model 不变 |
| **Auth shell** | `@clerk/nextjs` middleware + sign-in 页 | 🟢 保留 | 没动 |
| **Subscription / pricing** | Pricing v0.1 | 🟢 保留 | Stripe sandbox 闭环已通；live key 等 Phase 2 触发 |

### 🔵 演进 — 旧组件存在但默认走新路径

| 旧表面 | 新表面 | 切换机制 | 删除条件 |
|---|---|---|---|
| **InlineBookingProfileGate** (modal) `components/booking/InlineBookingProfileGate.tsx` | **ProfileGapCard inline** in `app/page.tsx` chat thread | feature flag `NEXT_PUBLIC_PROFILE_GAP_INLINE` (default `"1"` = ON 走新) | 把 flag 设为强制 ON 一周 + 0 P1 bug → 删 modal 组件 + 删 flag |
| **Raw trace-first timeline** (job audit JSON dump) | **TaskTimelinePanel** (`components/task-timeline/`) — 3-tier defensive loader (SSE → polled JSON → fixture) | `/tasks/[taskId]` 直接渲 TaskTimelinePanel | 旧 trace endpoint 还有 dev/debug 用途；不删 |
| **Job-only mental model** (用户跑的是 "job") | **Travel task** (`travel_tasks` table) — task 1:N booking_jobs | `/tasks/[taskId]` 是 task-first；旧 job UI 还在但是 advanced 入口 | task facade 完整覆盖（已 ship）→ 旧 `/jobs` 入口降为 dev surface |
| **Profile gap 4-field heuristic** (homepage 旧 client check) | **`payload.profile_gap` 服务端 13-field canonical** via `buildProfileGap` | path A + path B 都消费服务端 shape; 客户端 `getMissingBookingFields` 只是 defensive fallback | 客户端 fallback 跑 0 次（grep 监控）一周 → 删除 helper |

### 🟠 淘汰 — 明确进入 deprecation 队列

| 旧表面 | 状态 | 替代 | 删除时机 |
|---|---|---|---|
| **`InlineBookingProfileGate` modal** | 🟠 deprecated 2026-05-03 | path B inline `ProfileGapCard` | Phase 1.5（feature flag 强制 ON 验证一周后）|
| **Path A 后旧的"等用户进 settings 改 profile"流程** | 🟠 deprecated（NLU 中流抓取替代） | path A `apply_profile_patch` | 用户行为数据证明 0 流量 → 删 |
| **`getMissingBookingFields` 4-field 兜底** (`app/page.tsx:1806-1813`) | 🟠 deprecated（仅作 defensive） | 服务端 `buildProfileGap` 13-field via `payload.profile_gap` | 客户端 fallback path 零调用一周 → 删 |
| **legacy `app/dev/profile-gap-demo` schema reference** | 🟢 保留（参考用） | — | 作为 contract reference 长期保留 |

---

## 新表面 — Phase 1 期间新增

这些不是替代品，是从无到有的新 UI。founder 之前没看过。

| 表面 | 文件 | 用途 | Phase 1 状态 |
|---|---|---|---|
| **`/tasks/[taskId]`** | `app/tasks/[taskId]/page.tsx` | 单 task 详情：timeline + side rail + ProfileGapCard inline | ✅ shipped |
| **TaskTimelinePanel** | `components/task-timeline/` | 任务生命周期事件 + snapshot rail + 3-tier defensive loader | ✅ shipped |
| **dr-timeline 多任务视图** | `components/dr-timeline/` | Decision Room 协调多 member booking 的 timeline | ✅ shipped (mock) |
| **ProfileGapCard** | `components/profile-gap/` | 13 canonical 字段 + legacy / UI-only / payment legend + 31 tests | ✅ shipped |
| **Benchmark dashboard `/dev/benchmark-runs`** | `app/dev/benchmark-runs/page.tsx` + `components/benchmark/` | Phase 0 acceptance gate live console + Validator + GateBreakdown | ✅ shipped |
| **/dev landing index** | `app/dev/page.tsx` | 所有 dev surfaces 索引；canonical strategy docs 链接 | ✅ shipped |
| **/dev/profile-gap-flow** | `app/dev/profile-gap-flow/page.tsx` | apply_profile_patch + confirm-card 的 mock chat pipeline | ✅ shipped |
| **/dev/path-b-demo** | `app/dev/path-b-demo/page.tsx` | Path B 三态 fixture explorer (helpers 复用 prod) | ✅ shipped (`f423b56`) |
| **/dev/timeline-demo** + **/dev/dr-timeline-demo** | `app/dev/*-demo/page.tsx` | TaskTimelinePanel + dr-timeline mock fixture | ✅ shipped |
| **`scripts/smoke-phase1.mjs`** | `scripts/` | no-token 自动 smoke 6 routes | ✅ shipped (`f9dd0ba`) |

---

## 用户角度的迁移叙事

> **"我以前用的 UI 现在哪去了？"**

1. **Homepage chat** —— 还在原地。你看到的额外是：
   - 中流改 profile 不用退出聊天（path A）
   - 下单需要补字段时直接在聊天里弹卡片（path B），不再弹 modal
2. **任务列表** —— 还在 `/tasks`。点进去现在是个新页面，能看到事件流 + 状态徽章 + Cancel 按钮，不是 raw JSON。
3. **Profile 设置** —— 还在 `/settings`（保留）。但你大概率不会主动去那里——chat 里说 "save my DOB 1995/05/15" 就够了。
4. **Decision Room** —— 完全保持。多人协作的私聊 NLU 走相同的 NLU v2 管道，行为一致。
5. **Booking-jobs / 高级 debug** —— 还在但是 dev 入口。底层 worker 抢任务模型不变，UI 层抽象成 travel task。

> **"会不会有一天我打开链接发现旧页面 404？"**

不会。每个 deprecation 入口都有显式条件 + 一周 zero-traffic 观察期 + 替代品验证；删除是 last step。Phase 1.5 才会真删第一批（首批候选: `InlineBookingProfileGate` modal）。

---

## 给 codex / Claude 的执行规则

### 加新 UI 时
- 不删除旧 UI，加在旁边
- 加 feature flag 默认 ON 走新（OFF fallback 旧），保留至少一周
- 在这个文档表格加一行 🔵 演进 entry

### 想删旧 UI 时
- 必须先在这个文档表格找到对应 🟠 deprecated entry
- 必须满足列出的删除条件（feature flag 验证 / 流量数据 / 时间窗口）
- 删除 PR 必须更新这张表 → 把 entry 移到 "已删除" 区段（下面留空，未来增）

### 没列在这张表里的旧 UI 想删时
- 先来这张表加 🟠 entry + 删除条件
- 等到条件满足再删

---

## 已删除

> 占位区段。等第一个真删除发生时把对应 🟠 entry 搬到这里。

(none yet)

---

## 关联文档

- `PHASE_STATUS.md` — phase 总览（这个 map 是 Phase 1 的 supporting doc）
- `PHASE_1_PLAN.md` — Phase 1 deliverables 清单
- `PHASE_1_7_SPEC.md` — Path A + Path B 实施 spec（"为什么 ProfileGapCard 替代 modal"）
- `PHASE_1_FOUNDER_E2E.md` — 12 段手动 walkthrough（每段都标了"看的是什么 UI"）
- `NLU_CONSUMER_CONTRACT.md` — homepage chat 的 NLU 接入契约
- `EXECUTOR_V2_PIVOT.md` — 后端 executor 演进（不直接影响 UI 但 task facade 是它的产物）
