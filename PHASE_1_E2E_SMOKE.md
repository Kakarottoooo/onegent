# Phase 1 — E2E smoke (no-token, no live API)

> **For**: codex / Claude / CI / founder pre-walkthrough
> **作者**: Claude (Track B)
> **状态**: ✅ live on master via `scripts/smoke-phase1.mjs`
> **预计耗时**: ~10 秒（headless chromium 串行 6 路由）

这是 `PHASE_1_FOUNDER_E2E.md` 12 段手动 walkthrough 的 **render-level 自动 smoke**。
目的不是替代手动 walkthrough（那个查 UX 质感、bug、复杂交互），而是：

1. 每次 codex merge 前 **2 秒确认核心 surface 没崩** —— 比手动开 6 个 tab 快得多。
2. **零 token、零外部网络、零数据库副作用** —— 全部 fixture-backed，跑 100 次也不花钱。
3. 给 founder walkthrough 一个 **预热 gate** —— smoke 红就别浪费 60 分钟手动跑。

---

## 一句话 runbook

```bash
# Terminal 1 —— 起 dev server（如果还没起）
npm run dev > ./dev.log 2>&1

# Terminal 2 —— 跑 smoke（约 10 秒）
npm run smoke:phase1
```

**输出格式**:

```
Phase 1 founder walkthrough smoke
  Base URL : http://localhost:3000
  Routes   : 6

✓ Dev server alive (200)

  /dev/path-b-demo                           PASS  (842ms)
  /tasks/demo-executing                      PASS  (605ms)
  /tasks/demo-awaiting-profile               PASS  (612ms)
  /tasks/demo-ready-for-confirmation         PASS  (598ms)
  /dev/benchmark-runs                        PASS  (901ms)
  /dev/profile-gap-flow                      PASS  (677ms)

All 6 routes passed.
```

退出码：`0`=全过 / `1`=有 route 失败 / `2`=dev server 没起 / `3`=chromium 没装。

---

## 覆盖范围

| Route | 校验内容 | 对应 founder walkthrough |
|---|---|---|
| `/dev/path-b-demo` | h1 + 三个 state chip 文案 | § 6 mock 预演 / Path B hardening |
| `/tasks/demo-executing` | h1 + state pill `Running` + 任务 meta | § 2.1 |
| `/tasks/demo-awaiting-profile` | h1 + state pill `Need details` + ProfileGapCard 触发 | § 2.2 |
| `/tasks/demo-ready-for-confirmation` | h1 + state pill `Ready to confirm` | § 2.4 |
| `/dev/benchmark-runs` | h1 "Phase 0 benchmark runs" + "Phase 0 acceptance gate" | § 5 |
| `/dev/profile-gap-flow` | h1 + preset chip 文案 | § 6 |

每个 route 至少断言 **2-3 条稳定文本**（来自 fixture/常量，不是 brittle CSS selector）。

---

## 设计选择

### 为什么是 bare playwright，不是 @playwright/test

- `playwright@^1.58.2` 已经在 root `dependencies`（worker booking-autopilot 用）。
- 加 `@playwright/test` 等于多 ~30 MB devDep，换的好处（fixtures / parallel /
  HTML report）对 6 个 route 的 smoke 没有 ROI。
- 如果将来 smoke 路由 > 20，或者要做 visual regression / shard 并发，再升级到框架。

### 为什么不内嵌 dev server 启动

`scripts/smoke-phase1.mjs` 故意不 spawn `next dev`。理由：
1. Next dev server 启动 5-30 秒（取决于 cold/warm cache），smoke 应该是秒级反馈。
2. dev server lifecycle（端口冲突 / HMR / Turbopack）是 Next 自己的复杂度，
   smoke 不应承担。
3. **Codex review 时通常已经在跑 dev server**；让人手动 `npm run dev` 是
   1 行成本 vs. script 内 process 管理是 50 行成本。

如果 dev server 没起，smoke 会用清晰错误退出（exit code 2 + 提示命令）。

### 为什么 console error 过滤了一些

`/dev/benchmark-runs` 在没设 `ENABLE_DEV_BENCHMARK_API=1` 的 prod 环境下
会 fetch 失败；`/tasks/demo-*` 用 fixture 模式但底层依然会有 401 fetch
attempts（cookie-auth proxy 已 ship，但 demo IDs 走 fixture short-circuit）。
这些是 **预期** 的网络噪音，不是页面问题。脚本里有显式 allowlist：

```js
const isExpectedFetchFailure = /Failed to fetch|NetworkError|401|403|ENABLE_DEV_BENCHMARK_API/.test(text);
```

任何 **真正的** React error / hydration mismatch / uncaught exception 不在
这个 allowlist 内 → 会让 route fail。

---

## 预安装要求

第一次跑前需要装 chromium browser binary：

```bash
npx playwright install chromium
```

如果没装，smoke 会用 exit code 3 + 友好提示告诉你跑这条命令。

---

## 失败排查

### `Dev server unreachable` (exit 2)
没起 dev server。`npm run dev` 后再试。如果端口不是 3000，传环境变量：
```bash
SMOKE_BASE_URL=http://localhost:4000 npm run smoke:phase1
```

### `Failed to launch chromium` (exit 3)
跑 `npx playwright install chromium`。

### `missing copy: "Path B fixture explorer"` 等断言失败
两种情况：
1. **页面真坏了** —— 打开浏览器手动看 `http://localhost:3000/dev/path-b-demo`，
   通常立刻能看出问题。
2. **页面文案改了** —— smoke 的 expected string drift。修页面或修 smoke
   `ROUTES[].expects`（通常应该同 commit 改）。

### `console error: ...`
JS 执行错误。优先看：
- React hydration mismatch（client/server 不一致）
- `'use client'` boundary 问题
- 没 mock 的依赖（fetch / window.X）

---

## 关联文档

- `PHASE_1_FOUNDER_E2E.md` —— 完整 60-90 分钟人工 walkthrough（这个 smoke 是它的预热 gate）
- `PHASE_1_PLAN.md` —— Phase 1 整体计划（这个 smoke 属于 #8 founder E2E 的延伸）
- `PHASE_1_7_SPEC.md` —— Path B inline ProfileGapCard 实现 spec（smoke 验证 § 6 / `/dev/path-b-demo`）
- `BENCHMARK_RESTAURANT_100.md` —— Phase 0 acceptance gate（smoke 验证 dashboard 入口 `/dev/benchmark-runs`）

---

## Hold rules（这个 smoke 严格遵守）

- 不调用 OpenAI / Computer Use / Stagehand
- 不调用 `app/api/booking-jobs/[id]/start` / `app/api/v1/execution-jobs/[jobId]/cancel`
- 不写 DB
- 不发 email / SMS
- 不 spawn 任何 booking automation provider
- 不做任何外部网络请求（除了访问本地 dev server）

如果未来要扩 smoke 覆盖到真 backend flow，**新建一个不同名字的 script**
（如 `smoke:phase1-with-backend`），不要污染这个 no-token harness。
