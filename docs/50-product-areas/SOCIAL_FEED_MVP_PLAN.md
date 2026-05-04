# Social Feed MVP — Plan

> 目标：在 `/u/<handle>` 上构建小红书 / 微信朋友圈风格的基础社交 feed，并把 Profile 入口提升到顶部导航栏（Tasks 旁边）。
> 作者：与用户对齐于 2026-04-30，待开工。
> 范围：基础版本，但功能完整自洽。

---

## 0. 核心决策（已对齐，不再讨论）

| # | 决策项 | 选择 | 理由 |
|---|--------|------|------|
| 1 | Post 形态 | **A. Trip-anchored**（必须挂 trip / booking） | 锁住 Onegent 的差异化，避免变成普通朋友圈克隆 |
| 2 | 关注模型 | **B. 单向 follow**（独立于 contacts） | contacts 是强连接（一起决策），follow 是弱连接（看内容），目的不同必须分表 |
| 3 | Profile 入口默认页 | **Following feed** `/feed`，不是自己主页 | 日常打开是为了看别人，不是看自己（Instagram 模型） |
| 4 | 可见性默认值 | **全公开**，单 post 可改"仅联系人" | SEO + 增长友好，敏感内容留出口 |
| 5 | 视频支持 | **不在 MVP** | 转码 / 带宽 / 审核成本太高，先验图文 |
| 6 | 互动原语 | **Like + Comment**（一级评论，无嵌套） | 最小可玩集合 |
| 7 | 图片存储 | **Vercel Blob** | 已有依赖，零新增 |
| 8 | Realtime | **不上 websocket** | 刷新即拉，MVP 够用 |

---

## 1. 数据模型（新增 5 张表）

### 1.1 `posts`
```sql
id              uuid PK
author_id       text NOT NULL  -- Clerk user id
trip_id         uuid          -- 可空：私聊房间产物 / 历史 trip
booking_job_id  uuid          -- 可空：单个 booking
caption         text NOT NULL  -- ≤ 500 字
location_label  text          -- "Nashville, TN" 等
location_lat    float
location_lng    float
visibility      text NOT NULL DEFAULT 'public'  -- 'public' | 'contacts'
like_count      int NOT NULL DEFAULT 0  -- 反规范化
comment_count   int NOT NULL DEFAULT 0  -- 反规范化
created_at      timestamptz NOT NULL DEFAULT now()
deleted_at      timestamptz  -- soft delete
```

约束：`trip_id` 和 `booking_job_id` 至少有一个非空（CHECK constraint）。

### 1.2 `post_images`
```sql
id          uuid PK
post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE
url         text NOT NULL  -- Vercel Blob URL
width       int
height      int
order_idx   int NOT NULL DEFAULT 0
created_at  timestamptz NOT NULL DEFAULT now()
```

### 1.3 `post_likes`
```sql
post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE
user_id     text NOT NULL
created_at  timestamptz NOT NULL DEFAULT now()
PRIMARY KEY (post_id, user_id)
```

### 1.4 `post_comments`
```sql
id          uuid PK
post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE
author_id   text NOT NULL
body        text NOT NULL  -- ≤ 300 字
mentioned_user_ids text[] DEFAULT '{}'  -- @-mention，复用现有 picker
created_at  timestamptz NOT NULL DEFAULT now()
deleted_at  timestamptz
```

### 1.5 `follows`
```sql
follower_id  text NOT NULL  -- 谁 follow
followee_id  text NOT NULL  -- 被 follow 的人
created_at   timestamptz NOT NULL DEFAULT now()
PRIMARY KEY (follower_id, followee_id)
CHECK (follower_id != followee_id)
```

索引：
- `posts(author_id, created_at DESC)` — profile feed
- `posts(visibility, created_at DESC)` — discover (v1)
- `follows(follower_id)` / `follows(followee_id)` — feed 和粉丝列表
- `post_likes(user_id, created_at DESC)` — "我赞过的"（v1）

---

## 2. API Routes

### 2.1 Posts
- `POST   /api/posts` — 创建 post（multipart：图 + caption + trip_id/booking_job_id + visibility）
- `GET    /api/posts/:id` — 单 post 详情（含图片 + 是否被当前用户 like）
- `DELETE /api/posts/:id` — soft delete（仅作者）
- `PATCH  /api/posts/:id` — 改 caption / visibility（仅作者，发布后 15 分钟内）

