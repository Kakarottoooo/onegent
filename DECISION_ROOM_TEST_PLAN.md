# Decision Room — 测试计划

本文档汇总 Phase 1 → Phase 4 的全部功能，并给出每项的测试步骤、期望结果、以及
应该关注的边界情况。按顺序执行就能覆盖所有路径。

---

## 准备工作（一次性）

1. **本地启服务**：`npm run dev`
2. **三个账号**：准备三个 Clerk 账号（可用三种邮箱 / 无痕窗口 / 三个浏览器配置）。
   命名：**A** = 创建者 / 付款人，**B** = 联系人 2，**C** = 联系人 3。
3. **每个账号登录一次**，确保 `ClerkSync` 触发、生成 `user_profiles` 行（含 `profile_code`）。
   验证：访问 `/contacts`，顶部显示自己的 `@XXXXXX` 六位码。
4. **A 完成 booking profile**：访问 `/permissions` → "My Profile" tab → 填 first_name / last_name / email /
   phone 并保存为默认。**不填这步会在 Execute 阶段 412**（这个路径也要测，见下方用例 F2）。

---

## 一、Phase 1 — 核心 2 人决策（回归测试）

### 用例 T1 · 基本 happy path（2 人 unanimous，最常见场景）

1. A 打开 `/rooms/new`
2. 类型选 Restaurant → 标题"Friday night" → City=Los Angeles → 日期窗口可留空 → 联系人里点选 B（chip 变黑 +✓）
3. Approval rule 区域应**被强制成 "Unanimous" 无法切换**，提示"With two people, both must approve. Add a third contact to unlock majority voting."
4. Party size=2，Payer=I am，点"Create room →"
5. A 被路由到 `/rooms/<id>`；B 列表 `/rooms` 里能看到该 room（无需输邀请码）
6. A 填写约束（budget / likes / dislikes / dietary / vibe）→ 点 Submit → 成员条 A 名字旁显示 ✓
7. B 打开 room，填约束并 Submit；成员条 B 名字旁也显示 ✓
8. 任何一方点 "🧭 Generate proposal →"
9. 等待（最多 60s），提案卡片出现：应显示 **1-3 个 option 卡片**，每张有 restaurant 名 / cuisine / price / 地址 / why recommended
10. A 点某张卡片的 "Pick this one" → MembersStrip A 变 ✓；卡片右上角出现 A 的头像
11. B 点**同一张**卡片 Pick → 变 accepted，出现绿色 "All members approved" 区块
12. A（payer）填 date / time / covers → "🤖 Start booking →"
13. 跳转到 `/?jobId=...` 看 booking job 执行

**期望**：全流程 < 5 分钟；聊天面板（页面底部）出现 agent 系统消息
"Proposed N options: …"、"All members approved … — ready to book."、"Booking started: …"。

**关注边界**：
- A 填约束但 B 还没填 → Propose 按钮不显示（需要 ≥ 2 submitted）
- A 填错内容想改：修改后按 "Update"；前后两次 tally 应合并（看 `/api/rooms/<id>/constraints` 返回一致）

---

### 用例 T2 · 2 人投票意见不同（哪个都选不出）

1. 复用 T1 的 room
2. Propose 后 A 选 option 1，B 选 option 2
3. **期望**：两人都是 ✓，但没有 accepted block 出现（因为 unanimous 要求所有人选同一个）
4. A 改投 B 选的那个（点 option 2 的 "Pick"），按钮从 "Picked ✓" 变到新卡片
5. **期望**：accepted 状态出现

**关注**：改投票是否顺利（`castRoomVote` ON CONFLICT UPDATE）。

---

### 用例 T3 · 2 人都 decline（auto-supersede）

1. 新建 room（A + B），提交约束，Propose
2. A 点 "Decline all"、B 也点 "Decline all"
3. **期望**：
   - 提案自动标 rejected（UI 中消失）
   - 房间状态回到 "Collecting"
   - 聊天面板出现 agent 消息"The group didn't approve this slate. Tweak your constraints and propose again."
   - Propose 按钮重新可用
