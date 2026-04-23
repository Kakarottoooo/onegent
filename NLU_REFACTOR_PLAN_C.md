================================================================
NLU 架构重构计划 · Plan C · v1.0 · 2026-04-23
================================================================

本文档定义 Onegent 从"规则化单层 NLU"演进到"对话模型 + 记忆提取器 +
代码路由器"三层分离架构的完整路径，以及为什么要做、怎么做、分几步。

**阅读指南**
- 想 30 秒搞懂要做什么：读 "一、Vision" + "三、目标架构"
- 想知道为什么这样切：读 "二、现状诊断" + "四、为什么选 Plan C"
- 想开工：读 "六、任务列表" + "七、数据契约" + "八、用户自选模型"
- 本计划配合 `PROJECT_SUMMARY.md`（三段式骨架章节）和 `CLAUDE.md` 使用

**状态**
- 方案已定（2026-04-23 用户确认），文档编写完成
- 实际开工：**待 Stage 1 Trip Packaging 验收跑稳后启动**（不抢占当前闭环）
- 预估工期：3–5 天（试点 trip 场景）；全量迁移 1–2 周

================================================================
一、Vision — 为什么要重构 NLU
================================================================

【现状一句话】

当前 `lib/conversational-nlu.ts` 是一个 800+ 行的巨型 LLM prompt，
塞了 5 个场景的识别规则、每场景的必填字段、quick_picks 兜底列表、
每种奇怪用户输入的处理。它让 NLU 既当"路由器"又当"状态机"又当
"UX 设计稿"，三个关注点耦合在一个超大 prompt 里。

【要变成什么样】

把 NLU 的三件事拆成三个独立的层：

```
┌─ Layer 1: 对话模型（Claude Sonnet） ─────────────────────────┐
│  职责：和用户聊得"像人"。用自然语言追问、确认、澄清。          │
│       不产出任何 JSON，只产出聊天回复。                      │
│  输入：完整对话历史                                          │
│  输出：纯文本 assistant reply                                │
└────────────────────┬─────────────────────────────────────────┘
                     ↓
┌─ Layer 2: 记忆提取器（Haiku / gpt-4o-mini） ─────────────────┐
│  职责：从对话历史中**提取并更新**结构化状态。纯 IR。          │
│       每轮对话后跑一次（新消息 + 旧 state → 新 state）。     │
│  输入：{ prev_state, new_turn_user, new_turn_assistant }     │
│  输出：完整的 IntentState（schema 验证过）                   │
└────────────────────┬─────────────────────────────────────────┘
                     ↓
┌─ Layer 3: 代码路由器（纯函数，不是 LLM） ─────────────────────┐
│  职责：看 state 决定下一步。确定性，可单测。                  │
│  输入：IntentState                                           │
│  输出：{                                                      │
│    action:                                                   │
│      | { type: "continue_chat" }                             │
│      | { type: "show_confirm_card", kind: "plan" | "room" | "trip" }│
│      | { type: "run_planner", scenario, state }              │
│      | { type: "ask_clarification", missing: string[] }      │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
```

【为什么分三层】

- **聊天体验**：Layer 1 用大模型自然聊天，和 ChatGPT 一样灵活。
  用户怎么表达都行，不卡在"必须按我定义的模板说话"上。
- **可控性**：Layer 3 是代码，决定"要不要触发预订/跳 Decision Room/
  展示 confirm 卡"。AI 不能偷偷帮你订东西。
- **成本**：Layer 2 用小模型（gpt-4o-mini / Haiku）做状态提取，便宜。
  只有需要对话润色时才动大模型。

================================================================
二、现状诊断 — 当前 NLU 的痛点
================================================================

`lib/conversational-nlu.ts`（2026-04-23 snapshot）：

- **818 行**，其中 400 行是 `SYSTEM_PROMPT` 常量
- 混合了 **5 种职责**：
  1. Intent 识别（create_plan / create_room / refine_existing / chitchat）
  2. Scenario 识别（restaurant / hotel / flight / activity / trip）
  3. Missing-fields 检测（每场景硬编码必填字段）
  4. Quick-picks 兜底（FALLBACK_QUICK_PICKS 硬编码 5 场景的默认选项）
  5. Assistant-reply 生成（让 LLM 用中英文"像人"回答）

