# Phase 1 · Conversational Agent · 对话式入口 + 分层模型架构

**目标：** 让用户通过主页对话框直接创建任务，agent 自主判断单人/多人场景，自动创建 Plan 或 Decision Room。同时铺设分层模型切换的基础设施。

**工期：** 11-14 天（~2-3 周）

---

## 背景与决策上下文

### 产品愿景
- **愿景 1（远期）：Trip 超级容器** —— 多天酒店 + 多段机票 + 多顿餐厅 + activities 打包
- **愿景 2（Phase 1 聚焦）：对话压缩** —— 主页对话即唯一入口，"和 agent 说就行"

### 已定的产品决策
| 决策点 | 选择 |
|--------|------|
| 入口位置 | 主页对话框作为**唯一入口**（现有 Decision Room 填空页**保留作 backup**） |
| 对话产物 | Agent 自动判断单人（Plan）vs 多人（Room） |
| 反问方式 | 聊天气泡 + inline 选择按钮（quick-pick） |
| 确认机制 | Inline confirm card，点确认执行，点修改继续聊 |
| 多人模式 | **模式 A（分布式对话 + Room 内独立约束）+ 模式 C（创建者代报）兼容壳** |
| 场景顺序 | 餐厅多人 → 复制到 hotel/flight → 单人 activity |
| NLU 策略 | 全量走大模型（放弃英文 regex 快速路径） |

### 技术决策
| 决策点 | 选择 |
|--------|------|
| Model 架构 | **分层模型**（conversational / browser / 预留 reasoning、ranking） |
| 默认 Conversational 模型 | MiniMax |
| 默认 Browser 模型 | openai/gpt-4o-mini（现状不变） |
| Provider 实现范围 | Phase 1 只完整实现 MiniMax，其他 3 个留 stub |
| UI 显示范围 | 显示 "Coming Soon" 预留 layer，强化产品野心叙事 |

---

## 架构设计

### 分层模型配置
```ts
interface AgentModelConfig {
  conversational?: LayerModel;  // 对话理解/NLU
  browser?: LayerModel;          // 浏览器自动化（已存在）
  reasoning?: LayerModel;        // [Coming Soon] 提案生成/排序
  ranking?: LayerModel;          // [Coming Soon] 未来扩展
}

interface LayerModel {
  provider: "minimax" | "openai" | "anthropic" | "google";
  model: string;
  apiKey: string;
}
```

### llm-client 抽象层
```
lib/llm-client.ts
  └─ chatCompletion({ layer, system, messages, response_format, max_tokens })
       └─ resolveModelForLayer(layer) → LayerModel
       └─ 路由到具体 provider:
            providers/minimax.ts    ✅ 完整实现
            providers/openai.ts     🟡 stub
            providers/anthropic.ts  🟡 stub
            providers/google.ts     🟡 stub
```

### 迁移兼容
老 localStorage: `agent_model_config = {model, apiKey}` （曾经只给 Stagehand 用）
新 localStorage: `agent_model_config = {browser: {provider, model, apiKey}, conversational: null}`
迁移：首次加载时自动把老字段搬到 `browser` slot。

---

## 对话式 NLU Schema

```ts
interface ConversationalNLUResult {
  intent: "create_plan" | "create_room" | "refine_existing" | "chitchat" | "other";
  scenario: "restaurant" | "hotel" | "flight" | "activity" | "trip" | null;
  party_type: "solo" | "multi";
  member_names: string[];      // e.g. ["李明", "老王"]
  collected_constraints: Record<string, unknown>;  // 已经从对话收集到的约束
  missing_fields: string[];    // 还缺什么
  suggested_clarify_question: string | null;  // agent 建议的下一个反问
  suggested_quick_picks: Array<{label: string; value: string}> | null;  // inline 按钮选项
  confirm_ready: boolean;      // 是否可以弹 confirm card
  refined_target_id: string | null;  // refine 意图时指向的 plan/room id
}
```

