# AI Loop 迁移计划：从 RPA → 泛化 AI 浏览器自动化

## 背景

当前版本（git tag: `rpa-baseline`，commit `974aeaa`）的预订执行层本质上是 RPA 脚本：

- `lib/booking-autopilot/providers/booking-com.ts`：3400 行硬编码 Playwright selector
- `lib/booking-autopilot/core/stage-assessment.ts`：关键词列表判断阶段，无 AI
- `stagehand-executor.ts` line ~766：检测到 Booking.com 时 `maxSteps=0`，AI 执行完全绕过

**目标**：感知 → 推理 → 执行 的 AI 循环，一套代码适配任意预订网站，无需任何网站特定代码。

---

## 目标架构

```
截图 + 简化 DOM
      ↓
  Claude Haiku（快 ~1s、便宜 ~$0.001/call）
  返回结构化 JSON：
  {
    "stage": "room_selection",
    "nextAction": {
      "type": "act",
      "instruction": "select the cheapest available room"
    },
    "reasoning": "I can see a room list with Standard King at $150..."
  }
      ↓
  Playwright / Stagehand page.act() 执行单个动作
      ↓
  重复（最多 25 步），直到 done
```

**设计约束**：
- LLM 只做决策（输出 JSON），不直接操控浏览器
- Playwright 只负责执行（click/fill/scroll），不做任何判断
- 每步有截图 + reasoning 记录，完全可观测调试
- 每步 LLM 调用 < 2s（Haiku），总流程目标 < 60s
- 每个 Phase 独立可测试、可回滚，通过 env flag 切换

---

## 渐进式迁移：5 个 Phase

### Phase 1 — 新建 AI Loop 基础设施（不改任何现有代码）

**新建文件**，现有 RPA 代码完全不动。验证基础循环能跑通。

#### `lib/booking-autopilot/ai-loop/types.ts`

```typescript
export type BookingStage =
  | "listing"          // 搜索结果列表页
  | "hotel_detail"     // 酒店详情页（有房间列表）
  | "room_selection"   // 选房/选价格
  | "guest_form"       // 联系人信息表单
  | "payment_form"     // 支付信息表单
  | "paused_payment"   // 到达 CVV → 停止，等用户
  | "confirmation"     // 预订完成
  | "no_availability"  // 无房
  | "captcha"          // 需要人工
  | "unknown";

export type ActionType =
  | "act"              // 自然语言 → Stagehand page.act() 找元素并执行
  | "fill_form"        // 批量填表单字段
  | "scroll_down"
  | "scroll_up"
  | "wait"
  | "done";

export interface NextAction {
  type: ActionType;
  instruction?: string;                 // act 类型用
  fields?: Record<string, string>;      // fill_form 类型用
  outcome?: "paused_payment" | "completed" | "no_availability" | "captcha";
  reasoning: string;                    // LLM 推理，用于调试和 trace log
  confidence: number;                   // 0-1
}

export interface PerceptionResult {
  stage: BookingStage;
  pageDescription: string;
  nextAction: NextAction;
}

export interface LoopStepRecord {
  stepIndex: number;
  url: string;
  stage: BookingStage;
  action: NextAction;
  durationMs: number;
}

export interface AILoopResult {
  outcome: "paused_payment" | "completed" | "no_availability" | "captcha" | "failed";
  finalUrl: string;
  steps: LoopStepRecord[];
  summary: string;
}
```

#### `lib/booking-autopilot/ai-loop/perceive.ts`

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { PerceptionResult } from "./types";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a browser automation agent deciding the SINGLE next action to complete a hotel booking.
You receive a screenshot + interactive elements list, and return ONE structured JSON action.

RULES:
- Return ONLY valid JSON, no markdown fences
- ONE action per response
- STOP (done/paused_payment) when you see: CVV field, "Pay Now", "Confirm Payment", "Complete Booking"
- STOP (done/no_availability) when page clearly shows no rooms
- NEVER re-do the same action twice (check recentSteps)
- If you haven't scrolled down yet on a hotel detail page, do scroll_down first`;

