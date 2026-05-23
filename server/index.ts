import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import {
  CreateRoomRequest,
  JoinRoomRequest,
  TurnRequest,
  UpdateRoomSettingsRequest
} from "../shared/types";
import { buildOpening, buildRoleCards } from "./dm";
import { startTeaseScheduler } from "./teaseScheduler";
import { executeHumanTurn, kickoffTurnCycle } from "./turnFlow";
import { scenarios } from "./scenarios";
import {
  appendMessages,
  applyBotDisplayNames,
  assignRoleCards,
  createRoom,
  dedupeHumanPlayers,
  fillBotPlayers,
  getRoom,
  initTurnOrder,
  joinRoom,
  setProcessingTurn,
  updateRoom,
  updateRoomMaxPlayers
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

  const session = createRoom(body.hostName.trim(), body.scenarioId, body.maxPlayers);
  return res.status(201).json(session);
});

app.patch("/api/rooms/:roomId/settings", (req, res) => {
  try {
    const body = req.body as UpdateRoomSettingsRequest & { hostPlayerId: string };

    if (!body.hostPlayerId) {
      return res.status(400).json({ error: "缺少 hostPlayerId" });
    }

    if (!body.maxPlayers) {
      return res.status(400).json({ error: "缺少 maxPlayers" });
    }

    const room = updateRoomMaxPlayers(req.params.roomId, body.hostPlayerId, body.maxPlayers);
    return res.json(room);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "更新房间设置失败"
    });
  }
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

    dedupeHumanPlayers(room);
    fillBotPlayers(room);

    const roleCards = buildRoleCards(room.scenarioId, room.players);
    assignRoleCards(room.id, roleCards);
    applyBotDisplayNames(room);
    initTurnOrder(room);

    const roomWithRoles = getRoom(room.id);
    if (!roomWithRoles) {
      return res.status(404).json({ error: "房间不存在" });
    }

    const opening = await buildOpening(roomWithRoles);

    updateRoom(room.id, (draft) => {
      draft.status = "in_progress";
      draft.worldState.currentLocation = opening.nextLocation;
      draft.worldState.quests = opening.quests;
      draft.worldState.memory.storySummary = [
        `走向：${opening.storyDirection}`,
        `真相：${opening.coreTruth}`,
        `目标：${opening.quests.join("；")}`
      ].join("\n");
    });

    appendMessages(room.id, opening.messages);

    setProcessingTurn(room.id, false);
    kickoffTurnCycle(room.id);

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

    if (!body.content?.trim()) {
      return res.status(400).json({ error: "行动内容不能为空" });
    }

    const updatedRoom = await executeHumanTurn(req.params.roomId, body.playerId, body.content.trim());
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
