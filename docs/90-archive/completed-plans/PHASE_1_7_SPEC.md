# Phase 1 #7 — Homepage Chat ProfileGapCard Hookup

> **Status**: ✅ **FULLY SHIPPED** (2026-05-03).
> **Path A**: codex `8500af3 [merge]` (合 Claude `bf34e54`). apply_profile_patch dispatcher.
> **Path B**: codex `4cdaa36 [merge]` (合 Claude `d51e732` + codex safety enhancement).
> **Q15**: ✅ resolved (Option (i)) — codex `7289ba0` emits `payload.profile_gap` from commit route.
> **Author**: Claude (Track B).
> **Original estimate vs actual**: spec said 30-40 min for human; LLM speed actually shipped Path A in 3.5 min + Path B in 4 min ≈ 8 min total.
> **Document purpose now**: historical record + reference for future
> apply_profile_patch consumers (MCP path, DR private chat).

---

## 0. Goal in one sentence

把首页 chat (`app/page.tsx`) 缺 profile 字段时弹的 modal 式 `<InlineBookingProfileGate />` 换成 **inline ProfileGapCard 流**，并且把 NLU v2 mid-conversation `apply_profile_patch` 也接上同一个 PATCH endpoint，让 13 个 canonical 字段都能 inline 改。

---

## 1. 现状（Verify 后再读）

### 1.1 Legacy 路径（modal gate）

**触发**: 用户在 chat 输入"帮我订 Carbone 今晚 7 点"
1. `commit` route 返回 `needs_profile_data` payload
2. `setInlineBookingProfile({ ...missing: ["first_name","last_name","email","phone"] })` 打开 fixed-overlay modal
3. 用户填 4 个字段 → `submitInlineBookingProfile()`
4. POST `/api/user/booking-profiles`（**legacy endpoint**，非 v1）
5. 成功 → `startDirectBookingWithProfile()` 续 booking flow

**局限**:
- 只支持 4 个字段（first_name / last_name / email / phone）
- 用 modal 而不是 inline，打断 chat 流
- 不走新的 v1 PATCH endpoint
- 跟 NLU v2 `apply_profile_patch` 完全脱节

### 1.2 New target 路径

**触发 A**: 用户在 chat 输入"我的护照号 A1234567"（mid-conversation 主动改）
1. `/api/chat/parse` → NLU extractor → router 输出 `__v2_action: { type: "apply_profile_patch", patch: { passport_number: "A1234567" } }`
2. 前端 dispatchProfilePatch(patch) → PATCH `/api/v1/users/me/profile` { profile: patch }
3. 成功 → toast/inline confirmation；保持 ambient booking flow 不变

**触发 B**: 用户输入"帮我订 Carbone"，但 profile 缺 DOB / phone
1. `commit` route 返回 `needs_profile_data` 含 13-field canonical missing[]
2. **不再开 modal**，改在 chat 流尾部 inline 渲染 `<ProfileGapCard state={...} onSave={...} />`
3. 用户填字段 → `onSave(payload)` → PATCH `/api/v1/users/me/profile` { profile: payload.values }
4. 成功 → 续 booking flow（resume），ProfileGapCard 从 chat 流移除

---

## 2. 文件改动清单

### 2.1 改 / 加（Track B Claude 域）

| 文件 | 改法 | 风险 |
|---|---|---|
| `app/page.tsx` | (a) 加 `dispatchProfilePatch(patch)` helper（参照 `NLU_CONSUMER_CONTRACT.md` § "Reference implementation"）。(b) 在 `chat.parse` 响应处理逻辑里加 `case "apply_profile_patch":` 分支。(c) 把 `InlineBookingProfileGate` 用法改成在 chat stream 里 push 一条 ProfileGapCard message。(d) `submitInlineBookingProfile` 改成调 PATCH `/api/v1/users/me/profile` 而不是 `/api/user/booking-profiles`。 | 高 — 这是 4000+ 行的 page.tsx，改动影响广。**必须每一步都跑 `npx tsc` + 手动验证 demo 路径**。 |
| `app/page.tsx` | 把 `InlineBookingProfileGate` 渲染保留为 **fallback**（feature flag 控制），新路径默认开 | 中 — feature flag 让新旧并存方便 debug |
| `lib/chat-replay.ts` | 加新的 message kind `"profile_gap_card"` to `ReplayMessage` union；持久化 ProfileGapCard 实例（这样 chat 重载时能恢复） | 低 — 加新 union 变体不破坏旧的 |
| `components/profile-gap/ProfileGapCard.tsx` | 可能要加 `compact` prop 让 inline-in-chat 渲染时尺寸合适（chat 宽度比 task 详情页窄） | 低 — 增量 prop |
| `lib/ui-copy/errors.ts` | 加 PATCH 失败的 toast 文案 | 极低 |