export async function perceiveAndDecide(
  page: Page,
  task: string,
  profile: { first_name: string; last_name: string; email: string; phone: string },
  recentSteps: string[],
): Promise<PerceptionResult> {
  const screenshotBuf = await page.screenshot({ type: "jpeg", quality: 60 });

  // 简化 DOM：只提取可交互元素文字，不发整个 HTML（太贵）
  const interactiveText = await page.evaluate(() => {
    const els = document.querySelectorAll(
      'button, a[href], input, select, [role="button"], [role="tab"], h1, h2, h3, label'
    );
    return Array.from(els)
      .map(el => {
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
        const tag = el.tagName.toLowerCase();
        const inputType = (el as HTMLInputElement).type || "";
        return text ? `[${tag}${inputType ? `:${inputType}` : ""}] ${text}` : null;
      })
      .filter(Boolean)
      .slice(0, 60)
      .join("\n");
  });

  const prompt = `Task: ${task}
URL: ${page.url()}
Recent steps: ${recentSteps.slice(-3).join(" → ") || "none"}

Interactive elements:
${interactiveText}

User profile (use when filling forms):
first_name: ${profile.first_name}
last_name: ${profile.last_name}
email: ${profile.email}
phone: ${profile.phone}

Respond with this JSON (no markdown):
{
  "stage": "<stage>",
  "pageDescription": "<one sentence>",
  "nextAction": {
    "type": "<act|fill_form|scroll_down|scroll_up|wait|done>",
    "instruction": "<for act: natural language instruction to Stagehand>",
    "fields": {"<field label>": "<value>"},
    "outcome": "<for done: paused_payment|completed|no_availability|captcha>",
    "reasoning": "<why>",
    "confidence": 0.9
  }
}`;

  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshotBuf.toString("base64") } },
        { type: "text", text: prompt },
      ]
    }]
  });

  const text = res.content[0].type === "text" ? res.content[0].text.trim() : "";
  try {
    return JSON.parse(text) as PerceptionResult;
  } catch {
    return {
      stage: "unknown",
      pageDescription: "LLM parse error",
      nextAction: { type: "scroll_down", reasoning: `parse error: ${text.slice(0, 80)}`, confidence: 0.1 }
    };
  }
}
```

#### `lib/booking-autopilot/ai-loop/execute.ts`

```typescript
import type { Page } from "playwright";
import type { NextAction } from "./types";

export async function executeAction(
  page: Page,
  action: NextAction,
  trace: (msg: string) => void,
): Promise<void> {
  switch (action.type) {
    case "act":
      if (!action.instruction) throw new Error("act requires instruction");
      await (page as any).act(action.instruction);
      break;

    case "fill_form":
      if (!action.fields) throw new Error("fill_form requires fields");
      for (const [field, value] of Object.entries(action.fields)) {
        if (!value) continue;
        trace(`[fill] ${field} = "${value.slice(0, 20)}..."`);
        await (page as any).act(`Fill the ${field} field with "${value}"`);
        await new Promise(r => setTimeout(r, 350));
      }
      break;

    case "scroll_down":
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.75));
      await new Promise(r => setTimeout(r, 600));
      break;

    case "scroll_up":
      await page.evaluate(() => window.scrollBy(0, -window.innerHeight * 0.75));
      await new Promise(r => setTimeout(r, 400));
      break;

    case "wait":
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      break;

    case "done":
      break; // 循环外处理
  }
}
```

#### `lib/booking-autopilot/ai-loop/loop.ts`

```typescript
import type { Page } from "playwright";
import type { AILoopResult, LoopStepRecord } from "./types";
import { perceiveAndDecide } from "./perceive";
import { executeAction } from "./execute";

export async function runAIBookingLoop(
  page: Page,
  task: string,
  profile: { first_name: string; last_name: string; email: string; phone: string },
  trace: (msg: string) => void,
  maxSteps = 25,
): Promise<AILoopResult> {
  const steps: LoopStepRecord[] = [];
  const recentSteps: string[] = [];

  for (let i = 0; i < maxSteps; i++) {
    const t0 = Date.now();
    const url = page.url();
    trace(`[ai-loop] step ${i + 1}/${maxSteps} | ${url.slice(0, 70)}`);

    const perception = await perceiveAndDecide(page, task, profile, recentSteps).catch(err => {
      trace(`[ai-loop] perceive error: ${err}`);
      return null;
    });

    if (!perception) break;

    const { stage, pageDescription, nextAction } = perception;
    trace(`[ai-loop] stage=${stage} action=${nextAction.type} conf=${nextAction.confidence} | ${nextAction.reasoning}`);

    const record: LoopStepRecord = {
      stepIndex: i, url, stage, action: nextAction, durationMs: 0
    };

    if (nextAction.type === "done") {
      record.durationMs = Date.now() - t0;
      steps.push(record);
      return { outcome: nextAction.outcome ?? "completed", finalUrl: url, steps, summary: pageDescription };
    }

    await executeAction(page, nextAction, trace).catch(err =>
      trace(`[ai-loop] execute error: ${err}`)
    );

    record.durationMs = Date.now() - t0;
    steps.push(record);
    recentSteps.push(`step${i + 1}[${nextAction.type}]: ${nextAction.reasoning.slice(0, 60)}`);
    await new Promise(r => setTimeout(r, 700));
  }

  return { outcome: "failed", finalUrl: page.url(), steps, summary: `Max steps (${maxSteps}) reached` };
}
```

**Phase 1 验收**：写一个测试，`runAIBookingLoop` 在一个简单表单网站上能填完名字+邮件并提交。

---

### Phase 2 — AI stage 检测替换关键词匹配

**修改文件**：`lib/booking-autopilot/core/stage-assessment.ts`

**策略**：双轨并行，AI 置信度低时回退 RPA，通过 env flag 控制。

```typescript
// 新增到 stage-assessment.ts
import { perceiveAndDecide } from "../ai-loop/perceive";

