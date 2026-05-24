# AI 地下城

多人聊天式剧本冒险：创建房间、选择剧本、真人轮流输入行动，由 **DeepSeek** 驱动的 AI 主持人推进剧情；人数不足时自动用 AI 机器人补位。

## 功能概览

- **房间与剧本**：房主创建房间并选择剧本（2–6 人局，含 AI 补位）；其他玩家凭房间号加入。
- **AI 主持人**：开局生成开场、角色卡与世界目标；每轮根据玩家行动输出叙事，并维护地点、紧张度、任务等世界状态。
- **回合制流程**：每轮先由真人玩家依次行动，再由 AI 机器人依次行动；前端每 2 秒轮询房间状态以同步他人操作。
- **实时通信**：Socket.io 实时推送房间状态、投票事件、聊天消息和语音数据。
- **场景可视化**：CSS 艺术场景渲染，可交互热点（搜查、观察等），支持剧本专属视觉风格。
- **语音通话**：玩家之间按住按钮即可实时语音通话（MediaRecorder + Socket.io 音频中继）。
- **语音输入**：输入框旁按住说话，语音实时转文字填入输入框。
- **投票系统**：每 3 回合自动触发投票，问题随剧本变化，30 秒截止或全员投票后公布结果。
- **玩家交流区**：故事流 / 交流区双标签，内置表情栏，未读消息徽章提示。
- **空闲调侃**：游戏进行中若长时间无行动，AI 主持人会偶尔插入调侃消息（服务端定时检查）。
- **背景音乐**：前端支持循环播放项目根目录的 `main.mp3`（需复制到 `client/public/bgm/`）。
- **邀请系统**：房主可复制邀请链接或展示二维码，扫码自动填入房间号加入。

## 技术栈

| 目录 | 说明 |
|------|------|
| `client/` | React 18 + Vite，房间 UI、故事流、场景渲染、语音、BGM |
| `server/` | Express + Socket.io + TypeScript（`tsx`），房间状态、回合流程、DeepSeek 调用 |
| `shared/` | 前后端共用的类型与工具函数 |

依赖见根目录 `package.json`。开发时 `concurrently` 同时启动前后端。

## 剧本

| ID | 标题 | 风格 |
|----|------|------|
| `midnight-train` | 午夜列车 | 悬疑推理 |
| `office-dungeon` | 社畜地下城 | 黑色幽默 |
| `noble-banquet` | 贵族晚宴 | 宫斗修罗场 |

## 快速开始

### 环境要求

