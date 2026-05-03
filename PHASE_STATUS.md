# Phase Status — single-source overview

> **For**: founder · codex · Claude — quick read before any planning conversation
> **Last updated**: 2026-05-03 (post Phase 1 path B hardening + smoke harness)
> **Maintained by**: Claude (Track B), with codex sign-off on Phase 0 / 0B / executor / auth rows
> **Read this after**: `.coordination/{codex,claude}.md` (live state) and `PROJECT_SUMMARY.md` (long-form narrative)

---

## TL;DR

> **当前不进入 Phase 2**。先闭环 Phase 0 (R-003 live smoke + warm session) 和 Phase 1 (founder E2E walkthrough)，再开 Phase 0B (Resy 5→25 case + OpenTable v1 coverage)。Phase 2 vertical 扩张要等 Phase 0B 完成。

```
[Phase 0A] Resy + Computer Use 闭环          ████████░░  ~85%   ←— in flight
[Phase 0B] Restaurant v1 (Resy 25 + OT)     ░░░░░░░░░░    0%   ←— gated by 0A
[Phase 1]  First paying user 端到端           █████████░  ~95%   ←— founder E2E pending
[Phase 1.5] UX polish from founder E2E       ░░░░░░░░░░    0%   ←— catch-all bucket
[Phase 2]  Vertical expansion (Hotel/Flight)  ░░░░░░░░░░    0%   ←— FROZEN until 0B+1 closed
[Phase 3]  Inspire / B2B / marketplace        ░░░░░░░░░░    0%   ←— deferred
[Phase 4]  Data flywheel + Browserbase Pro   ░░░░░░░░░░    0%   ←— trigger ≥500 paying
[Phase 5]  Self-built browser farm            ░░░░░░░░░░    0%   ←— trigger ≥$1500/mo or seed
```

---

## Phase definitions

| Phase | 名字 | What "done" means | Est calendar |
|---|---|---|---|
| **0A** | Resy + Computer Use | 1 R-003 live smoke 不烧 OTP token + 4-metric gate 在 spec 范围内 OK | days |
| **0B** | Restaurant v1 | Resy 5-case → 25-case 都过 + OpenTable parallel coverage（OpenTable Phase 0） | 2-3 weeks |
| **1** | First paying user | Founder 完整跑 `homepage chat → /tasks/[taskId] → ready_for_confirmation → 一键 confirm`，cookie-auth 全程 | days |
| **1.5** | Polish | Phase 1 founder E2E 暴露的 UX gap 集合（迟到 ticket 桶）| as needed |
| **2** | Vertical expansion | OpenTable Phase 0 + Booking.com hotel + Expedia hotel + Flights + Activities | 3-4 months |
| **3** | Inspire / marketplace | Daydream Explorer + 30-template gallery + ChatGPT Apps / claude.ai listing + B2B Lane C cold outreach | quarters |
| **4** | Data flywheel | Layer A + B 上线; Browserbase Pro upgrade; ≥100 real bookings 飞轮启动 | quarter+ |
| **5** | Scale infra | Self-hosted browser farm; replaces Browserbase 长期成本 | seed-funded |

---

## Phase 0A — Resy + Computer Use (~85%)

**Doctrine** (locked 2026-05-02): Resy 单 vendor + Computer Use (gpt-5.5 GA) 端到端闭环。1 个 vendor 闭环够才扩 OpenTable，避免 N 平台 N 状态机 in-flight 同步崩。

**已完成** (verbatim from `origin/master:.coordination/codex.md`)
- ✅ Computer Use GA 接入 `lib/execution-v2/` 路径 (codex `620444a`)
- ✅ R-003 smoke #1: navigation drift fix (codex `a0ce2ee`) — exact venue URL
- ✅ R-003 smoke #2: timeout fix (codex `2cbddfc`) — visual time ladder 收敛
- ✅ § 7.5 OTP transitional rule 写入 spec
- ✅ Q11 R-003 expectedOutcomes 显式扩 `no_availability_correct`（option a）
- ✅ Token 守卫: `--live-openai` + `--confirm-suite` 双层
- ✅ Resy fixture 完整：`benchmark/restaurant-resy-phase0.json` 5 cases × R-001 ~ R-005