### 2.2 Feed
- `GET /api/feed/following?cursor=<created_at>&limit=20` — 我 follow 的人的 post，cursor 分页
- `GET /api/feed/profile/:handle?cursor=...&limit=20` — 某人的 profile feed（按可见性过滤）

### 2.3 Likes
- `POST   /api/posts/:id/like`
- `DELETE /api/posts/:id/like`
- `GET    /api/posts/:id/likes?cursor=...` — like 列表（v1 可不做）

### 2.4 Comments
- `GET  /api/posts/:id/comments?cursor=...&limit=20`
- `POST /api/posts/:id/comments` — body: `{ body, mentioned_user_ids }`
- `DELETE /api/posts/:postId/comments/:id`

### 2.5 Follows
- `POST   /api/users/:handle/follow`
- `DELETE /api/users/:handle/follow`
- `GET    /api/users/:handle/followers?cursor=...`
- `GET    /api/users/:handle/following?cursor=...`

### 2.6 上传
- `POST /api/uploads/post-image` — 走 Vercel Blob，返回 `{ url, width, height }`

---

## 3. UI 页面

### 3.1 顶 nav 改造
`components/GlobalNav.tsx:104` 当前：
```
Tasks | Calendar | Rooms | Contacts | Memory | Pricing
```
改为：
```
Tasks | Profile | Calendar | Rooms | Contacts | Memory | Pricing
        ↑ 新增（href = "/feed"）
```

### 3.2 `/feed` — Following feed（点 Profile 默认进这里）
- 顶部 sticky tabs：`[Following] [Discover (v1)]`
- 单列瀑布流（每条 post 卡片：作者 → 图 → caption → trip badge → like/comment 按钮）
- 无限滚动加载（IntersectionObserver + cursor）
- 右上角 `[+ New Post]` CTA

### 3.3 `/u/<handle>` — Profile 主页改造
现状：tagline + "2 TRIPS SHARED" + booking 卡片 + CTA
改为：
```
┌──────────────────────────────────────┐
│  [头像] 果果 @kakarottoo              │
│         tagline                       │
│         12 posts · 34 followers · 56 following
│         [Edit Profile] (自己) / [Follow] (访客)
├──────────────────────────────────────┤
│  [Posts] [Trips] [About]             │
├──────────────────────────────────────┤
│  3-col 图片网格（小红书式）           │
└──────────────────────────────────────┘
```
- **Posts tab**（默认）：3 列网格，点图进 `/p/<id>`
- **Trips tab**：保留现有 trips 卡片
- **About tab**：tagline + bio + 加入时间

### 3.4 `/p/<id>` — Post 详情
- 大图轮播（左右切换）
- caption 全文
- trip badge（点进 trip 详情或 booking job）
- like 按钮 + 计数
- 评论列表 + 评论框（复用 mention picker）
- 作者菜单：编辑 / 删除（仅自己）
- 分享链接复制

### 3.5 `/compose` — 发 Post
- 图片上传（拖拽或点击，最多 9 张，自动裁切预览）
- caption 输入（500 字计数器）
- **必选**：选择挂载的 trip 或 booking
  - "From your recent trips" 列表（最近 30 天的 trip / booking_jobs.status='done'）
- 可选：覆盖 location label
- 可见性 toggle：Public / Contacts only
- 提交 → 跳到 `/p/<id>`

### 3.6 `/u/<handle>/followers` 和 `/following` 列表页

---

## 4. 组件清单（components/feed/）

- `PostCard.tsx` — feed 单条卡片
- `PostGrid.tsx` — profile 3 列网格 cell
- `PostDetail.tsx` — `/p/<id>` 详情布局
- `PostComposer.tsx` — `/compose` 表单
- `LikeButton.tsx` — 双击/单击爱心 + 乐观更新
- `CommentList.tsx` + `CommentForm.tsx` — 评论区（复用现有 MentionPicker）
- `FollowButton.tsx` — Follow / Unfollow toggle + 计数
- `ProfileHeader.tsx` — 头像 + 名字 + 数字 + 按钮
- `ProfileTabs.tsx` — Posts / Trips / About
- `TripPicker.tsx` — composer 里挂 trip 的选择器