【具体痛点】

| # | 痛点 | 用户体感 |
|---|------|----------|
| P1 | 用户用不标准的表达，NLU 识别失败 | "帮我安排周末"被判 chitchat |
| P2 | 场景识别错 → 路由到错的 pipeline | 说"找酒店"被识别成 restaurant |
| P3 | confirm_ready 触发条件太严，追问死循环 | 已经给够信息但还在 "你在哪个城市？" |
| P4 | 每加一个场景要大改 prompt | Trip 场景加规则时已经让 prompt 膨胀 80 行 |
| P5 | 无法 refine（"改一下日期"得重头说） | 用户必须重新 chat 整句话 |
| P6 | 多轮对话记忆靠把上一轮 JSON 塞回 history，脆弱 | 某轮 LLM 返回不规范 JSON 后续全乱 |

【代码层面的问题】

- 单个文件 800 行，任何改动都要通读全部 prompt
- 500-行 system prompt 很难 unit test
- 重复逻辑：`FALLBACK_QUICK_PICKS` 和 prompt 里的 "推荐时用这些 fallback"
  规则重复了一次
- **hasRequiredForScenario 函数 vs prompt 规则** 是两份独立的必填字段定义，
  容易不一致（trip 场景最近加字段时就出现过）

================================================================
三、目标架构 · 代码实现细节
================================================================

### 模型选型总原则

**两层都默认 `openai/gpt-4o-mini`**——同一个 provider、同一个 key、
一致的调用方式。Claude Sonnet 4.6 作为**可选升级/备份**，不默认启用。

未来用户可以在 `Account → Models` 页面按 layer 覆盖默认（复用已有的
`AgentModelConfig` 基础设施，见 "八、用户自选模型" 章节）。

### Layer 1 — 对话模型（聊天）

**文件**：`lib/agent/nlu-v2/chat.ts`

```typescript
export async function chatTurn(params: {
  history: Turn[];          // 完整对话历史（user + assistant）
  new_user_message: string; // 本轮用户消息
  state_summary: string;    // 人类可读的当前已知信息（由 Layer 2 生成）
  modelOverride?: LayerModel; // 用户在 Account 页设置的自定义模型
}): Promise<{ reply: string }>
```

- **默认模型**：`openai/gpt-4o-mini`
- **可升级到**：`anthropic/claude-sonnet-4-6`（用户在 Account 页选、
  或服务端感知到对话质量不够时 A/B 测试）
- System prompt ≤ 50 行：只讲"你是 Onegent 的旅行助手"，
  **不教识别场景、不教必填字段、不教 JSON 格式**
- Prompt 里注入 `state_summary`（Layer 2 产出的人类可读摘要），
  比如 "User wants NY trip, 3 nights, from SFO, 2 people. Still needs: dates."

### Layer 2 — 记忆提取器（状态提取）

**文件**：`lib/agent/nlu-v2/extractor.ts`

```typescript
export async function extractState(params: {
  prev_state: IntentState | null;
  new_user_message: string;
  new_assistant_reply: string;    // Layer 1 的回复
  modelOverride?: LayerModel;     // 用户覆盖
}): Promise<IntentState>
```

- **默认模型**：`openai/gpt-4o-mini`（JSON mode 原生支持、便宜、快）
- **可升级到**：`anthropic/claude-haiku-4-5`（成本可对比，latency 可能略低）
- 用 OpenAI JSON mode 强制结构化：`response_format: { type: "json_schema", schema: ... }`
- 切到 Anthropic 时用 `tool_use` 包装等效的 schema-forced output
- System prompt：20 行，单一职责 "merge 旧 state 和新对话，输出 new state"
- **幂等**：同样输入输出相同，易测

### Layer 3 — 代码路由器（决策）

**文件**：`lib/agent/nlu-v2/router.ts`

