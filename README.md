# AI 地下城黑客松骨架

这是一个适合 3 人并行开发的最小框架，目标不是先做传统 RPG，而是先把“多人房间 + AI 主持人 + 聊天式冒险”搭起来。

## 目录

```txt
client/   React + Vite 前端
server/   Express 后端与 AI主持人 骨架
shared/   前后端共用类型
```

## 先做什么

1. 前端先把房间页、聊天区、角色卡区域做顺。
2. 后端先把创建房间、加入房间、开始游戏、提交行动跑通。
3. AI 核心已接入 DeepSeek API，玩家每次行动会实时触发 AI主持人 回复。

## 启动

```bash
npm install
cp .env.example .env
npm run dev
```

前端默认跑在 `http://localhost:5173`

后端默认跑在 `http://localhost:8787`

## DeepSeek 配置

在 `.env` 里至少配置：

```bash
DEEPSEEK_API_KEY=你的key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

如果缺少 `DEEPSEEK_API_KEY`，`/api/rooms/:roomId/turn` 会直接报错提示配置。

## 背景音乐 BGM

使用项目根目录的 `main.mp3`（仅支持 mp3）。

1. 确保根目录存在 `main.mp3`
2. 首次或更换音乐后执行：`copy main.mp3 client\public\bgm\main.mp3`
3. 启动后在前端顶部点击 **播放 BGM**

## 当前接口

- `GET /api/health`
- `GET /api/scenarios`
- `POST /api/rooms`
- `GET /api/rooms/:roomId`
- `POST /api/rooms/:roomId/join`
- `POST /api/rooms/:roomId/start`
- `POST /api/rooms/:roomId/turn`

## 推荐分工

- 你：推进后端流程和 AI主持人 逻辑
- 桑耳：前端房间、聊天 UI、交互体验
- 第三人：联调、部署、语音或实时同步增强

