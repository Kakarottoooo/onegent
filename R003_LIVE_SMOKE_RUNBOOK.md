# R-003 Live Smoke Runbook — checklist before burning OpenAI tokens

> **For**: codex（执行人）+ founder（监督）
> **Last updated**: 2026-05-03 (Phase 0A 第 3 次 R-003 live smoke 前)
> **作者**: Claude (Track B); codex 拍板 spec + 实际跑

---

## ⚠️ Step 0 (added 2026-05-04): probe-first, then read this runbook

The 2026-05-04 R-003 live retry returned `no_availability_correct` — Resy
served zero slots for the fixture's date/time. **A no-slots case cannot
validate Resy fill/OTP closure**, so the next live token must be spent on
a case the probe says has real matching slots.

Before reading § 0–§ 2 below:
1. Run the cheap availability probe (codex domain):
   `npm run probe:resy`  *(or `-- --case R-030` for a single case, ~10s)*
2. Open `http://localhost:3000/dev/resy-probe-runs` and find a case with
   verdict `use_for_live_fill_test` (the dashboard label is "Live OK").
3. Click "Detail →" on that case to verify exact venue match and that at
   least one slot has `Δ min = 0` (exact requested time bookable).
4. Use the dashboard's copy-paste command. The `--case` flag points at the
   `use_for_live_fill_test` case, not necessarily R-003.

Latest probe finding (2026-05-04): R-030 Charlie Bird 2026-05-08 20:00
party 2 has 12 matching slots — that's the recommended next live target,
not R-003.

Full protocol: `RESY_AVAILABILITY_PROBE_PROTOCOL.md`. Skip Step 0 and you
risk burning the token on another `no_availability_correct` outcome.

---

## 这个文档存在的理由

R-003 live smoke 一次跑会烧 OpenAI tokens（`gpt-5.5` Computer Use turn 数 × 上下文）。
前两次（`a0ce2ee` navigation drift + `2cbddfc` time-ladder timeout）证明：
**没 checklist 就直接跑会浪费 token 在已知问题上**。

这是个静态前置检查清单，目的是：
1. 确认所有 no-token 检查都通过 → 不在已修过的代码上重跑
2. 确认 OpenAI key / budget / model 都对 → 不在错的 model 上跑
3. 标准化预期 outcome → 跑出来 immediately 知道是 success / soft-handoff / 真 bug
4. 明确哪些情况 STOP 不要继续烧 token

---

## 0. 预置条件 — 都必须 ✅ 才允许进入 § 2 跑 live

### 0.1 Phase 0A 状态
- [ ] 上一次 R-003 live smoke commit hash 已在 `BENCHMARK_RESTAURANT_100.md` § 4 记录
- [ ] 上一次 smoke 抓到的问题已 fix 并合 master
- [ ] 没有"上次没修完的 known issue 被忽略"
- [ ] codex 在 `.coordination/codex.md` § 🟢 Currently doing 标 "running R-003 live smoke #N"，避免 Claude 同时改 NLU/UI 制造 race

### 0.2 Token / Budget / Auth
- [ ] OpenAI account billing 没欠费（用户消息：2026-04-27 "OpenAI credit 已恢复"）
- [ ] OpenAI API key in env (`.env.local` 或 Railway worker env)
- [ ] **Model allowlist**: 当前唯一允许的 model 是 `gpt-5.5`（Computer Use GA）—— 不要 fallback 到 `gpt-4o` / `gpt-4-turbo`
- [ ] 当前本地路径不依赖 Browserbase：Next API 创建 task，local worker claim job，Computer Use 使用本地 Playwright context。只有显式切回 Browserbase 时才检查 Browserbase billing。
- [ ] 已人工确认本次只跑单 case。当前 runner 没有实现 `OPENAI_BUDGET_USD_PER_RUN` 硬限；成本控制靠 `--case R-003`、`--live-openai`、不传 `--confirm-suite`、8 分钟超时 kill。

### 0.3 Spec / Fixture
- [ ] `BENCHMARK_RESTAURANT_100.md` § 4 R-003 row 当前 expectedOutcomes 包含: `ready_for_confirmation` / `safe_handoff` (含 `F-PROVIDER-OTP`) / `no_availability_correct` (Q11(a) 显式扩)
- [ ] `benchmark/restaurant-resy-phase0.json` R-003 case 的 `start_url` 是 exact venue page（不是 `/search` —— `a0ce2ee` 修的）
- [ ] `benchmark/restaurant-resy-phase0.json` R-003 没有强约束 visual time ladder（`2cbddfc` 修的）
- [ ] § 7.5 OTP transitional rule 在生效（如果撞 OTP，`F-PROVIDER-OTP` per-case 是 acceptable，不算 fail）

