# AI 地下城

多人 AI 即兴文字冒险游戏。AI 担任地下城主持人（DM），玩家自由输入任何行动，AI 实时接住并推进剧情。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite 5 + TypeScript |
| 后端 | Express 4 + Socket.io |
| AI | OpenAI / DeepSeek（GPT-4o-mini / deepseek-chat） |
| 实时通信 | WebSocket（Socket.io） |
| 语音 | Web Speech API（语音输入）+ MediaRecorder（语音通话） |

## 快速启动

```bash
npm install
cp .env.example .env    # 编辑 .env 填入 API Key
npm run dev
```

| 服务 | 地址 |
|---|---|
| 前端 | `https://localhost:5173` |
| 后端 | `http://localhost:8787` |

> 首次访问会遇到自签名证书警告，点击"高级"→"继续前往"即可。HTTPS 是麦克风权限的必需条件。

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

提交行动后：
- 按钮显示 "DM 回应中..."，消息区显示 "AI DM 思考中..." 动画
- 同一时间只处理一个行动（turn lock），并发提交会提示稍后重试
- 新消息自动滚动到底部

### 玩家交流区

故事面板顶部标签可在 **故事流** 和 **交流区** 之间切换：

- 实时文字聊天，不影响 AI 剧情
- 22 个常用表情一键填入（😀😂🤣😍🤔😎👍🎲🐉⚔️🛡️🏰🌙✨ 等）
- 消息气泡左右分栏（自己/他人）
- **未读徽章**：在故事流标签时收到新消息，交流区标签显示红点数字，点击后清零

### 语音输入

输入框旁的 🎤 按钮，**按住说话**，文字实时出现在输入框，**松开提交**。基于 Web Speech API，支持中文（zh-CN），Chrome/Edge 体验最佳。

### 语音通话

玩家之间按住 🔇 按钮即可实时通话。基于 MediaRecorder + Socket.io 音频中继，200ms 低延迟。

- 准备阶段和游戏中均可使用
- 显示所有正在说话的人（"张三、李四 正在说话…"）
- 麦克风被拒时显示红色提示

> 语音功能需要 HTTPS 或 localhost（secure context）。开发服务器已配置自签名证书。

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
| `POST` | `/api/rooms/:roomId/turn` | 提交行动（`playerId`, `content`），含 turn lock |

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

```
client/          React + Vite 前端
  src/
    App.tsx       主界面（房间操作、故事流/交流区标签、玩家面板、投票）
    api.ts        REST API 封装
    useSocket.ts  Socket.io 连接管理（聊天收发、投票、语音事件）
    VoiceChat.tsx 语音通话组件（按住说话，多说话者追踪）
    VoiceInput.tsx 语音输入组件（语音转文字，实时回显）
    styles.css    全局样式
server/          Express + Socket.io 后端
  index.ts       HTTP 路由 + WebSocket 事件（语音中继、聊天中继、turn lock）
  dm.ts          AI DM 逻辑（GPT 调用 + Mock 降级）
  scenarios.ts   剧本数据
  store.ts       内存存储（房间、玩家、消息、turn lock）
shared/         前后端共用类型
  types.ts       Room, Player, Message, WorldState 等
```

## 开发

```bash
npm run typecheck     # TypeScript 类型检查
npm run dev:server    # 仅启动后端
npm run dev:web       # 仅启动前端
```
