# 自建 Browser Farm · 完整 Roadmap

> **写于**：2026-04-30
> **目的**：当 Browserbase 月成本压到毛利率 < 50% 时，按这份文档开工替换。
> **现状**：Browserbase free tier + restaurant 本地 chromium，0 付费用户，**这份文档是未来参考，不是当前任务**。

---

## 🚨 启动条件（满足任意 2 条才开始 spec）

1. **付费用户已稳定 ≥ 500**（PMF 已验证）
2. **Browserbase 月账单 ≥ $1500**（数学上回本可见）
3. **有 cofounder / engineer 可以分担运维**（避免独干燃尽）
4. **拿到种子轮 / 有真实预算**（不是 burn 个人 runway）

**全不满足就别开始**。当前（2026-04-30）满足 0 条。

---

## 0. 决策上下文

### 为什么不能纯自建（必须买的服务）
| 反检测点 | 自建方案 | 工作量 | 必须外包？ |
|---|---|---|---|
| Bot fingerprint | playwright-stealth + puppeteer-extra | 1 周 | 否 |
| WebGL/Canvas noise | 注入随机 noise | 3 天 | 否 |
| TLS fingerprint | curl-impersonate / undici | 2 周（很难） | 否（但难） |
| **Residential IP 池** | — | — | **必须买**（Bright Data / Oxylabs / SmartProxy） |
| Human mouse | bezier-curve（开源参考 ghost-cursor） | 3 天 | 否 |
| **CAPTCHA 求解** | — | — | **必须买**（2Captcha / Anti-Captcha / CapSolver） |

**结论**：能自己写 70% 代码，但 residential IP + CAPTCHA solver 必须外购。

### 经济账（为什么值得做）
按 100,000 booking/月：
- Browserbase：$20,000/月
- 自建 farm：~$1,540/月
- **节省 92%**，毛利率从 33% 提升到 95%

---

## Phase 0 · Spec（1-2 天）

写一份 `BROWSER_FARM_DESIGN.md`，回答清楚：

1. **目标 SLA**：失败率 < %多少？延迟 P99 < 多少秒？
2. **目标吞吐**：要支撑多少并发 booking？高峰多少？
3. **需要解决的反检测列表**：哪些站点 / 哪些技术
   - Booking.com Cloudflare + PerimeterX
   - Expedia DataDome
   - OpenTable / Resy（弱反爬，可能不需要 farm）
   - Yelp Cloudflare（之前 rollback 因为撞不过）
4. **Browserbase 替换边界**：
   - 100% 替换？
   - 还是混合（restaurant 自建 + hotel/flight Browserbase 兜底）
5. **回退预案**：自建挂了怎么办（保留 Browserbase 双跑 fallback）
6. **灰度策略**：流量切多少 / 切多久 / 回退条件

---

## Phase 1 · 写代码（4-6 周纸面 / 真实 2-3 个月）

### 1.1 Stealth 层（~1 周）

**装包**：
```bash
npm i playwright-extra puppeteer-extra-plugin-stealth ghost-cursor-playwright
```

**覆盖的反检测**：
- WebGL / Canvas fingerprint noise
- `Navigator.webdriver = false`
- Chrome runtime 注入
- WebRTC IP 泄漏防护
- Bezier 鼠标轨迹（参考 ghost-cursor）
- Viewport / language / timezone 随机化

**坑**：
- playwright-stealth 默认配置 80% 站点能过
- 剩下 20%（Booking.com / Cloudflare 高级版 / DataDome）需要 case-by-case 调
- 每个站点改反爬都要追，每 2-3 个月一次

### 1.2 Proxy 层（~3 天）

- 在 Playwright `launch()` 时挂 residential proxy（HTTP/HTTPS）
- 实现 proxy rotation（每个 session 换不同 IP）
- 失败时自动换 IP 重试
- 监控 proxy 健康度（哪些 IP 被 ban 了，自动剔除）
- 按地理位置选 proxy（订美国酒店用美国 IP，欧洲用欧洲 IP）

### 1.3 Session Pool（~1 周）

- 启动 N 个 chromium 容器，每个挂不同 proxy + cookie jar
- 实现 borrow / release pool 管理
- Session 复用（同一用户跑 cookie 复用，加速 + 降反检测）
- Container 生命周期：跑 ~100 单后销毁重建（防 fingerprint 被锁）
- 优雅关闭（SIGTERM 等所有 in-flight booking 结束再关）