---

## 1. 前置 no-token 检查（必须全过才能跑 live）

每条都跑过且 0 错误才允许进 § 2。

### 1.1 静态 + drift
```bash
npx tsc --noEmit --pretty false
npm run check-drift
```
**期望**: 都返回 exit 0 + 0 错误。

### 1.2 vitest target suite
```bash
npx vitest run \
  lib/__tests__/profile-gap-decision.test.ts \
  lib/__tests__/profile-gap-on-save.test.ts \
  components/profile-gap \
  components/benchmark \
  components/task-timeline \
  lib/agent/nlu-v2
```
**期望**: ≥ 350 passed / 0 failed（codex `f423b56` 时 baseline 350 passed / 6 skipped）。

### 1.3 Phase 1 founder smoke
```bash
# Terminal A: 起 Next dev server
# Codex detached worktree 里 Turbopack 可能因 symlinked node_modules panic，优先用 webpack。
npx next dev --webpack > ./dev.log 2>&1

# Terminal B: 起 local worker（restaurant 当前被 USE_WORKER_FOR 路由到 worker）
cd worker
npm run dev > ../worker.log 2>&1

# 一次性安装 chromium（如果 smoke 报 missing browser）
npx playwright install chromium

# 跑 6-route smoke
npm run smoke:phase1
```
**期望**: `All 6 routes passed.` + exit 0。

### 1.4 Resy adapter unit tests（如果 codex 有动 `lib/booking-autopilot/providers/resy-com.ts`）
```bash
npx vitest run lib/booking-autopilot
```
**期望**: 全过。如果 fail → 不要跑 live，先修。

### 1.5 Worker 状态
- [ ] worker 没有 stuck job（`SELECT * FROM booking_jobs WHERE status IN ('running','queued') AND updated_at < now() - interval '10 minutes'` 应返回 0 行）
- [ ] worker 进程还活着（如果跑 local worker）OR Railway worker 正常（如果未来部署）

---

## 2. 单 R-003 live 执行

### 2.1 实际命令（single-case）
```bash
# Terminal C: 严格 single-case。不要传 --confirm-suite；它只用于 multi-case suite。
npx tsx scripts/run-phase0-resy-benchmark.ts \
  --case R-003 \
  --live-openai \
  --allow-failures
```

The runner writes a report under `benchmark/runs/` automatically for non-dry runs. It currently has no `--output` flag.

### 2.2 跑之前再确认一次
- [ ] 不是 25-case suite（**禁止**：见 § 4）
- [ ] 不是多 case 跑
- [ ] 不是 dry-run（这是 real live）
- [ ] log 落盘，不只 stdout（事后 audit 用）
- [ ] Terminal A + B 都在跑；如果 worker 没起，task 会停在 queued / waiting executor，不要误判为 CU failure。

### 2.3 跑期间监控
- 浏览器 dev console 没报红
- worker.log / dev.log 没 stack trace
- local worker 有 claim job log；任务 timeline 有 execution events
- 单 case 不应跑超 8 分钟；超时立即 kill

---

## 3. 预期 outcome 分类 — 跑完看哪条

### 3.1 ✅ ready_for_confirmation （理想情况）
- Resy 把 R-003 推到了 `ready_for_confirmation` 状态
- 用户一键 confirm 就能下单
- 这是 happy path；记录 4-metric gate 数据
- **下一步**: 先跑 Resy 5-case subset，再决定是否进 25-case suite。

### 3.2 ✅ safe_handoff w/ F-PROVIDER-OTP （§ 7.5 transitional acceptable）
- Resy 卡 OTP wall（用户邮箱 / SMS code）
- Outcome bucket = `safe_handoff`，failure taxonomy = `F-PROVIDER-OTP`
- 按 § 7.5 transitional rule，per-case 是 acceptable，**suite-level 4-metric gate 仍要通过**
- **下一步**: 启动 warm session PoC（`WARM_SESSION_STRATEGY.md` 3-step plan）