```typescript
export function routeIntent(state: IntentState): RouterAction {
  // 纯函数，无 side effect，无 async
  if (state.intent === "chitchat") return { type: "continue_chat" };
  if (!state.scenario) return { type: "ask_clarification", missing: ["scenario"] };

  const missing = getMissingForScenario(state);
  if (missing.length > 0) return { type: "ask_clarification", missing };

  if (state.scenario === "trip" && state.party_type === "solo") {
    return { type: "show_confirm_card", kind: "trip" };
  }
  if (state.party_type === "multi") {
    return { type: "show_confirm_card", kind: "room" };
  }
  return { type: "show_confirm_card", kind: "plan" };
}
```

- **不调 LLM，不 fetch，纯 TypeScript**
- 100% 可单测
- 所有"必填字段"定义在**一个**地方（types.ts 里 schema），这里只是消费

================================================================
四、为什么选 Plan C（vs A 和 B）
================================================================

用户已确认（2026-04-23 对话记录）。重新列一下对比表备查：

| 维度 | Plan A（现状 + 补丁） | Plan B（全 agentic tool-use） | **Plan C（三层分离）** |
|------|-------------------|----------------------------|---------------------|
| 对话自然度 | 中 | 高 | 高 |
| 决策可控性 | 中 | 低（模型自行决定） | **高（代码决定）** |
| 单轮成本 | 低 | 高（大模型 + 多轮 tool call）| 中 |
| 新场景成本 | 改 prompt（痛苦）| 加 tool schema | 加 intent type + schema 行 |
| 可调试性 | 中 | 低（黑盒 reasoning）| **高（三层独立测）** |
| Stage 2 DR 适配 | 要改 prompt | 要加 room 相关 tool | **每成员独立跑 Layer 2，服务端合并**|

Plan C 在"对话自然 + 决策可控 + 成本 + 扩展性"四个维度都平衡得最好。

参考：Perplexity、Harvey（法律 AI）、Cursor Composer 都采用这种三层模式。

================================================================
五、分阶段迁移策略
================================================================

**原则**：不要 big-bang 重写。先让 trip 场景用 v2，验证 1 周，再按
场景迁移其他 4 个。老 NLU 暂时保留作后备。

### Phase A · 试点：trip 场景走 v2（3-5 天）

- 建 `lib/agent/nlu-v2/` 目录
- 只实现 trip 场景（复用 Phase 1 已有的 TripIntentState）
- `/api/chat/parse` 里 **只有** scenario=trip 的请求走 v2，其他走 v1
- 前端 `ConversationalChat` 保持不变

### Phase B · 迁移 solo 单品类（3-4 天）

- 逐个迁移 restaurant / hotel / flight / activity
- 每迁一个 scenario 就跑一次 E2E 回归
- 迁完后老 NLU 的 solo 单品类路径删掉

### Phase C · 迁移 create_room（2 天）

- Decision Room 相关 intent 迁到 v2
- 此时 v1 可以整体删除
- PROJECT_SUMMARY / CLAUDE.md 更新"NLU 入口"章节

### Phase D · 清理 + Stage 2 DR 铺路（1-2 天）

- `lib/conversational-nlu.ts` 整个删掉
- 更新 `app/api/chat/parse/route.ts` 只指向 v2
- Layer 2 提取器复用在 Stage 2 DR 的"每成员私聊 state 提取"里

================================================================
六、任务列表（Task level · 严格按顺序执行）
================================================================

### Phase A · Trip 试点（先做这一批）

T1. 新建 `lib/agent/nlu-v2/types.ts`
    · `IntentState` 联合类型（scenario-specific 变体）
    · `RouterAction` 联合类型（continue_chat / ask / confirm / run_planner）
    · 复用 Phase 1 的 `TripIntentState`
    · 工作量：0.5d

T2. 实现 Layer 3 路由器 `router.ts`
    · `routeIntent(state): RouterAction` 纯函数
    · `getMissingForScenario(state): string[]` 支持 trip + 其他 4 场景
    · 单测覆盖 12 种 state 组合
    · 工作量：0.5d

T3. 实现 Layer 2 提取器 `extractor.ts`
    · OpenAI gpt-4o-mini + JSON mode
    · 输入 prev_state + new_turn，输出 new state
    · 初期只支持 trip scenario（其他 scenario 在 T6）
    · 工作量：1d

T4. 实现 Layer 1 聊天 `chat.ts`
    · Claude Sonnet 4.6 或 gpt-4o-mini（择一实测）
    · Prompt 短、注入 state_summary
    · 工作量：0.5d