### 1.4 CAPTCHA Solver 集成（~2 天）

- 集成 2Captcha / Anti-Captcha / CapSolver SDK
- 检测 CAPTCHA → 截图 → 上传 → 等结果（~30 秒）→ 注入页面
- 失败重试 + 切 IP 重试
- 不同 CAPTCHA 类型分流（reCAPTCHA v2 vs v3 vs Cloudflare Turnstile）

### 1.5 监控 + 失败回放（~1 周）

- 每次 booking 录屏（playwright `trace.zip` 自带）
- 失败时自动上传 trace 到 Cloudflare R2
- Dashboard 看：
  - 成功率（按站点 / 按时段）
  - P50 / P99 延迟
  - 错误分布（CAPTCHA / 反爬 / payment / 其他）
- Slack / Discord 告警（成功率 < 80% 时）

### 1.6 Browserbase 接口适配（~2 天）

现在 `lib/booking-autopilot/stagehand-executor.ts` 已抽象好：
```ts
if (USE_SELF_HOSTED) selfHostedFarm.connect();
else if (USE_BROWSERBASE) browserbase.connect();
else playwright.launch();
```

新加 `lib/booking-autopilot/providers/self-hosted.ts`，实现 `BrowserProvider` 接口。

---

## Phase 2 · 买基础设施（1 天搞定）

### 2.1 服务器 ⭐ Hetzner（性价比之王）

| 型号 | CPU | RAM | 月费 | 能跑几个 chromium |
|---|---|---|---|---|
| **CCX23**（Dedicated AMD）| 4 vCPU | 16GB | **€16.90 (~$18)** | 8-12 个 |
| **CCX33** | 8 vCPU | 32GB | **€31.50 (~$33)** | 20-30 个 |
| **AX41-NVMe**（裸金属）| Ryzen 5 6 核 | 64GB | **€39 (~$41)** | 40+ 个 |

**为什么 Hetzner**：
- 数据中心：德国 / 芬兰 / **Ashburn VA**（美国东岸，离 Booking/Expedia 服务器近）
- 价格是 AWS 的 1/4 ~ 1/5
- 网络稳定（Cloudflare / 大公司在用）
- 上线快（5 分钟开机）

**怎么买**：
1. 注册 hetzner.com
2. 选 **Cloud Console**（不是 Robot 那个旧界面）
3. Create Server → Location: **Ashburn, VA**
4. Image: **Ubuntu 22.04 LTS**
5. Type: 起步 **CCX23** ($18/月)，跑 100 单测试，量大再升级
6. 上传 SSH key，关 password 登录
7. 5 分钟后服务器就绪

**备选方案**：
- **Railway**（$5-10/月，你已经在用）— 优点熟悉，缺点高负载 noisy neighbor
- **OVH / Contabo** — 比 Hetzner 更便宜，服务质量有波动

**不要用**：
- ❌ AWS EC2（贵 5 倍）
- ❌ DigitalOcean Droplet（相比 Hetzner 没优势）
- ❌ Vercel / Netlify（serverless 跑不了 chromium）
- ❌ 家用 NAS / 旧笔记本（住宅 IP 给 booking 站当机器人提防你）

### 2.2 Residential Proxy 池（必买）

| 服务 | 起步价 | 备注 |
|---|---|---|
| **Bright Data** | $500/月起，按 GB | 业界标杆，IP 池最大 / 最干净 |
| **Oxylabs** | $300/月起 | 性价比好 |
| **SmartProxy** | $75/月起，5GB | **起步推荐** |
| **IPRoyal** | $1.75/GB 按需 | 最便宜，质量中等 |

**起步**：买 **SmartProxy $75/月** 或 **IPRoyal $50/月（30GB）**，跑通后再升级 Bright Data。

**为什么必须买**：
- 你家宽带 IP 跑 100 次 Booking.com → 立刻被 ban
- Hetzner IP 是 datacenter IP → Booking 直接 challenge
- 必须用**真实住宅 IP** 才能模拟普通用户

### 2.3 CAPTCHA Solver