多轮 conversationHistory 传入。

---

## 完整 Task List

### 第 1 阶段 · 基础设施（2-2.5 天）
- **P1-01** 新建 `lib/llm-client.ts` 分层抽象（`chatCompletion({layer, ...})`）
- **P1-01b** 4 个 provider 实现：`lib/providers/minimax.ts`（完整）+ `openai.ts` / `anthropic.ts` / `google.ts`（stub，类型签名对齐）
- **P1-01c** `AgentModelConfig` schema 改分层 + 老数据自动迁移
- **P1-02** 新建 `lib/conversational-nlu.ts`（调 `chatCompletion({layer: "conversational"})`）

### 第 2 阶段 · 后端桥接（1.5-2 天）
- **P1-03** `POST /api/chat/parse` —— 每次用户说话调这个，返回完整 NLU 结构化结果
- **P1-04** `POST /api/chat/commit` —— confirm card 点确认时调，根据 intent + party_type 路由到 `/api/rooms` 或 `/api/plan/save`
- **P1-04b** Stagehand 集成切换到 `config.browser`（老字段搬家后直接读新路径）

**→ 本阶段结束用户 curl 验证一次**

### 第 3 阶段 · UI（3-3.5 天）
- **P1-05** 主页 chat 组件扩展（多轮气泡 + inline 按钮）
- **P1-06** Confirm card 组件 —— 显示 agent 打算做什么，点确认执行，创建成功后变为"跳转入口"可点进去看详情 + logs
- **P1-07** 现有 Decision Room 填空入口保留作 backup（不动）
- **P1-07b** `AgentModelTab` UI 重设计：2 个 section（Conversational + Browser）+ Coming Soon 预留（Reasoning / Ranking）

### 第 4 阶段 · 餐厅多人 Room 打通（1.5-2 天）
- **P1-08** NLU prompt 打磨 —— 餐厅场景多人意图识别，测试用例：
  - "我和李明想周五晚上吃日料"
  - "约几个朋友周末聚餐"
  - "组个饭局"
  - "我一个人想找米其林"（区分 solo vs multi）
- **P1-09** 对话 → Room 桥接：creator 约束自动填入，邀请链接生成
- **P1-10** 模式 C 兼容：creator 在对话里帮 member 代报约束（写为该 member 的默认约束，member 加入后可覆盖）
- **P1-11** E2E 手动测试 4 个餐厅多人场景

### 第 5 阶段 · 复制 + 单人 activity（3-4 天）
- **P1-12** 复制 pattern 到 hotel Room
- **P1-13** 复制 pattern 到 flight Room
- **P1-14** 新增 activity 品类（单人版）—— 接入 Ticketmaster pipeline，scenario = concert_event

---

## Phase 1 完成标准（DoD）

1. ✅ 用户在主页对话框说"我想和李明周五 7 点吃日料"，agent 生成 confirm card，点确认创建出 restaurant Room
2. ✅ 用户说"我想这周六找个米其林"，agent 识别为单人意图，创建出 restaurant Plan
3. ✅ 同样 pattern 在 hotel / flight 也能跑通
4. ✅ 用户说"我想看周末的演唱会"，agent 创建单人 activity Plan
5. ✅ Account → Models 页显示 2 section + Coming Soon 预留
6. ✅ 原有 Decision Room 填空入口仍然可用
7. ✅ llm-client.ts 抽象层就绪，未来加 provider 只需新增一个 file

---

## 后续 Phase 路线图

**Phase 2 · A 方案**：补全 Activities 填空版 + Activities Decision Room（多人活动场景）

**Phase 3 · B 方案**：Trip 超级容器 —— 跨品类打包、时间轴、预算池、联动取消

**Phase 4**：全局模型切换重构 —— 把 reasoning / ranking 也接入 llm-client，把 "Coming Soon" 真的通车