async function assessStageHybrid(
  page: Page,
  rpaResult: BookingStage,  // 现有关键词结果
  trace: (msg: string) => void,
): Promise<BookingStage> {
  if (process.env.AI_LOOP_STAGE_DETECT !== "true") return rpaResult;

  try {
    const perception = await perceiveAndDecide(page, "assess stage only", {} as any, []);
    trace(`[stage] AI=${perception.stage}(conf=${perception.nextAction.confidence}) RPA=${rpaResult}`);

    if (perception.nextAction.confidence >= 0.75) {
      return perception.stage;
    }
    trace(`[stage] AI confidence low, using RPA result`);
  } catch (err) {
    trace(`[stage] AI assess failed: ${err}, using RPA`);
  }
  return rpaResult;
}
```

**.env.local 新增**：
```
AI_LOOP_STAGE_DETECT=false   # Phase 2: true 开启 AI stage 检测
AI_LOOP_FORM_FILL=false      # Phase 3
AI_LOOP_LISTING=false        # Phase 4
AI_LOOP_FULL=false           # Phase 5
```

**Phase 2 验收**：对比 100 次页面截图，AI 阶段判断准确率 ≥ 95%，与关键词结果一致。

---

### Phase 3 — AI form filling 替换硬编码 selector

**修改文件**：`stagehand-executor.ts` 中调用 `fillBookingComGuestForm` 的地方

**新增文件**：`lib/booking-autopilot/ai-loop/fill-form.ts`

```typescript
export async function fillFormWithAI(
  page: Page,
  fields: Record<string, string>,
  trace: (msg: string) => void,
): Promise<{ filled: string[]; failed: string[] }> {
  const filled: string[] = [];
  const failed: string[] = [];

  for (const [fieldLabel, value] of Object.entries(fields)) {
    if (!value) continue;
    try {
      await (page as any).act(`Fill the ${fieldLabel} field with "${value}"`);
      filled.push(fieldLabel);
      trace(`[fill-form] ✓ ${fieldLabel}`);
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      trace(`[fill-form] ✗ ${fieldLabel}: ${err}`);
      failed.push(fieldLabel);
    }
  }

  return { filled, failed };
}
```

**在 executor 中**：
```typescript
if (process.env.AI_LOOP_FORM_FILL === "true") {
  await fillFormWithAI(raw, {
    "first name": profile.first_name,
    "last name": profile.last_name,
    "email": profile.email,
    "phone number": profile.phone,
    "country": profile.country,
  }, trace);
} else {
  await fillBookingComGuestForm(raw, profile, trace);  // 保留 RPA fallback
}
```

**Phase 3 验收**：Booking.com + IHG guest form 在 `AI_LOOP_FORM_FILL=true` 下填完，无需任何网站特定 selector。

---

### Phase 4 — AI listing + room selection 替换

**新增文件**：`lib/booking-autopilot/ai-loop/find-listing.ts`

这是最复杂的 Phase，拆成两个函数：

```typescript
/**
 * 在搜索结果页找到目标酒店并点击（AI 看截图认名字）
 */