| 服务 | 价格 | 备注 |
|---|---|---|
| **2Captcha** | $1/1000 reCAPTCHA v2 | 最便宜 |
| **Anti-Captcha** | $2/1000 | 速度快，准确率高 |
| **CapSolver** | $1.5/1000 | 支持新 Cloudflare Turnstile |

**起步**：充 $20 进 2Captcha，够用 20,000 次。

### 2.4 监控 / 错误追踪

| 服务 | 价格 | 用途 |
|---|---|---|
| **Sentry** | Free tier 5k errors/月 | 错误追踪 |
| **Better Uptime** | $24/月 | 服务可用性监控 |
| **Hetzner / Railway 自带** | 免费 | CPU / RAM 图表 |
| **Discord webhook** | 免费 | 告警通知 |

### 2.5 Storage（存 trace.zip / 失败截图）

| 服务 | 价格 | 备注 |
|---|---|---|
| **Cloudflare R2** | $0.015/GB（egress 免费）| **首选** |
| **Backblaze B2** | $0.005/GB | 更便宜 |
| **AWS S3** | 贵且 egress 收费 | 不推荐 |

---

## Phase 3 · 上线 + 监控（1-2 周）

### 3.1 部署链
```
GitHub master push
  ↓ GitHub Actions
build Docker image
  ↓ push to ghcr.io
SSH 进 Hetzner
  ↓ docker pull + restart
healthcheck pass
  ↓
切流
```

### 3.2 灰度切流（永远不要一次性切全部）

| 周 | 自建流量 | 备注 |
|---|---|---|
| 第 1 周 | **5%** | 只跑 restaurant |
| 第 2 周 | **25%** | 加 hotel |
| 第 3 周 | **50%** | 加 flight |
| 第 4 周 | **100%** | Browserbase 进 fallback 模式 |

**回退条件**：成功率 / 延迟 / 错误率任一比 Browserbase 差 > 10% → 立刻回退。

### 3.3 应急预案
- 自建挂了 → 自动 fallback Browserbase（5 秒切换）
- 监控告警 → Slack/Discord 推到手机
- **必须有**：一键回退脚本（改一个 env var 全切回 Browserbase）

---

## Phase 4 · 持续维护（永久）

### 4.1 日常工作（每周 1-2 小时）
- 看 Sentry 错误日志
- 调反检测策略（站点改反爬时跟进）
- 监控 proxy 池健康度
- 升级 chromium 版本

### 4.2 定期事件（每 2-3 个月）
- 大反爬升级（Booking/Expedia 改规则）→ 1-2 周修复期
- 这就是为什么自建有维护成本，Browserbase 帮你扛了这个

### 4.3 团队风险
- 你独干：每次反爬升级 1-2 周燃尽
- **强烈建议**：自建启动那一刻起，至少要有 1 个 cofounder/engineer 能接手运维

---

## 完整成本表

### 阶段 1：500 用户 / 5k booking/月（刚启动自建）
| 项 | 月成本 |
|---|---|
| Hetzner CCX23 | $18 |
| SmartProxy 5GB | $75 |
| 2Captcha | $5 |
| Cloudflare R2 | $5 |
| Sentry | $0（free tier） |
| **总计** | **~$103/月** |

对比 Browserbase 同等流量：~$1,000/月 → **省 90%**

### 阶段 2：2000 用户 / 25k booking/月
| 项 | 月成本 |
|---|---|
| Hetzner CCX33 × 2 | $66 |
| Bright Data 50GB | $400 |
| 2Captcha | $25 |
| R2 | $20 |
| **总计** | **~$510/月** |

对比 Browserbase：~$5,000/月 → **省 90%**

### 阶段 3：10000 用户 / 100k booking/月
| 项 | 月成本 |
|---|---|
| Hetzner AX41 × 4（裸金属） | $164 |
| Bright Data 200GB | $1,200 |
| 2Captcha | $100 |
| R2 | $50 |
| Better Uptime | $24 |
| **总计** | **~$1,540/月** |

对比 Browserbase：~$20,000/月 → **省 92%**

---

## 替代策略 —— 先做这些再考虑自建

比起自建，**先省 50% Browserbase 用量更快**：

1. **缓存 search 结果**（同一城市 / 日期 30 min 内复用）→ 砍 30% 用量
2. **用 API 而非 browser**（Yelp Fusion API / Resy GraphQL / OpenTable 公开 endpoint）→ 砍 20% 用量
3. **Session 复用**（失败重试时不重新登录）→ 砍 10% 用量
4. **失败提前 bail**（CAPTCHA 早期检测，不浪费 5 分钟）→ 砍 5% 用量