4. A 改约束（比如放宽 budget）→ Propose 又能跑一遍

**关注**：两人中只有一人 decline 时不应 supersede（不到一半）。

---

## 二、Phase 1.5 — 联系人（Profile code 系统）

### 用例 T4 · 添加联系人

1. A 访问 `/contacts` → 复制自己的 `@ABCD23`
2. B 访问 `/contacts` → 在 "Add someone" 输入 A 的码（带不带 @ 都应可以）→ "Look up"
3. **期望**：预览出现 A 的头像 / display_name / profile_code
4. 输入 nickname（可选）→ "Add X →"
5. **期望**：A 出现在 B 的 contacts 列表；可编辑 nickname / 删除

**关注**：
- 输入自己的码 → 报错 "That's your own code"
- 输入不存在的码 → 报错 "No user with that code"
- 码输入时可自动大写（UI 上的 input 用了 `uppercase` class）

### 用例 T5 · 从房间反向加联系人（Phase 3-B1）

1. A 和 C 新共同创建一个 room（通过短码邀请或 A 先把 C 加进已有的）
   - 前置：C 还不是 A 的联系人
2. A 打开 room
3. **期望**：成员条 C 的名字后面出现 `+` 小按钮
4. A 点 `+`
5. **期望**：按钮消失（C 已成为 A 的联系人），访问 `/contacts` 能看到 C

**边界**：
- 自己的头像后面**不应**有 `+`
- 已是联系人的成员后面**不应**有 `+`
- 如果 A 和目标用户不共享任何 room（不该发生，因为成员条就是该 room 的成员），后端 403 拒绝

---

## 三、Phase 2 — 群组 + 多人决策

### 用例 T6 · 创建 / 管理 Group

1. A 访问 `/contacts` → 展开 "My groups" 折叠区
2. 输入 "College friends" → "Create"
3. 展开该 group → 在 "Add from your contacts" 多选 B、C → "Add 2 to College friends"
4. **期望**：group 显示 member_count=2，两人以 chip 显示
5. 点某 chip 的 × → 成员移除
6. 点 "Rename"（prompt）→ 改名 → 列表刷新
7. 点 "Delete" → 确认框 → 整个 group 消失（联系人本身**不**删除）

### 用例 T7 · 3 人 Majority 投票 happy path

1. A 打开 `/rooms/new`
2. 类型 Restaurant → 标题 "Team lunch" → city=Los Angeles
3. 如果 T6 已创建 group，点 `👥 College friends (2)` chip → 联系人区 B、C 自动被选（✓）
   - 或直接在联系人 chip 里手动多选 B + C
4. Approval rule 区域应**自动显示 Majority** 被选中（默认）；可切到 Unanimous
   **本次测试保持 Majority**
5. Party size=3，Payer=I am，Create
6. A、B、C 三人各自开 room 填约束并 Submit
7. 某人点 Propose → 生成提案
8. A 选 option 1，B 选 option 1，C 选 option 2
9. **期望**：Majority >50% → 1 号已得 2 票（2*2 > 3）→ 自动 accepted
10. 绿色 "Majority picked X — ready to book." 区块出现
11. A 完成 booking

**关注**：
- MembersStrip 里 A、B、C 的头像上应有 ✓ 对应各自投票
- 每个 option 卡右上角应有投票者头像（1 号有 A+B 头像，2 号有 C 头像）
- 聊天面板 agent 消息语气为"Majority picked …"

### 用例 T8 · 3 人 Unanimous 切换

1. 同 T7 setup，但 Approval rule 手动切到 Unanimous
2. 三人都选同一 option → 才能过
3. 如果 C 选了不同 option → 状态 stuck 在 Voting，无 accepted block

### 用例 T9 · 3 人里有冲突

1. 新建 3 人 room
2. 三人约束里写互相冲突的：
   - A："must have steak, likes American"
   - B："vegan only, no meat"
   - C："gluten-free, any cuisine"
