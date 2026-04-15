# Onegent

**Live:** [onegent.one](https://onegent.one/)

AI 决策代理——把"搜索 → 比较 → 筛选 → 推荐 → 执行 → 反馈 → 学习"整条链路交给 agent 自动完成，用户只做最终批准。

---

## 核心能力

### 多场景智能规划
用自然语言描述需求，agent 自动生成结构化方案：

- **餐厅** — 约会、商务宴请、快速午餐、特殊饮食
- **酒店** — 商务出差、周末度假、蜜月、家庭出游
- **航班** — 最低价、红眼回避、时段过滤
- **信用卡** — 组合缺口分析、开卡奖励排名
- **数码** — 笔记本、手机、耳机选购
- **活动票务** — Ticketmaster 真实票源
- **礼物** — Google Shopping 三档选项
- **健身** — 12 种运动类型，ClassPass / Mindbody 链接

**组合场景**：Date Night OS / Weekend Trip OS / City Trip OS / Big Purchase OS

### Autopilot 自动执行
方案批准后，agent 在后台自动操作预订平台：

- **酒店**：Booking.com / Expedia / Hotels.com — 全链路（搜索 → 选房 → 填表 → 支付页暂停）
- **餐厅**：OpenTable → Resy → Yelp → 官网直链 瀑布式回退
- 遇到障碍自主决策（时段 fallback / 场馆切换 / 重试）
- 实时浏览器直播（SSE 截图流，6fps）
- 完成后 Web Push 通知到设备

### 双人协作决策（Decision Room）
两人各自提交约束 → AI 合并冲突 → 实时投票 → 双方同时确认即锁定

### 持续学习
三层反馈闭环（实时卡片 / 事后 24h / session 偏好提取）→ 偏好持久化 → 跨设备同步 → 打分权重自动修正

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 14 (App Router) · TypeScript · Tailwind CSS |
| AI | MiniMax（NLU / 排序 / 评论解析）· Claude Haiku（视觉感知）· Stagehand / GPT-4o-mini（浏览器自动化）|
| 数据 | Google Places · SerpAPI · Tavily · Ticketmaster |
| 自动化 | Playwright（RPA 兜底）· BrowserProvider 接口（6 个平台 Provider）|
| 存储 | Neon PostgreSQL · localStorage |
| 认证 | Clerk |
| 推送 | Web Push (VAPID) · PWA |
| 部署 | Vercel |

---

## 本地开发

```bash
npm install
cp .env.local.example .env.local  # 填入 API keys
npm run dev
```

必需环境变量：`ANTHROPIC_API_KEY` · `POSTGRES_URL` · `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` · `CLERK_SECRET_KEY` · `GOOGLE_PLACES_API_KEY`

完整环境变量列表见 `PROJECT_SUMMARY.md`。

---

## 文档

详细架构、执行流程、数据库表结构、版本历史 → [`PROJECT_SUMMARY.md`](./PROJECT_SUMMARY.md)
