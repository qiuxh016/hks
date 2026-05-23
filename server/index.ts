import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import os from "node:os";
import { Server } from "socket.io";
import {
  CreateRoomRequest,
  JoinRoomRequest,
  TurnRequest
} from "../shared/types";
import { buildInitialSceneState, buildOpening, buildRoleCards, resolveTurn } from "./dm";
import { scenarios } from "./scenarios";
import {
  appendMessages,
  assignRoleCards,
  createRoom,
  getRoom,
  joinRoom,
  lockTurn,
  replaceSceneObjects,
  toggleReady,
  unlockTurn,
  updateRoom
} from "./store";

dotenv.config();

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT ?? 8787);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// ----- broadcast helper -----
function broadcastRoom(roomId: string) {
  const room = getRoom(roomId);
  if (room) {
    io.to(roomId).emit("room:state", room);
  }
}

// ----- active votes -----
const activeVotes = new Map<string, {
  question: string;
  options: string[];
  votes: Map<string, string>;   // playerId → option
  timeout: NodeJS.Timeout;
}>();

function triggerVote(roomId: string) {
  const room = getRoom(roomId);
  if (!room || room.status !== "in_progress") return;

  const questions: Record<string, { question: string; options: string[] }> = {
    "midnight-train": {
      question: "你们之中，谁最可疑？",
      options: room.players.map(p => p.name)
    },
    "office-dungeon": {
      question: "现在应该怎么做？",
      options: ["甩锅给别人", "主动背锅", "假装没看见", "直接找CEO对质"]
    },
    "noble-banquet": {
      question: "你认为遗嘱藏在哪？",
      options: ["公爵卧室", "花园喷泉下", "某位宾客身上", "宴会厅吊灯"]
    }
  };

  const q = questions[room.scenarioId] ?? questions["midnight-train"];

  const votes = new Map<string, string>();
  const timeout = setTimeout(() => {
    finalizeVote(roomId);
  }, 30000);

  activeVotes.set(roomId, { question: q.question, options: q.options, votes, timeout });

  io.to(roomId).emit("vote:start", {
    question: q.question,
    options: q.options,
    deadline: Date.now() + 30000
  });

  appendMessages(roomId, [{
    type: "system",
    speaker: "DM",
    content: `⚡ 投票开始：${q.question}（30 秒内投票）`
  }]);

  broadcastRoom(roomId);
}

function finalizeVote(roomId: string) {
  const vote = activeVotes.get(roomId);
  if (!vote) return;

  clearTimeout(vote.timeout);
  activeVotes.delete(roomId);

  const tally: Record<string, number> = {};
  for (const opt of vote.options) tally[opt] = 0;
  for (const choice of vote.votes.values()) {
    if (tally[choice] !== undefined) tally[choice]++;
  }

  const resultText = Object.entries(tally)
    .map(([opt, count]) => `${opt}：${count} 票`)
    .join("，");

  const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];

  io.to(roomId).emit("vote:result", { tally, winner: winner[0] });

  appendMessages(roomId, [
    {
      type: "system",
      speaker: "DM",
      content: `📊 投票结果：${resultText}`
    },
    {
      type: "ai",
      speaker: "AI DM",
      content: `投票结果让局势更加明朗——"${winner[0]}"成为了众人目光的焦点。这个结果将影响接下来的剧情走向。`
    }
  ]);

  broadcastRoom(roomId);
}