**未完成**
- ⏳ R-003 smoke #3 live 运行（pending codex go-decision）
- ⏳ Warm session PoC（blocked — 还没有 Resy case 真撞到 OTP wall；R-003 #3 跑出来再决定）
- ⏳ 25-case suite 跑（**严格 gated**：只有 R-003 #3 通过 + warm session PoC 完成才允许）

**下一步 owner**：codex

**进入 Phase 0B 的门**: R-003 #3 通过 + (warm session PoC ✅ 或 OTP soft-handoff per § 7.5)。

---

## Phase 0B — Restaurant v1 (0%, gated)

**Goal**: Resy 完整 25-case ≥ 80% booking-ready + OpenTable Phase 0 同样标准。这是声明 "Restaurant 这个 vertical 真的可用" 的门。

**已完成**: 无（gated by 0A）

**未完成**:
- Resy 5 case (R-001 ~ R-005) 单跑通过
- Resy 25 case suite 通过 4-metric gate (≥80% booking-ready / ≥95% safe-outcome / =0 severe / 100% taxonomy)
- OpenTable Phase 0 spec 写出来（mirror BENCHMARK_RESTAURANT_100.md 格式）
- OpenTable benchmark fixture（25 cases）
- OpenTable adapter 在 `lib/booking-autopilot/providers/opentable-com.ts` 跑通基线

**下一步 owner**：codex（spec + adapter + benchmark），Claude（observability dashboard 适配）

**进入 Phase 1 是 Phase 0B 的并行支线** — Phase 1 不依赖 0B（founder 用 R-003 单 case 验真），但 0B 完成后才有"Restaurant vertical declared"的资格。

---

## Phase 1 — First paying user (~95%)

**Goal**: 真用户在 production，cookie-auth 全程，跑通 `chat → /tasks/[taskId] → ProfileGapCard 内联 → ready_for_confirmation → 一键 confirm`。

**已完成**:
- ✅ #1 Master typecheck cleanup — codex `3c95561`
- ✅ #2 PATCH `/api/v1/users/me/profile` 端点 (cookie + API key) — codex `48c80b2`
- ✅ #3 Cookie-auth proxy `/api/v1/*` — codex `48c80b2`
- ✅ #4 Track B Phase 1 UI merge — codex `c2be764`
- ✅ #6 `/tasks/[taskId]` real API wire — Claude `e098252`
- ✅ #7 ProfileGapCard 接入 homepage chat
  - Path A `apply_profile_patch` 中流 dispatcher — `8500af3`
  - Path B inline ProfileGapCard 替代 modal — `4cdaa36`
  - Codex safety fix `dispatchProfilePatch → Promise<boolean>` 阻断失败下的 booking resume
  - Path B hardening: 抽出 `lib/profile-gap-decision.ts` + `lib/profile-gap-on-save.ts` + 19 tests + `/dev/path-b-demo` — `f423b56`
- ✅ Q15 `payload.profile_gap` 服务端发出 — `7289ba0`
- ✅ Audit Finding 5: cancel 更新 `task.state` — `7289ba0`
- ✅ no-token founder smoke harness `npm run smoke:phase1` — `f9dd0ba`

**未完成**:
- ⏳ #8 Founder E2E walkthrough（60-90 分钟手动；用户自跑；用 `PHASE_1_FOUNDER_E2E.md` 作 checklist + `npm run smoke:phase1` 作 30 秒 preflight）
- ⏸ #5 OTP resume — conditional：只在 Phase 0A warm session 失败 + 选 path C（Gmail OTP resume fallback）时触发

**下一步 owner**：用户（founder E2E）；codex（如果 #5 fires）

---

## Phase 1.5 — Polish bucket (0%, lazy)

**Goal**: founder E2E 暴露的所有"不是 blocker 但烦人"的 UX gap 都进这个桶。每个 ≤ 1 day 工作量。

**Process**: founder 在 walkthrough 时记 bug，每条进 `PHASE_1_FOUNDER_E2E.md` § 8 bug 模板。Phase 1 declared 后批量处理。

