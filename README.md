# AI 地下城

多人 AI 即兴文字冒险游戏。AI 担任地下城主持人（DM），玩家自由输入任何行动，AI 实时接住并推进剧情。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite 5 + TypeScript |
| 后端 | Express 4 + Socket.io |
| AI | OpenAI / DeepSeek（GPT-4o-mini / deepseek-chat） |
| 实时通信 | WebSocket（Socket.io） |

## 快速启动

```bash
npm install
cp .env.example .env    # 编辑 .env 填入 API Key
npm run dev
```

| 服务 | 地址 |
|---|---|
| 前端 | `http://localhost:5173` |
| 后端 | `http://localhost:8787` |

## 环境变量

```env
PORT=8787
OPENAI_API_KEY=sk-xxx             # 必填，AI DM 所需
OPENAI_BASE_URL=https://api.deepseek.com   # 可选，默认 OpenAI
OPENAI_MODEL=deepseek-chat        # 可选，默认 gpt-4o-mini
```

不填 API Key 时自动降级为 Mock DM（关键词匹配）。

## 功能

### 游戏模式

- **单人冒险**：创建即开局，立即获得角色卡，无需等待
- **多人房间**：创建房间 → 邀请好友 → 全员准备 → 房主开局

### 实时联机

WebSocket 实时推送，无需刷新。加入房间、开始游戏、提交行动、投票结果均即时同步。

### AI 主持人

玩家输入自由行动（搜查、偷窃、欺骗、谈判……），AI DM 实时生成旁白，推进剧情、扮演 NPC、制造冲突。失败自动降级 Mock DM。

### 准备就绪系统

多人房间中，全员点击"我准备好了"后房主才能开始游戏。未准备时开始按钮保持禁用。

### 投票系统

每 3 回合自动触发投票，问题随剧本变化（"谁最可疑？""遗嘱藏在哪？"）。全员投票或 30 秒截止后公布结果，影响剧情走向。

### 邀请系统

房主可复制邀请链接或展示二维码，手机扫码自动填入房间号，仅显示加入表单。

### 三个剧本

| 剧本 | 调性 | 简介 |
|---|---|---|
| 午夜列车 | 悬疑推理 | 被困在深夜列车，每隔一段时间有人死去 |
| 社畜地下城 | 黑色幽默 | 荒诞公司求生，终极 boss 是不露面的 CEO |
| 贵族晚宴 | 宫斗修罗场 | 晚宴上每个人带着见不得人的秘密 |

每个剧本有独立角色卡（职业、性格、背景、隐藏目标），开局时自动分配。

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 健康检查，返回模式 + 局域网 IP |
| `GET` | `/api/scenarios` | 获取所有剧本 |
| `POST` | `/api/rooms` | 创建房间（`hostName`, `scenarioId`, `mode`） |
| `GET` | `/api/rooms/:roomId` | 获取房间状态 |
| `POST` | `/api/rooms/:roomId/join` | 加入房间（`playerName`） |
| `POST` | `/api/rooms/:roomId/ready` | 切换准备状态（`playerId`） |
| `POST` | `/api/rooms/:roomId/start` | 开始游戏（仅房主，需全员准备） |
| `POST` | `/api/rooms/:roomId/turn` | 提交行动（`playerId`, `content`） |

## Socket.io 事件

| 方向 | 事件 | 说明 |
|---|---|---|
| C→S | `room:join` | 加入房间频道 |
| C→S | `room:leave` | 离开房间频道 |
| C→S | `vote:submit` | 提交投票 |
| S→C | `room:state` | 房间状态全量推送 |
| S→C | `vote:start` | 投票开始 |
| S→C | `vote:update` | 有人已投票 |
| S→C | `vote:result` | 投票结果 |

## 项目结构

```
client/          React + Vite 前端
  src/
    App.tsx      主界面（房间操作、故事流、玩家面板、投票）
    api.ts       REST API 封装
    useSocket.ts Socket.io 连接管理 Hook
    styles.css   全局样式
server/          Express + Socket.io 后端
  index.ts      HTTP 路由 + WebSocket 事件
  dm.ts         AI DM 逻辑（GPT 调用 + Mock 降级）
  scenarios.ts  剧本数据
  store.ts      内存存储（房间、玩家、消息）
shared/         前后端共用类型
  types.ts      Room, Player, Message, WorldState 等
```

## 开发

```bash
npm run typecheck     # TypeScript 类型检查
npm run dev:server    # 仅启动后端
npm run dev:web       # 仅启动前端
```