### 2.2 不动（codex 域）

- `app/api/v1/users/me/profile/route.ts` — PATCH endpoint 已实装
- `app/api/chat/parse/route.ts` — 已经 emit `__v2_action`
- `lib/agent/nlu-v2/**` — extractor + router 已 ship `apply_profile_patch`

### 2.3 删除（最后一步，feature flag 翻完之后）

- `app/page.tsx` 里所有 `InlineBookingProfileGate` import + state + handlers
- `components/booking/InlineBookingProfileGate.tsx` (309 LOC)
- `app/page.tsx` 的 `getMissingBookingFields` helper（4-field check）
- `lib/chat-replay.ts` 的 `InlineBookingProfileSnapshot` 类型 + 持久化逻辑

**注意**: 这个删除步骤**不在 Phase 1 #7 范围内**。先让两个路径并存运行一周，确认无 regression 再删。

---

## 3. Dispatcher 实现细节

### 3.1 `dispatchProfilePatch(patch)`（路径 A — mid-conversation）

参照 `NLU_CONSUMER_CONTRACT.md` § "Reference implementation"，调整：

```typescript
async function dispatchProfilePatch(patch: ProfilePatch): Promise<void> {
  try {
    const res = await fetch("/api/v1/users/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",  // codex 48c80b2 cookie auth
      body: JSON.stringify({ profile: patch }),
    });
    if (res.status === 401) {
      chat.injectAssistantMessage("Sign in first so I can save your profile.");
      return;
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const fieldErrors = errBody?.error?.fields ?? {};
      const errSummary = Object.entries(fieldErrors)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ") || "Couldn't save those fields.";
      chat.injectAssistantMessage(`Hmm, ${errSummary} Try again?`);
      return;
    }
    const fields = Object.keys(patch).join(", ");
    chat.injectAssistantMessage(`Got it — saved ${fields}.`);
  } catch (err) {
    chat.injectAssistantMessage("Network hiccup saving your profile. Try again in a moment.");
  }
}
```

调用点（在 chat.parse response handler 里）:
```typescript
const action = result.__v2_action;
if (action.type === "apply_profile_patch") {
  await dispatchProfilePatch(action.patch);
  // Don't advance booking flow — apply_profile_patch is meant to NOT
  // touch ambient booking state.
  return;
}
```

### 3.2 ProfileGapCard inline 渲染（路径 B — booking-blocked）

`commit` route 返回 `needs_profile_data` 时，在 chat messages 数组里 push 一条特殊 kind：

```typescript
type ChatMessage =
  | { kind: "text"; role: "user" | "assistant"; content: string }
  | { kind: "profile_gap_card"; state: ProfileGapState; pendingBookingPayload: CommitResponse };

// commit handler:
if (commitResponse.kind === "needs_profile_data") {
  const profileGapState = {
    trigger: commitResponse.scenario,
    missing: commitResponse.missing,
    reason: commitResponse.reason,
  };
  chat.appendMessage({
    kind: "profile_gap_card",
    state: profileGapState,
    pendingBookingPayload: commitResponse,
  });
}

// Renderer in chat list:
if (msg.kind === "profile_gap_card") {
  return (
    <ProfileGapCard
      state={msg.state}
      onSave={async (payload) => {
        await dispatchProfilePatch(payload.values);
        // Then resume the booking with the now-complete profile
        await startDirectBookingWithProfile(msg.pendingBookingPayload, /*profile*/);
        chat.removeMessageById(msg.id);
      }}
    />
  );
}
```

---

## 4. Migration 策略

**Stage 1**（这次 Phase 1 #7）—— 新路径上线，旧 modal 保留为 feature-flag fallback：
```typescript
const USE_PROFILE_GAP_INLINE = process.env.NEXT_PUBLIC_PROFILE_GAP_INLINE === "1";
// In needs_profile_data handler:
if (USE_PROFILE_GAP_INLINE) {
  pushProfileGapCardMessage(...);
} else {
  setInlineBookingProfile(...);  // legacy
}
```

**Stage 2**（Phase 1 #7 完成 + 一周观察后）—— 删 modal，删 feature flag。