// ----- socket.io -----
io.on("connection", (socket) => {
  socket.on("room:join", (roomId: string) => {
    const room = getRoom(roomId);
    if (!room) {
      socket.emit("error", "房间不存在");
      return;
    }
    socket.join(roomId);
    socket.emit("room:state", room);
  });

  socket.on("room:leave", (roomId: string) => {
    socket.leave(roomId);
  });

  socket.on("vote:submit", (payload: { roomId: string; playerId: string; choice: string }) => {
    const vote = activeVotes.get(payload.roomId);
    if (!vote) {
      socket.emit("error", "当前没有进行中的投票");
      return;
    }
    vote.votes.set(payload.playerId, payload.choice);

    const room = getRoom(payload.roomId);
    const player = room?.players.find(p => p.id === payload.playerId);

    io.to(payload.roomId).emit("vote:update", {
      voterName: player?.name ?? "未知玩家",
      voted: true
    });

    const allVoted = room?.players.every(p => vote.votes.has(p.id));
    if (allVoted) {
      finalizeVote(payload.roomId);
    }
  });

  // ----- voice relay -----
  socket.on("voice:start", (roomId: string, playerName: string) => {
    socket.broadcast.to(roomId).emit("voice:start", playerName);
  });

  socket.on("voice:data", (roomId: string, chunk: ArrayBuffer) => {
    socket.broadcast.to(roomId).emit("voice:data", chunk);
  });

  socket.on("voice:end", (roomId: string, playerName: string) => {
    socket.broadcast.to(roomId).emit("voice:end", playerName);
  });

  // ----- chat relay -----
  socket.on("chat:message", (roomId: string, payload: { playerName: string; content: string; id: string }) => {
    io.to(roomId).emit("chat:message", {
      ...payload,
      createdAt: new Date().toISOString()
    });
  });

  socket.on("disconnect", () => {
    // room cleanup handled by socket.io automatically
  });
});

// ----- REST API -----
function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(interfaces)) {
    const net = interfaces[name];
    if (!net) continue;
    for (const addr of net) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

function pickBestIP(ips: string[]): string {
  // prefer common Wi-Fi / ethernet subnets: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
  const preferred = ips.filter(
    (ip) =>
      ip.startsWith("192.168.") ||
      ip.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
  return preferred.length > 0 ? preferred[preferred.length - 1] : ips[0] ?? "127.0.0.1";
}

app.get("/api/health", (_req, res) => {
  const ips = getLocalIPs();
  res.json({
    ok: true,
    mode: process.env.OPENAI_API_KEY ? "ai-ready" : "mock-dm",
    localIP: pickBestIP(ips),
    allIPs: ips
  });
});

app.get("/api/scenarios", (_req, res) => {
  res.json(scenarios);
});

app.post("/api/rooms", (req, res) => {
  const body = req.body as CreateRoomRequest;

  if (!body.hostName?.trim() || !body.scenarioId || !body.mode) {
    return res.status(400).json({ error: "缺少 hostName、scenarioId 或 mode" });
  }

  if (body.mode !== "single" && body.mode !== "multi") {
    return res.status(400).json({ error: "mode 必须是 single 或 multi" });
  }

  const session = createRoom(body.hostName.trim(), body.scenarioId, body.mode);

  // single-player: auto-start immediately
  if (body.mode === "single") {
    const room = getRoom(session.room.id)!;

    const roleCards = buildRoleCards(room.scenarioId, room.players);
    assignRoleCards(room.id, roleCards);

    updateRoom(room.id, (draft) => {
      draft.status = "in_progress";
      draft.worldState.currentLocation = "故事开场";
      draft.worldState.quests = ["活下来", "找到真相", "别轻信任何人"];
    });

    appendMessages(room.id, buildOpening(room));

    broadcastRoom(session.room.id);
  }

  return res.status(201).json(session);
});

app.get("/api/rooms/:roomId", (req, res) => {
  const room = getRoom(req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: "房间不存在" });
  }

  return res.json(room);
});

app.post("/api/rooms/:roomId/join", (req, res) => {
  try {
    const body = req.body as JoinRoomRequest;

    if (!body.playerName?.trim()) {
      return res.status(400).json({ error: "缺少 playerName" });
    }

    const session = joinRoom(req.params.roomId, body.playerName.trim());

    broadcastRoom(req.params.roomId);

    return res.status(201).json(session);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "加入房间失败"
    });
  }
});