- Node.js 18+
- [DeepSeek](https://platform.deepseek.com/) API Key

### 安装与启动

```bash
npm install
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY
npm run dev
```

| 服务 | 地址 |
|------|------|
| 前端 | https://localhost:5173 |
| 后端 | http://localhost:8787 |

> 首次访问会遇到自签名证书警告，点击"高级"→"继续前往"即可。HTTPS 是麦克风权限的必需条件。

前端通过 Vite 代理将 `/api` 和 `/socket.io` 转发到后端。

### 环境变量

在根目录 `.env` 中配置（可参考 `.env.example`）：

```bash
PORT=8787
DEEPSEEK_API_KEY=你的key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

未配置 `DEEPSEEK_API_KEY` 时，`GET /api/health` 返回 `mode: "no-api-key"`，前端会提示无法开始游戏。

可选前端变量（构建时生效）：

```bash
VITE_BGM_URL=/bgm/main.mp3
```

### 背景音乐

1. 将 `main.mp3` 放在项目根目录。
2. 复制到前端静态资源目录：

```bash
copy main.mp3 client\public\bgm\main.mp3
```

3. 启动后在页面顶部点击 **播放 BGM**（浏览器需用户手势才能播放）。

## 游戏流程

1. **大厅**：房主创建房间 → 分享房间号/二维码 → 其他玩家加入 → 房主调整人数（仅大厅、仅房主）→ 点击「开始游戏」。
2. **开局**：服务端为每位玩家分配角色卡（含背景、性格、隐藏目标）；不足人数用 AI 机器人补位；初始化交互场景；AI 主持人撰写开场并设定本局目标。
3. **进行中**：轮到你的回合时在故事流底部输入行动并提交；可通过场景面板点击交互热点快速操作；AI 主持人根据行动叙事；真人全部行动完毕后，AI 机器人自动依次行动。
4. **同步**：Socket.io 实时推送状态变更，前端同时定时轮询作为兜底。

玩家会话保存在浏览器 `localStorage`，刷新页面后可尝试恢复同一房间。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查；`mode` 为 `ai-ready` 或 `no-api-key` |
| `GET` | `/api/scenarios` | 剧本列表 |
| `POST` | `/api/rooms` | 创建房间 `{ hostName, scenarioId, maxPlayers? }` |
| `GET` | `/api/rooms/:roomId` | 获取房间状态 |
| `PATCH` | `/api/rooms/:roomId/settings` | 更新人数 `{ hostPlayerId, maxPlayers }`（仅大厅、房主） |
| `POST` | `/api/rooms/:roomId/join` | 加入 `{ playerName }` |
| `POST` | `/api/rooms/:roomId/start` | 开始游戏（分配角色、AI 开场） |
| `POST` | `/api/rooms/:roomId/turn` | 提交行动 `{ playerId, content }` |

## Socket.io 事件

| 方向 | 事件 | 说明 |
|---|---|---|
| C→S | `room:join` | 加入房间频道 |
| C→S | `room:leave` | 离开房间频道 |
| C→S | `vote:submit` | 提交投票 |
| C→S | `voice:start` | 开始语音流（附带 playerName） |
| C→S | `voice:data` | 音频数据块（ArrayBuffer） |
| C→S | `voice:end` | 结束语音流（附带 playerName） |
| C→S | `chat:message` | 发送聊天消息（playerName, content） |
| S→C | `room:state` | 房间状态全量推送 |
| S→C | `vote:start` | 投票开始 |
| S→C | `vote:update` | 有人已投票 |
| S→C | `vote:result` | 投票结果 |
| S→C | `voice:start` | 远端玩家开始说话（playerName） |
| S→C | `voice:data` | 远端音频数据块 |
| S→C | `voice:end` | 远端玩家停止说话（playerName） |
| S→C | `chat:message` | 远端聊天消息 |

## 项目结构

```txt
hks/
├── client/
│   ├── src/
│   │   ├── App.tsx              # 主界面：房间、故事流/交流区、场景渲染、投票
│   │   ├── api.ts               # REST API 封装
│   │   ├── session.ts           # 本地会话持久化
│   │   ├── useSocket.ts         # Socket.io 连接管理
│   │   ├── SceneRenderer.tsx    # CSS 艺术场景渲染 + 交互热点
│   │   ├── VoiceChat.tsx        # 语音通话组件
│   │   ├── VoiceInput.tsx       # 语音转文字输入组件
│   │   ├── styles.css           # 全局样式（含场景 CSS art）
│   │   └── components/
│   │       └── BgmPlayer.tsx    # 背景音乐播放器
│   └── vite.config.ts           # 开发代理 /api + /socket.io → 8787
├── server/
│   ├── index.ts                 # Express 路由 + Socket.io 事件
│   ├── store.ts                 # 内存房间存储
│   ├── dm.ts                    # AI 主持人（DeepSeek）+ 场景对象
│   ├── turnFlow.ts              # 真人 / 机器人回合流程
│   ├── botPlayer.ts             # AI 机器人行动生成
│   ├── teaseScheduler.ts        # 空闲调侃定时器
│   ├── memory.ts                # 剧情记忆与摘要
│   └── scenarios.ts             # 剧本数据
├── shared/
│   └── types.ts                 # Room、Player、Message、InteractiveObject 等类型
├── .env.example
└── package.json
```

## 常用命令

```bash
npm run dev          # 同时启动前后端
npm run dev:server   # 仅后端
npm run dev:web      # 仅前端
npm run build        # 构建前端到 dist/
npm run typecheck    # TypeScript 类型检查
```

## 说明与限制

- 房间数据保存在**服务端内存**，重启服务后房间会丢失，适合黑客松演示与联调。
- AI 调用依赖 DeepSeek；请妥善保管 API Key，勿提交到版本库。

## License

Private hackathon project (`package.json` 中 `"private": true`)。
