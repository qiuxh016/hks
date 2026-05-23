import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import {
  AI_HOST_SPEAKER,
  CreateRoomRequest,
  JoinRoomRequest,
  TurnRequest
} from "../shared/types";
import { buildOpening, buildRoleCards, refreshStorySummary, resolveTurn } from "./dm";
import { recordPlayerAction } from "./memory";
import { startTeaseScheduler } from "./teaseScheduler";
import { scenarios } from "./scenarios";
import {
  appendMessages,
  assignRoleCards,
  createRoom,
  getRoom,
  joinRoom,
  updateRoom
} from "./store";

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env")
});

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: process.env.DEEPSEEK_API_KEY ? "ai-ready" : "no-api-key" });
});

app.get("/api/scenarios", (_req, res) => {
  res.json(scenarios);
});

app.post("/api/rooms", (req, res) => {
  const body = req.body as CreateRoomRequest;

  if (!body.hostName?.trim() || !body.scenarioId) {
    return res.status(400).json({ error: "缺少 hostName 或 scenarioId" });
  }

  const session = createRoom(body.hostName.trim(), body.scenarioId);
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
    return res.status(201).json(session);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "加入房间失败"
    });
  }
});

app.post("/api/rooms/:roomId/start", async (req, res) => {
  try {
    const room = getRoom(req.params.roomId);

    if (!room) {
      return res.status(404).json({ error: "房间不存在" });
    }

    if (room.status !== "lobby") {
      return res.status(400).json({ error: "游戏已经开始" });
    }

    const roleCards = buildRoleCards(room.scenarioId, room.players);
    assignRoleCards(room.id, roleCards);

    const roomWithRoles = getRoom(room.id);
    if (!roomWithRoles) {
      return res.status(404).json({ error: "房间不存在" });
    }

    const opening = await buildOpening(roomWithRoles);

    updateRoom(room.id, (draft) => {
      draft.status = "in_progress";
      draft.worldState.currentLocation = opening.nextLocation;
      draft.worldState.quests = ["活下来", "找到真相", "别轻信任何人"];
      const openingLine = opening.messages.find((message) => message.type === "ai")?.content;
      if (openingLine) {
        draft.worldState.memory.storySummary = `开场：${openingLine.slice(0, 240)}`;
      }
    });

    appendMessages(room.id, opening.messages);

    return res.json(getRoom(room.id));
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

    const content = body.content.trim();
    const dmResult = await resolveTurn(room, player, content);

    updateRoom(room.id, (draft) => {
      draft.worldState.round += 1;
      draft.worldState.tension = Math.min(10, draft.worldState.tension + 1);
      draft.worldState.currentLocation = dmResult.nextLocation;
    });

    const roomAfterRound = getRoom(room.id);
    if (roomAfterRound) {
      recordPlayerAction(roomAfterRound, player, content);

      if (roomAfterRound.worldState.round % 4 === 0) {
        void refreshStorySummary(roomAfterRound).catch((error) => {
          console.error(`[memory] room ${room.id}:`, error instanceof Error ? error.message : error);
        });
      }
    }

    appendMessages(room.id, [
      {
        type: "player",
        speaker: player.name,
        content,
        playerId: player.id
      },
      {
        type: "ai",
        speaker: AI_HOST_SPEAKER,
        content: dmResult.narration
      }
    ]);

    const updatedRoom = getRoom(room.id);
    return res.json(updatedRoom);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "提交行动失败"
    });
  }
});

app.listen(port, () => {
  startTeaseScheduler();
  console.log(`AI dungeon server listening on http://localhost:${port}`);
});