---

## 5. Risk surface

| 风险 | 缓解 |
|---|---|
| `app/page.tsx` 4000+ 行，改一处影响多处 | 每改一段跑 `npx tsc --noEmit`；每个 demo 用例手测 |
| Chat replay 持久化老数据库里有 `inlineBookingProfile` snapshot | `chat-replay.ts` 加 `profile_gap_card` 新 union 变体，但不动旧的 — 老 session 还能解码 |
| `dispatchProfilePatch` 跟 booking flow 时序：mid-conv profile_edit 后立刻 booking 应该用新 profile | 在 dispatchProfilePatch 成功后不调 booking；下一轮用户输入 booking 时 `/commit` 自然读到新 profile |
| `commit` route 现在返回 4-field missing[]，不是 13-field canonical | 需要 codex 确认 `/api/chat/commit` 是不是已经返回 13-field shape；如果不是，可能要加一个 normalizer。**这是开始 coding 前 must-resolve 问题**。 |
| ProfileGapCard 在 chat 宽度（~600px）下视觉是否 OK | 用 `/dev/profile-gap-flow` 提前看一眼；必要时给 ProfileGapCard 加 `compact` prop |
| Cookie auth 在某些路径上还没启用（如果用户是匿名 chat） | dispatchProfilePatch 401 → "sign in first" 提示；保持降级路径 |

---

## 6. Test plan

### 6.1 Unit tests

新增：
- `app/page.test.tsx` 或 `app/__tests__/profile-patch-dispatch.test.tsx`：mock fetch，验证 `dispatchProfilePatch` 在 401 / 400 / 200 / 网络错误下的 chat 行为
- ProfileGapCard 在 chat 流里的渲染测试（如果加了 `compact` prop）

不动：
- 现有 137 个 components/profile-gap + benchmark + task-timeline 测试

### 6.2 Manual QA（按 PHASE_1_FOUNDER_E2E.md § 6 改进）

新增 walkthrough section "§ 6.5 Phase 1 #7 验证":
1. 登录 ziweiB（空 profile）
2. chat 输入 "save my DOB 1995-05-15"
3. **预期**: chat 出现 "Got it — saved date_of_birth." + DB 里 ziweiB profile 已更新
4. chat 输入 "帮我订 Carbone 今晚 7 点"
5. **预期**: chat 流里 inline 出现 ProfileGapCard（不是 modal），缺字段显示 first_name / last_name / email / phone
6. 填完 → save → chat 流里出现 "Thanks — saved ..." + booking 续 flow
7. **不预期**: 看到 InlineBookingProfileGate modal（除非 feature flag 关闭）

---

## 7. Must-resolve 问题（开始 coding 前）— 全部 ✅ RESOLVED

参照 `NLU_CONSUMER_CONTRACT.md` § "Open questions for codex" 的 5 个：

| Q | 问题 | 状态 |
|---|---|---|
| Q1 | PATCH endpoint path? `/api/users/me/profile` (cookie) vs `/api/v1/users/me/profile` (API-key) | ✅ resolved by codex `48c80b2` — `/api/v1/users/me/profile` 兼容两种 auth |
| Q2 | 校验失败的 error shape | ✅ resolved — see `lib/profile-patch.ts:156-165` |
| Q3 | PATCH 是否 idempotent | ✅ resolved — `upsertDefaultBookingProfile` 是 idempotent |
| Q4 | `apply_profile_patch` dispatch 是否要 telemetry | ⏸ 暂缓到 Phase 2 |
| Q5 | MCP `tools/call` 路径中怎么 ack patch | ⏸ 暂缓到 Phase 2（一起处理 MCP 流程） |

新增 must-resolve（这 spec 演进过程中发现的）：

| Q | 问题 | 状态 |
|---|---|---|
| Q14 | `/api/chat/commit` 在 needs_profile_data 时返回的 `missing[]` 是 4-field（legacy）还是 13-field（canonical）？ | ✅ resolved — backend `buildProfileGap` 已 emit 13-field canonical (实测确认) |
| Q15 | 客户端复刻 `buildProfileGap` 还是后端 commit route emit `profile_gap`？ | ✅ resolved — codex `7289ba0` 实现了 Option (i)：`/api/chat/commit` direct_booking 分支 emit `payload.profile_gap`（canonical 13-field、scenario-aware）。客户端不复刻。 |

**全部 must-resolve 问题 closed**。Path A + Path B 均已 ship 到 master。

---