**总能砍 50-65% 用量**，比自建快 10 倍见效，立刻把毛利率从 33% 拉到 60%+。

**先做这些优化** → 再评估是否需要自建。

---

## 风险清单

### 技术风险
- **反爬升级周期**：Booking/Expedia 每 2-3 个月改一次反爬，每次 1-2 周修复
- **Proxy 池被 ban**：突然某天所有 IP 都不工作，备份 proxy 服务必须有
- **CAPTCHA 升级**：Cloudflare Turnstile / hCaptcha enterprise 比 reCAPTCHA 难解
- **Chromium 版本**：跟不上最新版会被识别为旧浏览器

### 运维风险
- **独干燃尽**：每次反爬危机都是你一个人扛
- **节假日故障**：Booking 反爬升级 + 你在度假 = prod 挂掉
- **monitoring 盲区**：早期监控不全，问题发现得晚

### 商业风险
- **法律灰色地带**：自动化 booking 是否违反 ToS？大量 booking 站 ToS 禁止自动化
  - 缓解：以"用户代理"身份操作（用户登录态 + 用户授权），不是无差别爬虫
  - Browserbase 帮你扛了一部分法律风险（"我们只是租浏览器"）
- **平台报复**：被识别后可能 ban 整个网段 / 起诉
- **Browserbase 突然倒闭/涨价**：如果你 100% 依赖，应急时间窗很短

---

## 哲学锚点

### DHH
> **"Buy when you can, build when you must."**
>
> 翻译：能花钱解决就别自己写。Browserbase 是"能花钱解决"的，等它真成为瓶颈再说。

### patio11
> **"Stop being scared about scale. Get the first 10 paying customers."**
>
> 翻译：你现在 0 付费用户，担心 10000 用户的 vendor lock-in 等于规划自己的婚礼前先担心离婚律师费。

### Linus
> **"Premature optimization is the root of all evil."**
>
> 翻译：6-8 周自建在没验证 PMF 前是负 ROI。先证明你需要 32k booking/月再说。

### Stripe（先付钱再自建的典范）
- 早期 100% 用 Postgres
- 规模化后 fork 自己的 Postgres 改造（cstore_fdw 等）
- **关键判断**：dependency 是早期速度，不是长期债

---

## 启动 checklist（当条件满足那天打开这份文档）

### Day 1：Spec
- [ ] 写 BROWSER_FARM_DESIGN.md
- [ ] 跟 cofounder / engineer 对齐 SLA + 灰度策略
- [ ] 确认预算（前 3 个月 ~$300/月 起步）

### Week 1-2：基础设施
- [ ] 注册 Hetzner，开 CCX23 (Ashburn VA)
- [ ] 注册 SmartProxy，买 5GB 起步
- [ ] 注册 2Captcha，充 $20
- [ ] Cloudflare R2 bucket 建好
- [ ] Sentry / Discord webhook 接通

### Week 3-6：写代码
- [ ] Stealth 层
- [ ] Proxy 层
- [ ] Session pool
- [ ] CAPTCHA solver
- [ ] 监控 + 录屏
- [ ] Browserbase 接口适配（lib/booking-autopilot/providers/self-hosted.ts）

### Week 7-8：灰度上线
- [ ] 5% restaurant → 25% → 50% → 100%
- [ ] 确认每周指标
- [ ] 准备一键回退脚本

### Week 9+：维护
- [ ] 每周 1-2 小时看 Sentry / 调反检测
- [ ] 每 2-3 个月预留 1-2 周做反爬升级响应

---

## 当前（2026-04-30）应该做什么

**什么都别做**。
- ❌ 不要 spec
- ❌ 不要买服务器
- ❌ 不要写 stealth 代码
- ✅ 做 #27 公开发布
- ✅ 拿到第一批付费用户
- ✅ 看 Browserbase 真实使用量

**当 4 条启动条件满足任意 2 条时**，打开这份文档从 Phase 0 开始执行。

---

> 这份文档是**未来工程的预付款**：现在花 2 小时写好它，将来真要做的时候直接照着干，不用再从头思考。