T5. 接入 `/api/chat/parse` 的 trip 分支
    · 检测 `scenario_hint === "trip"` 或上下文暗示 trip → 走 v2
    · 其他场景仍走 v1
    · 返回格式向后兼容（仍是 ConversationalNLUResult shape 的子集）
    · 工作量：0.5d

T6. Phase A 验收
    · 用 10 种 NY trip 自然表达实测
    · 对比 v1 / v2 的 missing_fields 正确率
    · 对比 assistant reply 自然度（主观，但应明显更好）
    · 如果验收过 → 进 Phase B；不过 → 根据失败类型回炉

### Phase B · Solo 单品类迁移（各 0.5-1d）

T7. Restaurant 场景加到 Layer 2 extractor + Layer 3 router
T8. Hotel 场景加到 Layer 2 + Layer 3
T9. Flight 场景加到 Layer 2 + Layer 3
T10. Activity 场景加到 Layer 2 + Layer 3

每迁一个都跑 5 个场景回归（以防 schema 变动 regress）。

### Phase C · Decision Room 迁移（2d）

T11. create_room intent 加到 Layer 2 + Layer 3
T12. `app/api/chat/commit/route.ts` 改成只消费 RouterAction，不再读 v1 字段
T13. 删 `lib/conversational-nlu.ts`

### Phase D · 清理 + 文档（1d）

T14. PROJECT_SUMMARY / CLAUDE.md 更新 NLU 章节
T15. Stage 2 DR 前置：Layer 2 extractor 在 room 场景支持"匿名多人合并"

================================================================
七、关键数据契约
================================================================

### IntentState（Layer 2 产出，Layer 3 消费）

```typescript
type IntentState = {
  // 元信息
  confidence: number;          // 0-1，Layer 2 对提取质量的自评
  turn_count: number;          // 累计轮数
  updated_at: string;          // ISO timestamp

  // 核心分类
  intent:
    | "chitchat"
    | "create_plan"
    | "create_room"
    | "refine_existing"
    | "unknown";

  scenario:
    | "restaurant"
    | "hotel"
    | "flight"
    | "activity"
    | "trip"
    | null;

  party_type: "solo" | "multi";
  member_names: string[];

  // Scenario-specific 子状态（只填当前 scenario 对应的）
  restaurant?: RestaurantIntentFields;
  hotel?: HotelIntentFields;
  flight?: FlightIntentFields;
  activity?: ActivityIntentFields;
  trip?: TripIntentState;       // 直接复用 Phase 1 的

  // 历史
  planning_assumptions: string[];
};
```

### RouterAction（Layer 3 产出，/api/chat/parse 消费）

```typescript
type RouterAction =
  | { type: "continue_chat" }
  | { type: "ask_clarification"; missing: string[]; suggested_quick_picks?: QuickPick[] }
  | { type: "show_confirm_card"; kind: "plan" | "room" | "trip"; state: IntentState }
  | { type: "run_planner"; scenario: Scenario; state: IntentState };
```

### `/api/chat/parse` 新响应 shape（向后兼容 ConversationalNLUResult 的关键字段）

```typescript
{
  intent: IntentState["intent"],
  scenario: IntentState["scenario"],
  party_type: IntentState["party_type"],
  member_names: string[],
  collected_constraints: Record<string, unknown>;  // 从 IntentState flatten 出来
  missing_fields: string[];                        // 从 RouterAction.missing 来
  suggested_clarify_question: string | null;       // Layer 1 的 reply
  suggested_quick_picks: QuickPick[] | null;
  confirm_ready: boolean;                          // action.type === "show_confirm_card"
  assistant_reply: string | null;                  // Layer 1 的 reply
  refined_target_id: string | null;

  // 新增（v2 only）
  __v2_state?: IntentState;                        // 后端调试用，前端忽略
  __v2_action?: RouterAction;                      // 后端调试用
}
```

向后兼容很关键——**前端 `ConversationalChat.tsx` 和 `ConfirmCard.tsx` 不用动**，
只要 `/api/chat/parse` 返回的 shape 对齐就行。

================================================================
八、用户自选模型 · 复用现有 AgentModelConfig 基础设施
================================================================