## 8. 实施步骤（拍板后按顺序）

| # | 步骤 | 时间 | 验证 |
|---|---|---|---|
| 1 | 从 `origin/master` 开 `claude/phase-1-7-homepage-profile-gap` 分支 | 1 分钟 | `git status` clean |
| 2 | 解 Q14（看 commit route 当前 shape） | 2 分钟 | grep + read |
| 3 | 加 `dispatchProfilePatch` helper + chat case "apply_profile_patch" | 8 分钟 | tsc + manual chat test "save my DOB ..." |
| 4 | 加 chat message kind "profile_gap_card" + renderer | 10 分钟 | tsc + visual: 看 chat 流里 ProfileGapCard 长什么样 |
| 5 | 加 feature flag + 双路径并存 | 5 分钟 | 改 NEXT_PUBLIC_PROFILE_GAP_INLINE=0/1 切换观察 |
| 6 | chat-replay.ts union 加 `profile_gap_card` 变体 | 5 分钟 | tsc + replay 老 session 不报错 |
| 7 | 跑相关 vitest（profile-gap + 现有 chat 测试不 regress） | 2 分钟 | 测试全绿 |
| 8 | 写 commit msg + push | 2 分钟 | `[handoff]` tag 等 codex review |

总：35-40 分钟。

---

## 9. 完成判据

- [ ] `chat 输入 "save my DOB 1995-05-15"` → chat 流出现 "Got it — saved date_of_birth."（路径 A）
- [ ] `chat 输入 "book Carbone tonight"` 而 profile 空 → chat 流 inline 出现 ProfileGapCard（路径 B）
- [ ] 不再看到 InlineBookingProfileGate modal（默认 feature flag 开）
- [ ] 13 字段都能从 chat 直接说话改进 profile（之前只能 4 字段）
- [ ] DB 里 booking_profiles 表确认 PATCH 落库
- [ ] 旧 session（带 `inlineBookingProfile` snapshot）replay 不报错
- [ ] tsc + vitest 全绿
- [ ] 代码 ≤ 200 行（不算删除）

---

## 11. Path B 设计补充（已实现并 ship 到 master）

> **状态更新 2026-05-03 16:40 UTC** — ✅ **Path B 已 ship**:
> - Claude `d51e732 feat(phase-1-7): inline ProfileGapCard in chat (path B)`
> - codex `4cdaa36 [merge]` (含 codex 加的 `dispatchProfilePatch` Promise<boolean> safety fix)
> - 实际实施时间：4 分钟（vs 原计划 18 分钟），归功于 codex 提前实现 Q15
> - 实施跟原 spec 一致，唯一变化：codex 在 merge 时把 `dispatchProfilePatch` 改成
>   返回 boolean，path B onSave 检查 false 时 throw 阻止续 booking（防 silent
>   profile fail 导致 booking 用旧 profile 出错）
>
> 下面的设计细节保留作 historical reference，**未来 apply_profile_patch
> 消费者**（MCP path、DR private chat）可参照同样 pattern。

### 11.1 Legacy `InlineBookingProfileGate` 入口位置

**触发链**（数据流，从用户操作到 modal 显示）：

```
用户在 chat 输入"book Carbone tonight 7pm"
  ↓
ConfirmCard (commit) →  /api/chat/commit (US-W5 direct_booking branch)
  ↓
返回 CommitResponse with kind === "direct_booking" + booking_step
  ↓
app/page.tsx:1848  handleDirectBooking(payload: CommitResponse)
  ↓
检查 user profile via /api/user/booking-profiles?default=true
  ↓
profile lacks first_name/last_name/email/phone → 调:
  setInlineBookingProfile({
    id: ...,
    venueName: ...,
    payload: <CommitResponse>,
    first_name: ..., last_name: ..., email: ..., phone: ...,
    missing: getMissingBookingFields(profile),  // 4-field legacy hardcode
  })
  ↓
app/page.tsx:4291  <InlineBookingProfileGate open={!!inlineBookingProfile} ... />
  ↓
用户填表 + submit
  ↓
app/page.tsx:1772  submitInlineBookingProfile()
  ↓
PUT/POST /api/user/booking-profiles  (legacy endpoint)
  ↓
成功 → startDirectBookingWithProfile(payload, profile) 续 booking
```

**Path B 切换点**（按数据流改动顺序）：