### 3.3 ✅ no_availability_correct （Q11(a) 显式扩）
- R-003 venue 那个时间点真没位
- Computer Use 正确读出 "no availability" 并返回
- 这是 spec 里显式接受的 outcome（不是所有 stable case 都默认接受的语义）
- **下一步**: 选 fixture 里的另一个 stable Resy case 验 happy path。

### 3.4 ❌ 任何其他 outcome（real bug）
- `failed` with terminal reason ≠ OTP / no-availability
- `awaiting_login` 卡住 > 5 min
- Computer Use 走错 venue（exact-venue repair regression）
- Time ladder visual loop（`2cbddfc` regression）
- worker 抢 job 后 crash
- **下一步**: STOP。不要重跑同一 case。先 audit log + reproduce + fix + 进 § 1 重新走一遍 checklist。

---

## 4. ⛔ 禁止动作 — 即使诱惑再大也不许做

| 禁止 | 理由 |
|---|---|
| 25-case suite 跑（除非 R-003 ✅ + warm session PoC ✅）| 单 case 没过 25-case 烧的就是 25× R-003 token |
| 同一 case 短时间内重跑 ≥ 3 次 | 大概率是同一个 bug；多跑 = 多烧 token；看 log 就好 |
| 跑非 R-003 case 之前 R-003 没 ✅ | 其他 fixture case 在不同 venue + availability 状态下；R-003 是 baseline |
| 用 `gpt-4o` / `gpt-4-turbo` 替代 `gpt-5.5` | Computer Use 行为差异；不是 spec 范围内 model |
| 不带 `--confirm-suite` 跑 multi-case | token guard 这层就是为了防意外多跑 |
| 跑 live 时同时改 master 上 NLU / executor 代码 | race condition 制造，事后 attribution 会乱 |
| 把 R-003 fixture 临时改宽过 OTP 然后跑 | 等于绕过 spec；spec 改要走 doc PR |

---

## 5. 跑完之后

### 5.1 文档更新
- 在 `BENCHMARK_RESTAURANT_100.md` § 4 R-003 行加一条 history entry: `2026-MM-DD live smoke #N: <outcome bucket> · commit <sha>`
- 更新 `.coordination/codex.md` § 📦 Recently shipped + § 🟢 Currently doing
- 如果撞 OTP → 更新 `WARM_SESSION_STRATEGY.md` 状态（从 BLOCKED → in-flight PoC）

### 5.2 Push artifacts
- `benchmark/runs/R003-live-${TIMESTAMP}.json` commit 到 master（codex domain；不算入 drift）
- 如果跑出 bug fix → 单独 commit + push

### 5.3 通知 Claude（这边）
codex 在 `.coordination/codex.md` 的 § 📩 Acks 段加一行 → Claude session-start 看到就 update `.coordination/claude.md` 把对应 blocker 划掉。

---

## 6. 失败排查快速对照

| 症状 | 最可能原因 | 修法 |
|---|---|---|
| Computer Use 走错 venue | exact-venue URL drift regression | check `start_url` in fixture 是否是完整 venue page |
| 单 case > 8 分钟 | visual time ladder loop OR network stall | kill；audit log；可能 `2cbddfc` 的 fix 没生效 |
| 卡 OTP（Resy 弹码框）| § 7.5 transitional acceptable；per-case OK | record `F-PROVIDER-OTP`；启动 warm session PoC |
| worker race / stuck job | 跑期间有人改 worker code OR Neon 连接断 | check worker.log；rollback 改动；retry |
| OpenAI 4xx/5xx | key 失效 / billing / model 不对 | 检查 § 0.2 |
| task 一直 queued | local worker 没起，或 worker env 没加载 | 启 `cd worker; npm run dev`，检查 `worker.log` claim 行 |

---

## 7. 关联文档

- `BENCHMARK_RESTAURANT_100.md` — Phase 0 spec（§ 4 R-003 row + § 7.5 OTP rule + § 7.2 acceptance gate）
- `WARM_SESSION_STRATEGY.md` — OTP path D 的 PoC（撞 OTP 后启动）
- `EXECUTOR_V2_PIVOT.md` — Computer Use 为什么是 default executor
- `PHASE_STATUS.md` — Phase 0A / 0B / 1 状态总览（这个 runbook 服务 0A 的 R-003 #3）
- `PHASE_1_E2E_SMOKE.md` — § 1.3 用到的 smoke 命令
- `.coordination/codex.md` — codex live state（跑前后写）
- `.coordination/claude.md` — Claude 这边对 codex 跑结果的 ack
