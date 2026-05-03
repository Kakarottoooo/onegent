# R-003 Live Smoke Runbook — checklist before burning OpenAI tokens

> **For**: codex（执行人）+ founder（监督）
> **Last updated**: 2026-05-03 (post codex `d88464e` readiness preflight)
> **Preflight status**: ✅ green per `origin/master:.coordination/codex.md` 2026-05-03 12:30-12:37 UTC
> **作者**: Claude (Track B); codex 拍板 spec + 实际跑

---

## 📍 Readiness state (2026-05-03)

Codex `d88464e [coord] report R-003 readiness preflight` 已确认：

| Check | Result |
|---|---|
| `npx tsc --noEmit --pretty false` | ✅ pass |
| `npm run check-drift` | ✅ pass |
| Targeted vitest (profile-gap-{decision,on-save} + components + nlu-v2) | ✅ 350/356, 6 skipped |
| `npx next dev --webpack` + `npm run smoke:phase1` | ✅ 6/6 routes |
| `npx tsx scripts/run-phase0-resy-benchmark.ts --dry-run --case R-003` | ✅ payload valid, no API call |
| Guard: same script without `--live-openai` / `ONEGENT_ALLOW_LIVE_OPENAI=1` | ✅ refuses before task creation |
| Local env keys | `OPENAI_API_KEY` present · `OPENAI_COMPUTER_USE_MODEL=gpt-5.5` · `USE_WORKER_FOR=restaurant,hotel,flight,activity` |

**含义**: § 0 / § 1 的所有静态项都已验证通过。R-003 #3 live 需要的就剩 § 0.4
worker 启动 + § 2.1 三终端命令。codex 等用户/founder 显式批准烧 token 才会跑。

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
- [ ] `OPENAI_API_KEY` in `.env.local` (codex `d88464e` 已确认本地 worktree 有这个 key)
- [ ] **Model allowlist**: 当前唯一允许的 model 是 `gpt-5.5`（Computer Use GA）—— 不要 fallback 到 `gpt-4o` / `gpt-4-turbo`. codex `d88464e` 已确认 `OPENAI_COMPUTER_USE_MODEL=gpt-5.5`
- [ ] Browserbase key 没欠费（live smoke 跑在 Browserbase session 里）
- [ ] Live spend guard satisfied: 必须传 `--live-openai` flag **或** 设 `ONEGENT_ALLOW_LIVE_OPENAI=1`（codex `d88464e` 验证过：缺这两者会在创建任务前拒绝）

### 0.3 Spec / Fixture
- [ ] `BENCHMARK_RESTAURANT_100.md` § 4 R-003 row 当前 expectedOutcomes 包含: `ready_for_confirmation` / `safe_handoff` (含 `F-PROVIDER-OTP`) / `no_availability_correct` (Q11(a) 显式扩)
- [ ] `benchmark/restaurant-resy-phase0.json` R-003 case 的 `start_url` 是 exact venue page（不是 `/search` —— `a0ce2ee` 修的）
- [ ] `benchmark/restaurant-resy-phase0.json` R-003 没有强约束 visual time ladder（`2cbddfc` 修的）
- [ ] § 7.5 OTP transitional rule 在生效（如果撞 OTP，`F-PROVIDER-OTP` per-case 是 acceptable，不算 fail）

### 0.4 Worker 必须启动 ⚠️ critical

`USE_WORKER_FOR=restaurant,hotel,flight,activity`（per codex `d88464e` 本地 env
观察）。这意味着 R-003 (restaurant) 这条 case 走 **worker 路径**，不是 Vercel
in-process executor。**worker 没起 → 任务会进 booking_jobs 表然后 stuck 等不到
worker 抢，case 会 timeout 掉但 token 已经先消耗在 NLU + planning 阶段**。

- [ ] 单独终端跑 `cd worker; npm run dev`（worker env 从 root `.env.local` 拷贝
      / 同步过去）
- [ ] worker 进程在 stdout 看到 "polling" 或类似已开始抢 job 的迹象
- [ ] `SELECT * FROM booking_jobs WHERE status IN ('running','queued') AND updated_at < now() - interval '10 minutes'` 应返回 0 行（没 stale job）

如果不确定 `USE_WORKER_FOR` 当前值：`grep USE_WORKER_FOR .env.local`。如果
`restaurant` 在列表里 → worker mandatory。如果不在 → 走 Vercel in-process，
worker 可选。

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
# 起 dev server
npm run dev > ./dev.log 2>&1 &

# 装 chromium（一次性）
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
**See § 0.4 — worker is mandatory for restaurant case.** 这里只是再确认一遍：
- [ ] worker 进程在另一个终端 `cd worker; npm run dev` 已启动（不是只有 Next dev server）
- [ ] worker 没有 stuck job（`SELECT * FROM booking_jobs WHERE status IN ('running','queued') AND updated_at < now() - interval '10 minutes'` 应返回 0 行）
- [ ] worker stdout 在轮询 / 抢 job (Railway worker 还没部署，本地 only)
- [ ] root `.env.local` 里的 `OPENAI_API_KEY` / `BROWSERBASE_*` / `POSTGRES_URL` 都被 worker 进程读到了（worker 启动 log 不报 "missing env"）

---