| # | 文件 / 函数 | 现状 | 切换后 |
|---|---|---|---|
| 1 | `app/page.tsx:4291` `<InlineBookingProfileGate />` 渲染 | Modal overlay (fixed inset-0) | Inline `<ProfileGapCard />` push 进 chat messages 流 |
| 2 | `app/page.tsx:1713` `getMissingBookingFields()` 4-field hardcode | 客户端 4 字段检查 | 用后端 `buildProfileGap()` emit 的 13-field canonical（**Q15 — 见 11.4**） |
| 3 | `app/page.tsx:1772` `submitInlineBookingProfile()` 用 legacy endpoint | `POST /api/user/booking-profiles` (label, is_default, 4 字段) | `PATCH /api/v1/users/me/profile` `{ profile: payload.values }` (cookie-auth) |
| 4 | `app/page.tsx:343-345` 三个 state hook | `inlineBookingProfile` / `inlineBookingProfileSaving` / `inlineBookingProfileError` | 删除（移到每条 chat message 自己的状态里，因为 inline 不再是单 modal） |
| 5 | `lib/chat-replay.ts` `InlineBookingProfileSnapshot` | persist 到 session 的 modal 状态 | 加 `ChatMessageKind: "profile_gap_card"` 变体 + persist GapSavePayload state |
| 6 | `components/booking/InlineBookingProfileGate.tsx` | 309 LOC modal 组件 | **保留**（feature flag fallback），删除发生在 path B 完成 + 一周观察后 |

### 11.2 Props mapping

`InlineBookingProfileGate` props → `ProfileGapCard` props：

| InlineBookingProfileGate prop | ProfileGapCard 对应 | 转换 |
|---|---|---|
| `open: boolean` | （N/A，inline 渲染不需要 open flag）| 在 chat message renderer 里 conditional render |
| `venueName: string` | `state.reason: string`（在 ProfileGapState 里）| `\`${venueName} requires verified contact details.\`` |
| `values: { first_name, last_name, email, phone }` | `initialValues: GapFormValues`（13-field 子集）| 把 4 字段塞进 GapFormValues，剩下 9 字段留 undefined |
| `missingFields: string[]` | `state.missing: ProfileFieldId[]` | 直接传（4-field 是 13-field 的子集） |
| `saving: boolean` | （N/A，ProfileGapCard 内部状态）| 删 saving prop；ProfileGapCard 自己处理 submitting state |
| `error: string \| null` | （N/A）| ProfileGapCard 不渲染 error，error 由 chat message 渲染（见 path A `dispatchProfilePatch` 错误 chat-bubble） |
| `onChange(patch)` | （N/A） | 删 — ProfileGapCard 内部管 form state |
| `onClose()` | `onDismiss?: () => void` | 1:1 |
| `onSubmit()` | `onSave: (payload: GapSavePayload) => Promise<void>` | onSubmit 是无 payload 的 button click；onSave 接 `{ values, skipped }`，回调 dispatch path A 的 dispatchProfilePatch + 触发 startDirectBookingWithProfile 续 booking |

### 11.3 `getMissingBookingFields` 4-field vs `buildProfileGap` 13-field 差异

**4-field legacy**（`app/page.tsx:1713-1720`）：

```ts
function getMissingBookingFields(profile) {
  const missing = [];
  if (!profile?.first_name?.trim()) missing.push("first_name");
  if (!profile?.last_name?.trim()) missing.push("last_name");
  if (!profile?.email?.trim()) missing.push("email");
  if (!profile?.phone?.trim()) missing.push("phone");
  return missing;
}
```

**13-field canonical**（`lib/core/execution/profile-requirements.ts:buildProfileGap`）：

| Scenario | Required fields | Total |
|---|---|---|
| restaurant | first_name, last_name, email, phone | 4 |
| hotel / activity | + address_line1, city, state, zip, country | 9 |
| flight 国内 (US→US) | + date_of_birth | 5 |
| flight 国际 | + date_of_birth, passport_number, passport_expiry, passport_country | 8 |

**核心差异**：
- 4-field 适合 restaurant scenario，对其他 scenario 不够
- restaurant 现在用 4-field 跑通 legacy gate，**没有 bug**（覆盖刚好）
- 但用户在 hotel / flight 场景下用 legacy gate 会**漏问**关键字段（DOB / passport / address），导致 booking 后续在 booking automation layer 失败
- 切换到 13-field canonical 是把"booking-time 失败"提前到"chat-time 收集"，UX 改善 + 失败率下降

### 11.4 Q15 — codex 决定的后端/前端职责