3. Propose
4. **期望**：提案卡顶部红色 **Conflict banner** 显示
   - Reason 文本（MiniMax 生成）
   - `affected_user_ids` 头像加红圈
5. 提案仍会给出"最佳折中"选项，大家还是可以选 / decline

**关注**：如果 MiniMax 把冲突判得过严，所有人 decline → 走 T3 auto-supersede 流程。

### 用例 T10 · 3 人里过半 decline → auto-supersede

1. 同 T7 setup，Propose 后
2. A decline all、B decline all（2/3 > 1.5，达到阈值）
3. **期望**：提案立即 rejected，房间回 collecting，propose 可重试

---

## 四、Phase 3 — 多选 + 冲突 + 投票状态

### 用例 T11 · 多选卡片 + 改投

1. 任何 Propose 场景
2. 提案返回 **≥ 2 个 option**
3. A 点 option 1 → 卡片变深色（"Picked ✓"）
4. A 再点 option 2 → option 1 变回浅色，option 2 变深色（票被迁移）
5. **期望**：只有 option 2 右上角有 A 的头像；option 1 为空

### 用例 T12 · Vote state 显示

在任何 active proposal 存在时：
- MembersStrip 应在人名旁显示 ✓/✗/⟳/… 对应 approve/decline/request_changes/未投票
- Proposal 头部显示 "N/M approved · unanimous|majority"
- 没投票的人（未点过任何按钮）应显示 "…"

### 用例 T13 · Request changes

1. Propose 后某人点 "Request changes"
2. MembersStrip 该人变 ⟳
3. 其他人继续投，**如果 declines+request_changes > N/2**，触发 auto-supersede
4. 否则 proposal 保持 active，其他人可正常继续

---

## 五、Phase 4 — 边界 / 兜底 / 学习回路

### 用例 T14 · 改约束的时机

1. Room 状态 = collecting：约束表单完全展开，能编辑 ✓
2. 有人 Propose → 房间 = proposing（加载中）：约束表单仍展开，能编辑（理论上可在 agent 跑时继续改，但保存可能被 agent 用的是快照）
3. 提案生成 = approving：**约束表单应折叠成 "▼ edit"**，点击展开后可继续改
   - 改完保存 → 新约束生效（下次 Propose 会用新的）
4. 提案 accepted → executing / done：**约束表单完全隐藏**

### 用例 T15 · N=2 后端也被 force 成 unanimous

这是一个防御性测试（直接打 API 绕过 UI）：
```bash
curl -X POST http://localhost:3000/api/rooms -H "Content-Type: application/json" \
  -d '{"type":"restaurant","title":"hack","approval_rule":"majority"}'
```
如果创建者只邀请 1 人（N=2），后端 vote 路由里 joined.length<3 会 coerce 成 unanimous。
**测试方法**：看数据库 `decision_rooms.approval_rule` 是否实际写入 'majority'，但 vote 接受条件仍按 unanimous 判定。

### 用例 T16 · Execute 412（payer 没 booking profile）

1. A 创建 room 时 Payer=I am（或 They are，然后测试人切换）
2. 跳过 `/permissions` 的 My Profile 步骤
3. 走完投票 accepted 流程
4. A 点 "🤖 Start booking →"
5. **期望**：绿色面板底部出现**黄色提示**："Booking profile missing" + "Open Settings → My Profile" 按钮
6. 点击跳 `/permissions`，填好后回来重新点 Start booking → 成功

### 用例 T17 · 聊天面板

1. 任何 room，任何阶段
2. 底部 Chat 卡片
3. A 打字 + Enter 发送 → 自己消息靠右、黑底
4. B 账号的浏览器里最多 4 秒内应出现该消息（轮询）→ 左对齐、灰底、头像位置显示发送者名
5. Agent 系统消息（proposal_created / proposal_accepted / booking_started）自动出现，蓝底斜体 + 🤖 前缀
6. 时间戳（HH:MM）显示在每条消息

**关注**：如果 message 数量 > 200，后端只返最近 200 条（接口级截断），但不影响发送。