app.post("/api/rooms/:roomId/ready", (req, res) => {
  try {
    const { playerId } = req.body as { playerId: string };
    if (!playerId) {
      return res.status(400).json({ error: "缺少 playerId" });
    }

    const room = toggleReady(req.params.roomId, playerId);

    broadcastRoom(req.params.roomId);

    return res.json(room);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "操作失败"
    });
  }
});

app.post("/api/rooms/:roomId/start", (req, res) => {
  try {
    const { playerId } = req.body as { playerId?: string };
    const room = getRoom(req.params.roomId);

    if (!room) {
      return res.status(404).json({ error: "房间不存在" });
    }

    if (room.status !== "lobby") {
      return res.status(400).json({ error: "游戏已经开始" });
    }

    if (playerId && playerId !== room.hostPlayerId) {
      return res.status(403).json({ error: "只有房主可以开始游戏" });
    }

    const notReady = room.players.filter((p) => !p.ready);
    if (notReady.length > 0) {
      return res.status(400).json({
        error: `${notReady.map((p) => p.name).join("、")} 还没准备好`
      });
    }

    const roleCards = buildRoleCards(room.scenarioId, room.players);
    const sceneState = buildInitialSceneState(room.scenarioId);

    assignRoleCards(room.id, roleCards);
    replaceSceneObjects(room.id, sceneState.interactiveObjects);

    updateRoom(room.id, (draft) => {
      draft.status = "in_progress";
      draft.worldState.currentLocation = "故事开场";
      draft.worldState.quests = ["活下来", "找到真相", "别轻信任何人"];
      draft.worldState.clues = sceneState.clues;
      draft.worldState.sceneTitle = sceneState.sceneTitle;
      draft.worldState.sceneDescription = sceneState.sceneDescription;
    });

    appendMessages(room.id, buildOpening(room));

    broadcastRoom(req.params.roomId);

    return res.json(room);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "开始游戏失败"
    });
  }
});

app.post("/api/rooms/:roomId/turn", async (req, res) => {
  try {
    const body = req.body as TurnRequest;
    const room = getRoom(req.params.roomId);

    if (!room) {
      return res.status(404).json({ error: "房间不存在" });
    }

    if (room.status !== "in_progress") {
      return res.status(400).json({ error: "游戏尚未开始" });
    }

    const player = room.players.find((item) => item.id === body.playerId);
    if (!player) {
      return res.status(404).json({ error: "玩家不存在" });
    }

    if (!body.content?.trim()) {
      return res.status(400).json({ error: "行动内容不能为空" });
    }

    if (!lockTurn(room.id)) {
      return res.status(409).json({ error: "DM 正在回应上一个行动，请稍后再试" });
    }

    try {
      appendMessages(room.id, [
        {
          type: "player",
          speaker: player.name,
          content: body.content.trim(),
          playerId: player.id
        }
      ]);

      broadcastRoom(req.params.roomId);

      const dmResult = await resolveTurn(room, player, body.content.trim());

      updateRoom(room.id, (draft) => {
        draft.worldState.round += 1;
        draft.worldState.tension = Math.min(10, draft.worldState.tension + 1);
        draft.worldState.currentLocation = dmResult.nextLocation;
        draft.worldState.interactiveObjects = dmResult.interactiveObjects;
        if (!draft.worldState.clues.includes(dmResult.newClue)) {
          draft.worldState.clues = [...draft.worldState.clues, dmResult.newClue];
        }
      });

      appendMessages(room.id, [
        {
          type: "ai",
          speaker: "AI DM",
          content: dmResult.narration
        }
      ]);

      // trigger vote every 3 rounds
      if (room.worldState.round % 3 === 0 && !activeVotes.has(room.id)) {
        triggerVote(room.id);
      }

      broadcastRoom(req.params.roomId);

      return res.json(room);
    } finally {
      unlockTurn(room.id);
    }
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "提交行动失败"
    });
  }
});

server.listen(port, () => {
  console.log(`AI dungeon server (with WebSocket) listening on http://localhost:${port}`);
});