**问题**：homepage chat 的 `direct_booking` 流程目前**不**调 backend `buildProfileGap`。它走的是：
1. `/api/chat/commit` US-W5 branch 返回 `kind: "direct_booking"`
2. 客户端 `handleDirectBooking` 拉 `/api/user/booking-profiles?default=true`
3. 客户端跑 `getMissingBookingFields(profile)` 4-字段检查
4. 客户端决定是否弹 gate

`buildProfileGap` 只在 `lib/core/execution/executor.ts` 真正起 booking job 时被调，那是 `/tasks/[taskId]` 的路径，不是 homepage chat 的路径。

**两个选择给 codex**：

#### Option (i)：后端在 commit route emit 13-field canonical missing[]

`/api/chat/commit` 在 `kind: "direct_booking"` 分支里跑 `buildProfileGap(execution, profile)` 并把 `missing[]` + `scenario` 塞回 `CommitResponse`。客户端只读 `commitResponse.profile_gap.missing` 渲染 ProfileGapCard。

**优点**：
- 单一信源，跟 `/tasks/[taskId]` 走的是同一个 `buildProfileGap`
- 客户端 `getMissingBookingFields` 可以删
- Scenario-aware（hotel 场景自动加 address，flight 自动加 DOB / passport）

**缺点**：
- 需要 codex 改 `/api/chat/commit` route（codex 域）
- commit response shape 变（需要协议升级）

#### Option (ii)：客户端 import `buildProfileGap` 自己跑

把 `lib/core/execution/profile-requirements.ts` 抽成 pure function（已经是 pure），客户端 `handleDirectBooking` 调它生成 missing[]。

**优点**：
- 不动 commit route
- 客户端自己控制
- 不依赖 codex 改 API

**缺点**：
- 业务逻辑客户端化（违反"客户端只渲染，业务在 server"原则）
- 国际航线判断（`isInternationalFlight`）依赖 US_AIRPORT_CODES 数据集，客户端 import 这一坨 ~200 LOC

**Claude 推荐 Option (i)** —— 单一信源更干净，且 codex 改 commit route 也是一行：在 direct_booking 分支里 `result.profile_gap = buildProfileGap(execution, profile)` 即可。

**等 codex 答 Q15 才进 path B coding 阶段。**

### 11.5 Path B 实施估时（LLM 速度）

| 步骤 | 时间 |
|---|---|
| 解 Q15（codex 答） | 0（外部依赖） |
| Add chat message kind `profile_gap_card` 到 chat-replay.ts union | 3 分钟 |
| 加 `<ProfileGapCard />` 渲染到 chat message renderer | 3 分钟 |
| 改 `handleDirectBooking` 用新 missing[] 来源 + 客户端 onSave 接 dispatchProfilePatch + startDirectBookingWithProfile | 5 分钟 |
| 加 `NEXT_PUBLIC_PROFILE_GAP_INLINE` feature flag | 2 分钟 |
| 测试：legacy modal 路径 + 新 inline 路径 都跑通 | 3 分钟 |
| Tsc + commit + push | 2 分钟 |

**总：约 18 分钟**（不含 Q15 解决时间）。

### 11.6 Path B Test plan 补充

- 加 `app/__tests__/dispatch-profile-patch.test.tsx`（如果不存在）：mock fetch，验证 dispatchProfilePatch 在 401 / 400 / 200 / network 下的 chat 行为（已经 ship 过 path A，行为已 implicit 测过；但显式单测更稳）
- 改 chat-replay test 验证 `profile_gap_card` 变体 round-trip
- Manual：feature flag on/off 切换，看 legacy modal vs inline 渲染差异

---

## 10. 引用

- `NLU_CONSUMER_CONTRACT.md` — dispatcher pattern + reference impl
- `lib/agent/nlu-v2/types.ts:289` — `apply_profile_patch` action shape
- `lib/agent/nlu-v2/router.ts:50-56` — router 决策逻辑
- `app/api/v1/users/me/profile/route.ts` — codex shipped PATCH
- `lib/profile-patch.ts:69-178` — parseProfilePatch 错误 shape
- `app/page.tsx:4291` — 现 InlineBookingProfileGate 用法
- `app/page.tsx:1772-1841` — 现 submitInlineBookingProfile 流程
- `app/dev/profile-gap-flow/page.tsx` + `mock-pipeline.ts` — 真实参考实现
- `components/profile-gap/ProfileGapCard.tsx` + `types.ts` — Card 组件契约