export async function clickTargetListingAI(
  page: Page,
  targetHotelName: string,
  trace: (msg: string) => void,
): Promise<"clicked" | "not_found" | "no_availability"> {
  for (let scroll = 0; scroll < 6; scroll++) {
    const result = await perceiveAndDecide(
      page,
      `Find and click the hotel named "${targetHotelName}" in the search results`,
      {} as any,
      [],
    );

    if (result.nextAction.type === "act" && result.nextAction.confidence > 0.7) {
      await (page as any).act(result.nextAction.instruction!);
      return "clicked";
    }
    if (result.stage === "no_availability") return "no_availability";

    await page.evaluate(() => window.scrollBy(0, 500));
    await new Promise(r => setTimeout(r, 400));
  }
  return "not_found";
}

/**
 * 在酒店详情页选最便宜的房间
 */
export async function selectCheapestRoomAI(
  page: Page,
  trace: (msg: string) => void,
): Promise<"selected" | "no_availability"> {
  // 先滚到房间列表
  await (page as any).act("scroll down to find the room list or available rooms section");
  await new Promise(r => setTimeout(r, 800));

  const result = await perceiveAndDecide(
    page,
    "Select the cheapest available room. Change quantity dropdown to 1 if present, then click Book/Reserve/Select.",
    {} as any,
    [],
  );

  if (result.stage === "no_availability") return "no_availability";

  if (result.nextAction.type === "act") {
    await (page as any).act(result.nextAction.instruction!);
    return "selected";
  }
  return "no_availability";
}
```

**Phase 4 验收**：在 Booking.com + Expedia + Hotels.com 上，能找到指定酒店并选房间，不依赖任何网站特定 selector。

---

### Phase 5 — 整合，移除 RPA 代码

**当所有 Phase 验收通过后**，`stagehand-executor.ts` 主流程简化为：

```typescript
// 开启 AI_LOOP_FULL=true 后的执行路径
if (process.env.AI_LOOP_FULL === "true") {
  const loopResult = await runAIBookingLoop(raw, buildInstruction(input), p, trace);
  // 把 loopResult 转成现有的 finalOutcome 格式
  return mapLoopResultToFinalOutcome(loopResult);
}
// 否则走现有 RPA 路径（保留直到全部验证）
```

**最终删除**：
- `lib/booking-autopilot/providers/booking-com.ts`（3400 行）
- `lib/booking-autopilot/core/stage-assessment.ts` 的关键词数组部分
- `stagehand-executor.ts` 中所有 `bookingComPageOpen` 分支和 Booking.com 特定逻辑

**Phase 5 验收**：同一代码在以下网站跑通，`AI_LOOP_FULL=true`：
- Booking.com
- IHG / Marriott / Hilton
- OpenTable（餐厅）
- Expedia（机票）

---

## 成本估算

| 场景 | 步数 | 费用 |
|------|------|------|
| 顺畅预订（10步） | 10× Haiku | ~$0.01 |
| 复杂预订（20步） | 20× Haiku | ~$0.02 |
| 含重试（30步） | 30× Haiku | ~$0.03 |

Claude Haiku vision：截图约 1000 tokens input，output 400 tokens → $0.0008+$0.0005 = **$0.0013/步**

---

## 文件结构（最终态）

```
lib/booking-autopilot/
  ai-loop/
    types.ts           ← Phase 1：所有类型定义
    perceive.ts        ← Phase 1：截图+DOM → LLM → 结构化决策
    execute.ts         ← Phase 1：执行单个动作
    loop.ts            ← Phase 1：主循环
    fill-form.ts       ← Phase 3：AI form filling
    find-listing.ts    ← Phase 4：AI listing/room 选择
  core/
    final-outcome.ts   ← 保留（结果判断逻辑可复用）
    error-utils.ts     ← 保留
    profile.ts         ← 保留（profile → fields 映射）
  providers/
    booking-com.ts     ← Phase 5 后删除
  stagehand-executor.ts  ← 最终只剩浏览器初始化 + 调用 runAIBookingLoop
```

---

## 回滚策略

每个 Phase 通过 `.env.local` flag 独立控制：

```bash
AI_LOOP_STAGE_DETECT=false  # Phase 2：AI stage 检测
AI_LOOP_FORM_FILL=false     # Phase 3：AI form filling
AI_LOOP_LISTING=false       # Phase 4：AI listing/room 选择
AI_LOOP_FULL=false          # Phase 5：完整 AI loop
```

任何问题，把对应 flag 改为 `false` → 立即回退 RPA，零停机。

---

## 参考基线

- Git tag: `rpa-baseline` | Commit: `974aeaa`
- 这是 Booking.com end-to-end 跑通的 RPA 版本，可随时回溯对比