---

## Phase 2 — Vertical expansion (0%, FROZEN)

**Status**: ❄️ FROZEN until Phase 0B + Phase 1 都 declared。不允许任何 vertical 实现代码 leak 到 master。

**Scope when unfrozen** (estimated 3-4 months):
- OpenTable Phase 0 — Phase 0B 已经预热; 真扩到 vertical-declared 还要 2 weeks
- Booking.com hotel — 2-3 weeks
- Expedia hotel — 1 week (cribs Booking 模式)
- Flights (DOB / passport / KTN 复杂) — 3-4 weeks
- Activities — 1 week

---

## Phase 3 — Inspire / B2B / marketplace (0%, deferred)

**Scope when opened**:
- Daydream Explorer + 30-template gallery (NOT LLM-free-form — locked decision)
- Newsletter / HN / PH launch
- ChatGPT Apps + claude.ai marketplace 优先 listing
- B2B Lane C cold outreach (cofounder agent / B2B integrator)
- Subscription gamification (referral / payer 折扣 / credit)

---

## Phase 4 — Data flywheel + infra (0%, trigger-gated)

**Trigger**: ≥ 100 real bookings OR ≥ 500 paying users OR ≥ $1500/mo Browserbase bill OR cofounder OR seed round。

**Scope**:
- Layer A 飞轮: 场馆 / Provider 健康度 (days-weeks TTL) ✅ 设计已锁
- Layer B: provider 短时态 (5-15 min TTL) ✅ 设计已锁
- Layer C live availability ❌ 显式不做（5 min volatility + per-device fingerprint + stale-cache-worse-than-no-cache）
- Browserbase Pro upgrade

---

## Phase 5 — Self-hosted browser farm (0%, seed-gated)

**Trigger**: seed round closed AND Browserbase Pro 月单 > $5k。

**Scope**: 自建 Chromium pool / queue / cookie store 取代 Browserbase。这个工作量 ≈ 1.5 quarter，需要 dedicated infra eng。

---

## Cross-phase 锁定决策

| 决策 | Phase | 锁定来源 |
|---|---|---|
| Computer Use 是 default executor | 0+ | `EXECUTOR_V2_PIVOT.md` |
| 不引入 3rd-party browser-agent (MultiOn / Skyvern / browser-use) | 全部 | chat decision 2026-05-02 |
| Hybrid positioning (NOT pure-infra, NOT pure-consumer) | 2-3 | `PROJECT_SUMMARY.md` cont. 2 |
| Inspire mode 30-template gallery (NOT LLM-free-form) | 3 | chat decision 2026-05-02 |
| Data flywheel: A + B 做; C 不做 | 4 | chat decision 2026-05-02 |
| Stripe live key swap deferred | 2+ | `PHASE_1_PLAN.md` § R5 |
| 协作协议 via `.coordination/{codex,claude}.md` | 全部 | `CLAUDE.md` § 协作协议 |
| Branch hygiene: 每个 task 从最新 origin/master 起新 branch | 全部 | `origin/master:.coordination/codex.md` 2026-05-03 |

---

## 关联文档

- **Live state**: `.coordination/{codex,claude}.md`
- **Phase 0 spec**: `BENCHMARK_RESTAURANT_100.md` (含 § 7.5 OTP transitional)
- **Phase 1 plan**: `PHASE_1_PLAN.md`
- **Founder E2E**: `PHASE_1_FOUNDER_E2E.md`
- **Smoke harness**: `PHASE_1_E2E_SMOKE.md`
- **R-003 live runbook**: `R003_LIVE_SMOKE_RUNBOOK.md`
- **UI migration**: `UI_MIGRATION_MAP.md`
- **OTP path D**: `WARM_SESSION_STRATEGY.md`
- **Executor pivot**: `EXECUTOR_V2_PIVOT.md`
- **NLU contract**: `NLU_CONSUMER_CONTRACT.md`
- **Long-form narrative**: `PROJECT_SUMMARY.md` (含 cont. 1/2/3 战略锁定)