## 2. 单 R-003 live 执行

### 2.1 实际命令 — 三终端并发

Per codex `d88464e` 的 readiness preflight，单 R-003 live run 需要三个终端
**同时**开着：

```bash
# Terminal A — Next dev server (webpack mode 因为 Codex detached worktree
# 里 Turbopack 会撞 symlink panic; 见 PHASE_1_E2E_SMOKE.md "失败排查")
npx next dev --webpack

# Terminal B — local worker (mandatory because USE_WORKER_FOR includes
# 'restaurant'; worker env 从 root .env.local 拷贝/同步)
cd worker
npm run dev

# Terminal C — 真正烧 token 的命令
npx tsx scripts/run-phase0-resy-benchmark.ts \
  --case R-003 \
  --live-openai \
  --allow-failures
```

**重要 flag 语义**:
- `--case R-003` —— 单 case scoping
- `--live-openai` —— 显式同意烧 token；缺这个会被 guard 拒绝
- `--allow-failures` —— 允许 R-003 出 non-success outcome（OTP / no-availability
  都不被视为脚本崩溃）；R-003 spec 在 expectedOutcomes 里就接受三种 outcome
- ⚠️ **不要传 `--confirm-suite`** —— 这个 flag 是 multi-case suite 用的，单 case
  不需要; codex 在 `d88464e` 明确说"Do not pass `--confirm-suite` for single-case
  R-003. Multi-case live runs require both `--live-openai` and `--confirm-suite`."

> **`scripts/run-phase0-resy-benchmark.ts` 是 codex 的 Track A file ownership**;
> 命令以 codex 当前实现为准。如果未来 flag 名变了，codex 直接改这一节。
> Claude 不动这个脚本。

### 2.2 跑之前再确认一次
- [ ] 三终端都在跑（dev / worker / runner）—— § 0.4 + § 1.5 已经验证
- [ ] 不是 25-case suite（**禁止**：见 § 4）
- [ ] 不是多 case 跑
- [ ] 不是 dry-run（这是 real live；如果只想验 payload，跑 `--dry-run --case R-003`，那条不烧 token）
- [ ] log 落盘，不只 stdout（事后 audit 用 — 建议 `2>&1 | tee benchmark/runs/R003-live-$(date +%Y%m%d-%H%M%S).log`）

### 2.3 跑期间监控
- 浏览器 dev console 没报红
- worker.log / dev.log 没 stack trace
- Browserbase session viewer 能看到流量正常
- 单 case 不应跑超 8 分钟；超时立即 kill

---

## 3. 预期 outcome 分类 — 跑完看哪条

### 3.1 ✅ ready_for_confirmation （理想情况）
- Resy 把 R-003 推到了 `ready_for_confirmation` 状态
- 用户一键 confirm 就能下单
- 这是 happy path；记录 4-metric gate 数据
- **下一步**: 进 Phase 0B（5→25 case）

### 3.2 ✅ safe_handoff w/ F-PROVIDER-OTP （§ 7.5 transitional acceptable）
- Resy 卡 OTP wall（用户邮箱 / SMS code）
- Outcome bucket = `safe_handoff`，failure taxonomy = `F-PROVIDER-OTP`
- 按 § 7.5 transitional rule，per-case 是 acceptable，**suite-level 4-metric gate 仍要通过**
- **下一步**: 启动 warm session PoC（`WARM_SESSION_STRATEGY.md` 3-step plan）

### 3.3 ✅ no_availability_correct （Q11(a) 显式扩）
- R-003 venue 那个时间点真没位
- Computer Use 正确读出 "no availability" 并返回
- 这是 spec 里显式接受的 outcome（不是 R-001~R-005 默认 happy path 的语义）
- **下一步**: 选另一个 R-001~R-005 case 验 happy path

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
| 跑非 R-003 case 之前 R-003 没 ✅ | R-001/R-002/R-004/R-005 在不同 venue + provider 状态下；R-003 是 baseline |
| 用 `gpt-4o` / `gpt-4-turbo` 替代 `gpt-5.5` | Computer Use 行为差异；不是 spec 范围内 model |
| 不带 `--confirm-suite` 跑 multi-case | token guard 这层就是为了防意外多跑（注意：单 case **不需要** `--confirm-suite`；只有 multi-case suite 才同时需要 `--live-openai` + `--confirm-suite`）|
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
| Browserbase 拒连 | 会话耗尽 / billing | 检查 Browserbase dashboard |

---

## 7. 关联文档

- `BENCHMARK_RESTAURANT_100.md` — Phase 0 spec（§ 4 R-003 row + § 7.5 OTP rule + § 7.2 acceptance gate）
- `WARM_SESSION_STRATEGY.md` — OTP path D 的 PoC（撞 OTP 后启动）
- `EXECUTOR_V2_PIVOT.md` — Computer Use 为什么是 default executor
- `PHASE_STATUS.md` — Phase 0A / 0B / 1 状态总览（这个 runbook 服务 0A 的 R-003 #3）
- `PHASE_1_E2E_SMOKE.md` — § 1.3 用到的 smoke 命令
- `.coordination/codex.md` — codex live state（跑前后写）
- `.coordination/claude.md` — Claude 这边对 codex 跑结果的 ack