### 用例 T18 · 学习回路：约束回流到偏好档案

1. 完成一次完整的 T7 流程，accepted → booking 完成
2. A 访问 `/permissions` → "Taste Profile" tab（假设页面会渲染 `profile.discovered`）
3. **期望**：可以看到从本次 room 沉淀的 signals，例如：
   - "Likes italian"（如果 A 约束里写了）
   - "Accepted a Italian restaurant with the group"（来自 winning card）
   - "Dining budget ~$50/person"（来自 A 的 budget_max）
4. 再跑一次 T7，某 signal 的 seen_count 应该增加

**验证方式**（数据库层）：
```sql
SELECT profile_json->'discovered' FROM preference_profiles WHERE user_id = '<A_clerk_id>';
```
应该是一个数组，其中每个对象有 `source: "Room: <title>"`。

**关注**：回流是 fire-and-forget，即使失败也不影响 accept 本身。不应看到报错阻塞 UI。

---

## 六、综合回归 checklist

跑完以上所有用例后，还要检查：

- [ ] 房间列表 `/rooms` 正确显示状态 badge（Collecting / Voting / Booking / Done）
- [ ] 邀请码 Copy invite → 粘贴到另一个账号能打开 `/rooms/join/<code>` 自动加入
- [ ] 没登录状态访问 `/rooms/*` 都有"Sign in to…"兜底卡片
- [ ] Booking 完成后房间显示 ✅ Booked banner
- [ ] Chat 时间戳按本地时区显示
- [ ] Refresh 页面，状态正确恢复（polling 3s）
- [ ] 并发：A 和 B 同时提交约束 → 两条都在 members strip 显示 ✓（upsert 不冲突）

---

## 七、常见 bug 排查

| 症状 | 可能原因 |
|------|---------|
| Propose 按钮一直加载 | MiniMax / SerpAPI key 没配 或 超时。看浏览器 network → `/api/rooms/<id>/propose` 的 502 响应。 |
| Conflict banner 从不出现 | MiniMax prompt 判断保守。故意用互斥约束（vegan vs steak）复现。 |
| 投了 approve 但状态没变 | 看 network → vote 路由返回的 `accepted: false` + `tallies`，检查人数判定。 |
| 看不到别人的投票 | 轮询 3s 一次，稍等；或 refresh。 |
| 412 页面卡住 | 见 T16 — 需要填 booking profile。 |
| "Request changes" 投完无反应 | 正常。除非 declines+request_changes > N/2 才 supersede。 |
| 聊天消息重复闪烁 | ChatPanel 每 4s 拉一次 + 发送后立即刷新，正常。 |

---

## 八、Phase 4 新增功能速查

| 功能 | 文件 | 用例 |
|------|------|------|
| Auto-supersede on majority decline | `app/api/rooms/[id]/proposals/[pid]/vote/route.ts` | T3, T10, T13 |
| Execute 412 兜底 UI | `app/rooms/[id]/page.tsx::AcceptedBlock` | T16 |
| 约束 anytime 可改 + 折叠 UI | `app/api/rooms/[id]/constraints/route.ts` + `ConstraintForm` | T14 |
| N<3 强制 unanimous（双保险） | `app/rooms/new/page.tsx` + vote route | T1 (UI), T15 (backend) |
| Chat 时间戳 + 🤖 前缀 | `ChatPanel` | T17 |
| 学习回路（preference 回流） | `lib/rooms/learn.ts` + vote route | T18 |

---

## 九、不在本次测试范围（Phase 5+ 路线图）

- Hotel / Flight / Activity room 类型（目前 Coming soon 禁用）
- Email / web push 通知
- Deadline 倒计时 UI
- 手动 abandon / leave room / kick member
- Accepted 后反悔 / re-open
- Booking 完成后写入 scenario_events 做 dashboard 统计

---

**最后**：如果任何用例实际表现和期望不一致，把用例编号 + 浏览器 DevTools network 里的请求/响应
截图 / 贴出来。按 ID 追比按文字描述快很多。