好消息：前端已经有 `lib/agent-model-config.ts` + `Account → Models`
UI 骨架，支持按 layer 存用户自选模型到 `localStorage["agent_model_config"]`。
NLU v2 直接复用即可，不用重新造轮子。

【现有数据结构】

```typescript
interface AgentModelConfig {
  conversational?: LayerModel;  // ← NLU v2 Layer 1 读这个
  browser?: LayerModel;         // Stagehand 在用
  reasoning?: LayerModel;        // ← NLU v2 Layer 2 读这个
  ranking?: LayerModel;          // 餐厅/酒店排序器（已用 gpt-4o-mini）
}

interface LayerModel {
  provider: "minimax" | "openai" | "anthropic" | "google";
  model: string;          // e.g. "gpt-4o-mini" / "claude-sonnet-4-6"
  apiKey?: string;         // 用户自己的 key，省下服务端额度
}
```

【v2 的 resolve 顺序】

```typescript
function resolveModel(layer: "conversational" | "reasoning"): LayerModel {
  const userConfig = loadAgentModelConfig()[layer];
  if (userConfig) return userConfig;                         // 1. 用户覆盖
  return { provider: "openai", model: "gpt-4o-mini" };       // 2. 默认
}
```

Layer 1 / Layer 2 都走这个 resolver。用户没配 → gpt-4o-mini；配了 → 用他们选的。

【常见用户配置示例】

| 用户类型 | Layer 1 选择 | Layer 2 选择 | 成本变化 |
|---------|-------------|-------------|---------|
| 默认（大多数） | openai/gpt-4o-mini | openai/gpt-4o-mini | 最低 |
| 要更自然对话 | anthropic/claude-sonnet-4-6 | openai/gpt-4o-mini | 对话 +10x，提取不变 |
| 要完全自主（Anthropic 生态）| anthropic/claude-sonnet-4-6 | anthropic/claude-haiku-4-5 | +3-10x |
| 用自己的 key 省公司额度 | openai/gpt-4o-mini + 自己的 key | 同上 | 用户自掏腰包，对我们免费 |

【SDK 抽象】

为了支持多 provider，我们需要一个薄 SDK 层 `lib/llm-client.ts`（已存在骨架但没实现）。
Phase A 先只实现 OpenAI，其他 provider 在 Phase B 之后补。

```typescript
// lib/llm-client.ts
export async function chatCompletion(params: {
  layer: LayerModel;              // provider + model 信息
  system?: string;
  messages: Message[];
  max_tokens?: number;
  timeout_ms?: number;
  response_format?: "json_object" | "text";
}): Promise<{ text: string }>
```

内部按 provider 分发：
- `openai` → `lib/openai.ts` 的 `openaiChat`（已有）
- `anthropic` → 用 `@anthropic-ai/sdk`（package.json 已装）
- `minimax` / `google` → Phase D 之后再加（现在不急）

================================================================
九、风险 + 缓解
================================================================

R1. **Layer 2 提取偏差**（幻觉 / 漏字段 / 填错字段）
    缓解：OpenAI JSON mode + 严格 schema 校验（Zod）。不符 schema 直接重跑。
    兜底：若连续 3 轮提取失败，降级到 v1（老 NLU）跑一次。

R2. **Layer 1 对话风格漂移**（太啰嗦 / 过度澄清 / 擅自做决定）
    缓解：system prompt 里明确 "你不做任何决定，只聊天"。
    测试：收集 50 条真实用户 transcript，跑两个版本对比。

R3. **成本上涨**（每轮多一次 LLM 调用）
    缓解：Layer 2 用 gpt-4o-mini，成本 ~$0.0001/轮，可忽略。
    Layer 1 用 Sonnet 4.6 实际上比当前 MiniMax 贵但体验差距大，值。

R4. **迁移期双轨 bug**（部分场景 v1 部分 v2，状态不一致）
    缓解：Phase A 只动 trip，其他场景冻结 v1。每场景迁移都单独 PR。

R5. **Stage 2 DR 多成员状态合并复杂度**
    缓解：本文不覆盖 Stage 2 设计。Phase D 只做"预留接口"，真正实现
    放到 Stage 2 计划中。

