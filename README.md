# AI 地下城（heikesong-ai-dungeon）

多人聊天式 AI 剧本杀 / 地下城冒险：创建房间、选择剧本、真人轮流输入行动，由 **DeepSeek** 驱动的 AI 主持人推进剧情；人数不足时 AI 机器人自动补位。对局结束后提供 **全员行为点评**、**完整故事谜底** 等复盘页面。

---

## 目录

- [功能概览](#功能概览)
- [对局后复盘页面](#对局后复盘页面)
- [技术栈](#技术栈)
- [剧本列表](#剧本列表)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [完整游戏流程](#完整游戏流程)
- [AI 与推理系统](#ai-与推理系统)
- [前端路由](#前端路由)
- [REST API](#rest-api)
- [Socket.io 事件](#socketio-事件)
- [项目结构](#项目结构)
- [常用命令](#常用命令)
- [说明与限制](#说明与限制)

---

## 功能概览

### 房间与大厅

| 功能 | 说明 |
|------|------|
| 创建 / 加入房间 | 支持**单人冒险**与**多人房间**（2–6 人，含 AI 补位）。玩家名不能与剧本角色同名，避免混淆 |
| 剧本选择 | 三套预设剧本（悬疑列车 / 社畜地下城 / 贵族晚宴） |
| 邀请 | 房主复制邀请链接或展示二维码；URL 参数 `?room=房间号` 自动填入 |
| 选角 | 大厅内真人点选角色卡（背景、性格、隐藏目标）；选角后视为已准备 |
| 开局条件 | **所有真人选角完成**后，房主可开始游戏；未满员由 AI 补位 |

### 对局中

| 功能 | 说明 |
|------|------|
| AI 主持人 | 开局生成开场、任务简报、线索链蓝图、角色卡；每轮根据行动输出叙事 |
| 任务体系 | **本剧必做**（通关条件）+ **本局必做**（按顺序 1→2→3）；侧边栏与「结案进度」系统消息同步 |
| 线索链 | 结构化调查线索登记；推进步骤与任务 id 关联，避免断链 |
| 回合制 | 每轮真人依次行动 → AI 机器人依次行动；仅轮到本人时可提交故事行动 |
| 场景可视化 | CSS 艺术场景 + 可点击交互热点（搜查、观察等），剧本专属视觉 |
| 自然结案 | 完成必做并公开真相后，AI 可触发 `success_end` / `failure_end` 收官 |
| 指认真凶 | 真人可发起投票提前结案：猜对「推理成功」，猜错「推理错误」 |
| 每 3 回合投票 | 剧情向选择题投票（30 秒或全员投完），与指认投票独立 |

### 交流与多媒体

| 功能 | 说明 |
|------|------|
| 故事流 / 交流区 | 双标签：故事流为剧情与系统消息；交流区为自由聊天（不影响主线） |
| 聊天发帖 | 文字、图片、语音帖；Socket 实时同步 |
| 语音通话 | MediaRecorder + Socket 中继，玩家间实时语音 |
| 语音输入 | 按住说话转文字填入行动框 |
| 背景音乐 | 页面顶部 BGM 播放器（`client/public/bgm/main.mp3`） |

### AI 辅助（新增 / 增强）

| 功能 | 说明 |
|------|------|
| AI 机器人 Agent | 每个 Bot 有私密「内心档案」：剧情理解、对他人推测、下一步打算；每轮行动前刷新 |
| 真人推理 Agent | 可选私密助手：分析局势、建议行动、记住本局推理（需用户同意，仅本人可见） |
| AI 主持人调侃 | 进行中定时插入调侃旁白：**有人发言（剧情/交流区）每 2 分钟**；**无人发言每 5 分钟** |
| 玩家可见文案清洗 | 自动去掉 Markdown、`【】`、重复 `session-n` 等技术 id，简报与消息更易读 |

### 对局结束后（新增）

| 功能 | 说明 |
|------|------|
| 自动跳转复盘页 | 自然收官或指认结案后，全员客户端进入 `/reviews` |
| 全员行为点评 | AI 根据本局行动为**每位真人**生成点评（亮点 / 可改进 / 综合评价 / 标签），**同屏展示** |
| 完整故事谜底 | 根据开场简报、线索链、隐藏真相生成完整复盘（`/reveal`） |
| 结案页 | 指认投票进行中或查看简要收官（`/outcome`） |
| 对局实例隔离 | 每局 `gameInstanceId` 刷新；指认结果、点评、谜底仅绑定当前局 |

---

## 对局后复盘页面

对局结束（`room.status === "ended"`）后，客户端会进入 **行为点评页**（`/reviews`）。以下为子页面关系：

```
对局结束
    └── /reviews  真人玩家行为点评（默认落地页）
            ├── 「查看故事谜底」→ /reveal
            └── 「退出游戏，返回大厅」→ 清除会话，回首页

/reveal  故事谜底
    └── 「返回上一页」→ 回到 /reviews

/outcome  指认投票 / 简要收官（进行中或需投票时使用）
```

### `/reviews` — 行为点评

- 进入时若点评未就绪，显示 **「点评生成中…」**（带加载动画）。
- 生成完成后，**所有真人玩家的点评卡片**展示在同一页面；自己的卡片带 **「你」** 标记。
- 底部：
  - **查看故事谜底** → `/reveal`
  - **退出游戏，返回大厅**

服务端：对局结束时并行调用 DeepSeek（按玩家并行请求），写入 `room.worldState.behaviorReviews`；失败时使用规则化备用点评。

### `/reveal` — 完整故事谜底

- 顶部展示 **本局开场**（开局简报摘录）。
- **故事谜底生成中…** → 展示分节完整谜底，例如：
  - 故事回顾、完整谜底、真凶身份、作案手法与动机、线索链复盘、关键转折点、红鲱鱼说明、本局结局
- **返回上一页** → 回到 `/reviews`（不直接回大厅）。

服务端：写入 `room.worldState.fullMysteryReveal`；结合 `missionBrief`、`mysteryPlan.hiddenTruth`、调查线索与行动记忆生成。

### `/outcome` — 结案 / 指认

- **指认投票进行中**：选择嫌疑人并提交投票。
- **对局已结束**：展示胜负、真相摘要、必做完成情况、结局叙事。
- 可跳转 **查看故事谜底**、**查看全员行为点评**。

> 在 `/reveal` 或 `/outcome` 时，不会再次被自动重定向回 `/reviews`，避免无法停留子页。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18、Vite、React Router、Socket.io-client |
| 后端 | Express、Socket.io、TypeScript（`tsx` 运行） |
| AI | DeepSeek Chat API（OpenAI 兼容格式） |
| 共享 | `shared/types.ts` 前后端类型与工具 |

开发时 `npm run dev` 通过 `concurrently` 同时启动前后端。前端 HTTPS（自签名）用于麦克风权限；`/api` 与 `/socket.io` 由 Vite 代理到 `8787`。

---

## 剧本列表

| ID | 标题 | 风格 | 核心冲突 |
|----|------|------|----------|
| `midnight-train` | 午夜列车 | 悬疑推理 | 连环死亡与真凶 |
| `office-dungeon` | 社畜地下城 | 黑色幽默 | 怪物袭击与裁员真相 |
| `noble-banquet` | 贵族晚宴 | 宫斗修罗场 | 失踪遗嘱与公爵遇袭 |

开局时 AI 按剧本模板生成：本局必做（3 条）、本剧必做（2 条）、线索链、胜利/失败条件、自然结案提示。

---

## 快速开始

### 环境要求

- Node.js 18+
- [DeepSeek](https://platform.deepseek.com/) API Key

### 安装与启动

```bash
cd hks
npm install
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY=
npm run dev
```

| 服务 | 地址 |
|------|------|
| 前端 | https://localhost:5173 |
| 后端 | http://localhost:8787 |

首次访问自签名证书需浏览器「继续前往」。局域网访问时，健康检查接口会返回 `localIP` 便于手机扫码加入。

### 背景音乐（可选）

```bash
copy main.mp3 client\public\bgm\main.mp3
```

页面顶部点击 **播放 BGM**（需用户手势触发播放）。

---

## 环境变量

在根目录 `.env` 配置：

```bash
PORT=8787
DEEPSEEK_API_KEY=你的key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

| 变量 | 说明 |
|------|------|
| `PORT` | 后端端口，默认 8787 |
| `DEEPSEEK_API_KEY` | 必填；未配置时 `GET /api/health` 返回 `mode: "no-api-key"`，无法开局 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com`，兼容 OpenAI 格式 |

可选前端构建变量：

```bash
VITE_BGM_URL=/bgm/main.mp3
```

---

## 完整游戏流程

### 1. 大厅

1. 房主：选择模式（单人 / 多人）、剧本、人数 → **创建房间**。
2. 其他玩家：输入房间号与昵称 → **加入**（或扫码 / 邀请链接）。昵称不能与房间已有角色重名。
3. 所有真人点击 **角色卡** 选角（可再次点击取消）；未选角不可准备。
4. 房主调整人数（仅大厅、仅房主）→ **开始游戏**。

### 2. 开局

- 服务端生成 `gameInstanceId`（本局唯一标识）。
- 分配角色卡；不足人数由 AI 机器人补位并随机展示名。
- AI 撰写开场叙事、任务简报、初始线索、交互场景对象。
- 系统提示：指认/点评/谜底仅在本局有效。

### 3. 进行中

- **故事流**：轮到本人时输入行动或点场景热点；提交后等待 AI 叙事与状态更新。
- **左侧栏**：本剧/本局必做、自然结案提示、指认入口（进行中）。
- **交流区**：自由聊天，计入「有人发言」以加快调侃频率。
- **结案进度**：定期系统消息汇报任务与线索链完成情况。
- **私密 Agent**（可选）：同意后为本人提供推理建议（不广播给他人）。

### 4. 结束对局

两种方式：

| 方式 | 说明 |
|------|------|
| **自然结案** | 完成必做并在剧情中公开真相；AI 返回 `success_end` 或 `failure_end` |
| **指认真凶** | 真人发起投票 → 全体真人投票 → 多数票指认 → 对比隐藏真相判定成败 |

结束后：

1. 房间 `status` → `ended`。
2. 异步生成 **行为点评**、**完整故事谜底**。
3. 客户端跳转 **`/reviews`**。

### 5. 复盘与退出

- 在点评页查看全员点评 → 可选进入故事谜底页 → **返回上一页** 回点评页。
- **退出游戏，返回大厅**：清除 `localStorage` / `sessionStorage` 中本局缓存，回到创建/加入界面。

---

## AI 与推理系统

### AI 主持人（`server/dm.ts`）

- 开局 `buildOpening`：生成叙事、目标、线索链、`mysteryPlan`（含 `hiddenTruth`）、结案条件。
- 每轮 `resolveTurn`：叙事、地点、紧张度、目标更新、新线索、结案状态。
- 输出经 `sanitizePlayerFacingText` 清洗后展示给玩家。

### 案件进度（`server/caseProgress.ts`）

- `reconcileTurnOutcome`：校验必做顺序、线索链步骤、是否满足自然结案。
- `formatCaseProgressForPlayers`：回合末推送可读进度摘要。

### AI 机器人（`server/botPlayer.ts` + `server/botMind.ts`）

- `refreshBotMind`：根据公开剧情刷新 Bot 内心档案与他人心智模型。
- `generateBotAction`：基于档案 + 记忆生成符合角色的行动。

### 真人推理 Agent（`server/playerAgent.ts`）

- `POST /api/rooms/:roomId/player-agent`：需 `consent: true`。
- 返回分析、建议行动、线索提示；记忆按 `playerId` 隔离。

### 指认真凶（`server/accusation.ts`）

- 开局解析 `accusationMeta`（真凶 playerId）。
- 投票 45 秒或全员投完 → `finalizeAccusationVote` → `endGame`。
- Socket：`accusation:start` / `update` / `result`。

### 行为点评（`server/behaviorReview.ts`）

- `endGame` 时置 `behaviorReviews.status = "pending"`。
- 并行 AI 生成每位真人点评 → `ready` → `broadcastRoom`。

### 完整谜底（`server/mysteryReveal.ts`）

- `endGame` 时置 `fullMysteryReveal.status = "pending"`。
- 结合开场、线索链、行动记忆生成结构化长文 → `ready`。

### 调侃定时器（`server/teaseScheduler.ts`）

- 每 30 秒扫描进行中房间。
- 距上次调侃：活跃房间 2 分钟 / 沉寂房间 5 分钟。
- 「活跃」= 最近 2 分钟内有剧情行动或交流区发帖。

---

## 前端路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 主界面 | 大厅、对局、故事流、场景、交流区 |
| `/reviews` | 行为点评 | 对局结束默认落地；生成中 / 全员点评卡片 |
| `/reveal` | 故事谜底 | 开场 + 完整谜底；返回 `/reviews` |
| `/outcome` | 结案 | 指认投票、简要收官 |

路由由 `react-router-dom` 管理（`client/src/main.tsx`）。

---

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查；`mode`: `ai-ready` / `no-api-key`；含 `localIP` |
| `GET` | `/api/scenarios` | 剧本列表 |
| `POST` | `/api/rooms` | 创建房间 `{ hostName, scenarioId, maxPlayers?, mode? }`；房主名与角色重名时 400 |
| `GET` | `/api/rooms/:roomId` | 获取房间全量状态 |
| `PATCH` | `/api/rooms/:roomId/settings` | 更新人数 `{ hostPlayerId, maxPlayers }` |
| `PATCH` | `/api/rooms/:roomId/role` | 选角 `{ playerId, roleSlotId \| null }` |
| `PATCH` | `/api/rooms/:roomId/ready` | 切换准备（兼容接口） |
| `POST` | `/api/rooms/:roomId/join` | 加入 `{ playerName }`；玩家名与已有角色重名时 400 |
| `POST` | `/api/rooms/:roomId/start` | 开始游戏 |
| `POST` | `/api/rooms/:roomId/turn` | 提交行动 `{ playerId, content }` |
| `POST` | `/api/rooms/:roomId/accusation` | 发起指认投票 `{ playerId }` |
| `POST` | `/api/rooms/:roomId/player-agent` | 真人 Agent 辅助 `{ playerId, consent, draftAction?, question? }` |

---

## Socket.io 事件

| 方向 | 事件 | 说明 |
|------|------|------|
| C→S | `room:join` / `room:leave` | 加入 / 离开房间频道 |
| C→S | `vote:submit` | 剧情投票 |
| C→S | `accusation:submit` | 指认投票 `{ roomId, playerId, accusedPlayerId }` |
| C→S | `voice:start` / `voice:data` / `voice:end` | 语音通话 |
| C→S | `chat:post` | 交流区发帖（文字/图/音） |
| C→S | `chat:message` | 兼容旧版纯文字聊天 |
| S→C | `room:state` | 房间全量状态（含 `behaviorReviews`、`fullMysteryReveal`） |
| S→C | `vote:start` / `vote:update` / `vote:result` | 剧情投票 |
| S→C | `accusation:start` / `accusation:update` / `accusation:result` | 指认投票 |
| S→C | `chat:post` / `chat:message` | 聊天同步 |
| S→C | `voice:*` | 语音中继 |
| S→C | `error` | 错误提示 |

---

## 项目结构

```txt
hks/
├── client/
│   ├── src/
│   │   ├── App.tsx                 # 主壳：大厅、对局、路由分发
│   │   ├── main.tsx                # React + HashRouter
│   │   ├── api.ts                  # REST 封装
│   │   ├── session.ts              # 本地会话、对局缓存清理
│   │   ├── useSocket.ts            # Socket.io
│   │   ├── outcomeNavigation.ts    # 结案 / 点评页跳转逻辑
│   │   ├── revealNavigation.ts     # 谜底页逻辑
│   │   ├── gameEndContent.ts       # 收官内容是否有实质
│   │   ├── SceneRenderer.tsx       # 场景热点
│   │   ├── VoiceChat.tsx / VoiceInput.tsx
│   │   ├── pages/
│   │   │   ├── GameReviewsPage.tsx # /reviews 行为点评
│   │   │   ├── GameRevealPage.tsx  # /reveal 故事谜底
│   │   │   └── GameOutcomePage.tsx # /outcome 指认 / 收官
│   │   └── components/
│   │       ├── BgmPlayer.tsx
│   │       ├── ChatComposer.tsx / ChatPostCard.tsx
│   │       ├── PlayerAgentAssistant.tsx
│   │       └── TypewriterText.tsx  # 打字机动画效果
│   └── vite.config.ts
├── server/
│   ├── index.ts                    # HTTP + Socket 入口
│   ├── store.ts                    # 内存房间、endGame、重名校验
│   ├── dm.ts                       # AI 主持人、开局、回合
│   ├── turnFlow.ts                 # 回合与收官
│   ├── caseProgress.ts             # 任务 / 线索链 / 自然结案
│   ├── accusation.ts               # 指认真凶
│   ├── behaviorReview.ts           # 对局后行为点评
│   ├── mysteryReveal.ts            # 完整故事谜底
│   ├── botPlayer.ts / botMind.ts   # AI 机器人
│   ├── playerAgent.ts              # 真人推理 Agent
│   ├── teaseScheduler.ts           # 调侃定时器
│   ├── chatRelay.ts                # 聊天中继
│   ├── briefFormat.ts              # 简报 / 目标文案清洗
│   ├── textFormat.ts               # 玩家可见文本清洗
│   ├── memory.ts                   # 剧情与行动记忆
│   ├── roles.ts                    # 角色槽与补位
│   └── scenarios.ts                # 剧本与案件模板
├── shared/
│   └── types.ts                    # 共享类型
├── .env.example
├── package.json
└── README.md
```

---

## 常用命令

```bash
npm run dev          # 同时启动前后端（推荐）
npm run dev:server   # 仅后端 tsx watch
npm run dev:web      # 仅前端 Vite
npm run build        # 构建前端到 dist/
npm run typecheck    # TypeScript 全项目检查
```

---

## 说明与限制

- **房间数据在服务端内存中**，进程重启后房间丢失，适合演示与本地联调。
- **DeepSeek API** 为必需依赖；请妥善保管 Key，勿提交到公开仓库。
- 对局结束后的点评与谜底为 **异步生成**，点评页 / 谜底页会轮询（约 1.2 秒）直至 `ready`。
- 浏览器 **localStorage** 保存玩家会话；**退出游戏** 或加载已结束房间会清理缓存，避免旧局指认/点评残留。
- 单人模式与多人模式共用同一套流程；单人时 AI 补位填满角色位。

---

## License

Private hackathon project（`package.json` 中 `"private": true`）。