---

## 5. 通知集成

复用现有 `notifications` 表（如有）或新增 `notifications` 行：
- `you_have_new_follower` — A follow 了你
- `your_post_was_liked` — A 赞了你的 post
- `your_post_got_comment` — A 评论了你的 post
- `you_were_mentioned_in_comment` — 评论里 @ 了你
- `someone_you_follow_posted` — 你 follow 的人发了 post（可选，频率高）

UI：复用现有 NotificationCenter / bell icon。

---

## 6. 任务拆分（执行顺序）

### Phase 1 — 基础设施（先打地基）
1. Drizzle migration：5 张新表 + 索引
2. `lib/db/posts.ts` — CRUD helpers
3. `lib/db/follows.ts` — follow / unfollow / 统计 helpers
4. Vercel Blob upload route + 鉴权

### Phase 2 — 后端 API
5. POST/GET/DELETE/PATCH `/api/posts`
6. GET `/api/feed/following` + `/api/feed/profile/:handle`
7. Like + Comment endpoints
8. Follow endpoints

### Phase 3 — 前端核心
9. 顶 nav 加 Profile 入口
10. `/feed` Following feed 页
11. Profile 页改造 + 三 tab
12. `/p/<id>` 详情页
13. `/compose` 发布页
14. PostCard / PostGrid / LikeButton / CommentList 等组件

### Phase 4 — 互动闭环
15. Follow 按钮 + 列表页
16. 通知集成（5 类事件）
17. @-mention 复用到评论

### Phase 5 — 打磨
18. 空状态文案（没 post / 没 follow / 没评论）
19. 加载骨架屏
20. 错误处理 + 乐观更新回滚
21. SEO meta（OG 图 = 第一张图，title = caption 前 60 字）

---

## 7. Out of Scope（v1 再做）

- 视频上传 / 转码
- 多级嵌套评论
- 转发 / Repost
- 收藏 / Bookmark
- Hashtag / 话题
- Discover / 热门 feed
- DM（已有 Decision Room，不重复）
- Story / 24h 限时
- 直播
- 内容审核 / 举报系统（先靠人工 + soft delete）

---

## 8. 风险 & 注意事项

1. **Trip-anchored 的冷启动问题**：新用户没 trip → 发不了 post。
   - 缓解：`/compose` 引导"先去订一个" CTA + Demo trip 预填（可选）
2. **公域 follow 的滥用**：陌生人乱 follow。
   - 缓解：v1 不做封禁，靠 unfollow + soft delete + 后续举报
3. **图片存储成本**：Vercel Blob 按容量计费。
   - 缓解：上传时压缩到 max 1920px / 80% JPEG，9 张/post 上限
4. **Feed 性能**：following feed 是 fan-out-on-read。
   - MVP 不优化，N+1 查询直到 1k+ 关注关系再说
5. **既有 `/s/<slug>` 行程分享**：和新 post 是独立产品。
   - 不合并，trip 详情页可以放"分享为 post"按钮做软引导

---

## 9. 验收标准（Definition of Done）

- [ ] 顶 nav 有 Profile 入口，点击进 `/feed`
- [ ] 自己能从 trip 创建 post（图 + caption + 挂 trip）
- [ ] post 在自己 profile 网格里显示
- [ ] 别人能 follow / unfollow 我
- [ ] 我的 following feed 显示我 follow 的人的最新 post
- [ ] post 能被点赞 / 评论
- [ ] 评论里能 @ 联系人
- [ ] 通知中心收到新 follower / like / comment / @ 提醒
- [ ] post 详情页 `/p/<id>` 链接可分享
- [ ] visibility 切到 contacts 后非联系人看不到
- [ ] 移动端布局过得去（不要求完美）

---

## 10. 后续讨论 / 待定

- [ ] Profile 头像目前用什么字段？需不需要加上传头像？
- [ ] tagline / bio 字段在哪个表？需要新加 `user_profiles.bio`?
- [ ] 是否要做迁移：把已有的 `/s/<slug>` 公开 trip 自动转成第一批 post？
- [ ] OG 卡片 / Twitter card 优先级？

> 这几条等 P3-P8 smoke 测试期间穿插确认。