================================================================
十、决策记录（ADR 精华）
================================================================

ADR-C1. Layer 1 和 Layer 2 都默认 OpenAI gpt-4o-mini
  日期：2026-04-23
  决策：两层都用 gpt-4o-mini 作默认
  理由：
  - 同 provider、同 key、同 SDK（用 fetch 直连，无新依赖，已有 lib/openai.ts）
  - JSON mode 原生支持（Layer 2 严格 schema 验证需要它）
  - 对话自然度 gpt-4o-mini 对一个"帮用户收集旅行信息"的场景够用
  - 最便宜：两层加起来每轮 ~$0.0002
  - 切到 Claude Sonnet 4.6 会涨 10x 成本，收益要看 A/B 数据决定
  Claude Sonnet 4.6 + Haiku 4.5 保留作备份模型，见下面 ADR-C2。

ADR-C2. Claude Sonnet/Haiku 作为 optional upgrade，不默认启用
  日期：2026-04-23
  决策：anthropic 模型通过 `AgentModelConfig` 让用户自选
  理由：
  - 部分用户愿意为更自然的对话付费（或用他们自己的 Anthropic 额度）
  - 服务端如果发现某些场景 gpt-4o-mini 效果差（比如中文长对话），
    可以 A/B 服务端强制升级到 Sonnet
  - 复用已存在的 `lib/agent-model-config.ts` 的 layered config 基础设施，
    前端 Account 页已经有 UI 框架
  预留的 Layer 映射：
    `conversational` → Layer 1（聊天）
    `reasoning` → Layer 2（状态提取）
    `browser` → 已用于 Stagehand，不归 NLU 管
    `ranking` → 保留给餐厅/酒店排序器用（现在已经是 gpt-4o-mini）

ADR-C3. 不搞 full agentic tool-use（Plan B）
  日期：2026-04-23
  决策：不让 LLM 直接 call booking tool
  理由：(1) payment 侧风险大 (2) Stage 2 DR 需要聚合多人 state，
  tool use 模型下每人的 state 封装不清晰
  参考：Devin / Cursor Composer 也是三层分离，不是 full agentic

ADR-C4. 前端 UI 不变
  日期：2026-04-23
  决策：保留 `ConversationalChat` + `ConfirmCard` 组件
  理由：重构只动后端 NLU。新 API 响应兼容老 shape。
  Stage 2 DR 再考虑前端改动。

ADR-C5. 老 NLU 迁移完后**删掉**，不保留作后备
  日期：2026-04-23
  决策：Phase C 完成后立即删 `lib/conversational-nlu.ts`
  理由：保留双轨会滋生 drift。一刀切，出了问题回滚 git commit。

================================================================
十一、代码入口 + 迁移映射
================================================================

### 新建（v2）

```
lib/agent/nlu-v2/
  types.ts           — IntentState / RouterAction 联合类型
  extractor.ts       — Layer 2 状态提取器（OpenAI JSON mode）
  chat.ts            — Layer 1 对话模型（Claude Sonnet）
  router.ts          — Layer 3 代码路由器（纯函数）
  schema-trip.ts     — Trip scenario 的 JSON schema
  schema-restaurant.ts
  schema-hotel.ts
  schema-flight.ts
  schema-activity.ts
  index.ts           — 对外暴露 analyzeConversationalV2
```

### 修改（已有文件）

- `app/api/chat/parse/route.ts` — 添加 v2 分支
- `PROJECT_SUMMARY.md` — NLU 章节重写
- `CLAUDE.md` — 如有 NLU 相关规则需更新

### 删除（Phase C 结束后）

- `lib/conversational-nlu.ts`（817 行）
- 相关测试文件（如果有）

================================================================
十二、下一步 · 立即行动
================================================================

1. 本计划提交到 git（与 PROJECT_SUMMARY.md 同级）
2. **Stage 1 Trip Packaging 完整验收通过后**再开工 Phase A（不抢占当前闭环）
3. T1 开始前，先手写 10 条 trip 场景的预期输入 / 预期 state / 预期 router action
   作为 v2 的"金标准测试集"
4. Phase A 做完先用这 10 条跑回归，再放开实盘

================================================================
