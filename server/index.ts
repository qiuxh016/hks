import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { validateChatPost } from "./chatRelay";
import {
  AccusationOption,
  AccusationVoteState,
  CreateRoomRequest,
  ChatPostPayload,
  ChatPost,
  JoinRoomRequest,
  SelectRoleRequest,
  PlayerAgentAssistRequest,
  StartAccusationRequest,
  TurnRequest,
  UpdateRoomSettingsRequest
} from "../shared/types";
import { generatePlayerAgentAssist } from "./playerAgent";
import {
  buildAccusationOptions,
  ensureAccusationMeta,
  finalizeAccusationVote
} from "./accusation";
import { registerBehaviorReviewBroadcaster } from "./behaviorReview";
// ─── Voice relay store ───
// roomId → { chunks: VoiceChunk[], voicePeers: Map<playerId, {name, joinedAt}> }
const voiceState = new Map<string, {
  chunks: any[];
  voicePeers: Map<string, { name: string; joinedAt: number }>;
}>();

function getOrCreateVoiceState(roomId: string) {
  if (!voiceState.has(roomId)) {
    voiceState.set(roomId, { chunks: [], voicePeers: new Map() });
  }
  return voiceState.get(roomId)!;
}

import { registerMysteryRevealBroadcaster } from "./mysteryReveal";
import { buildInitialSceneState, buildOpening, formatGameEndBrief } from "./dm";
import { touchChatActivity } from "./memory";
import { startTeaseScheduler } from "./teaseScheduler";
import { executeHumanTurn, kickoffTurnCycle, setFastForward } from "./turnFlow";
import { scenarios } from "./scenarios";
import {
  appendMessages,
  applyBotDisplayNames,
  choosePlayerRole,
  countHumanPlayers,
  createRoom,
  dedupeHumanPlayers,
  finalizeGameRoles,
  getRoom,
  initTurnOrder,
  joinRoom,
  replaceSceneObjects,
  setProcessingTurn,
  togglePlayerReady,
  updateRoom,
  updateRoomMaxPlayers
} from "./store";

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env")
});

const app = express();
const server = http.createServer(app);
const port = Number(process.env.DEPLOY_RUN_PORT ?? process.env.PORT ?? 8787);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 3e6
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

registerBehaviorReviewBroadcaster(broadcastRoom);
registerMysteryRevealBroadcaster(broadcastRoom);

// ----- active votes -----
const activeVotes = new Map<string, {
  question: string;
  options: string[];
  votes: Map<string, string>;
  timeout: NodeJS.Timeout;
}>();

const activeAccusationVotes = new Map<string, {
  options: AccusationOption[];
  votes: Map<string, string>;
  timeout: NodeJS.Timeout;
  initiatedBy: string;
  gameInstanceId: string;
}>();

const ACCUSATION_VOTE_MS = 45_000;

function cancelRegularVote(roomId: string) {
  const vote = activeVotes.get(roomId);
  if (!vote) {
    return;
  }

  clearTimeout(vote.timeout);
  activeVotes.delete(roomId);
}

function cancelAccusationVote(roomId: string) {
  const vote = activeAccusationVotes.get(roomId);
  if (!vote) {
    return;
  }

  clearTimeout(vote.timeout);
  activeAccusationVotes.delete(roomId);
}

function startAccusationVote(roomId: string, initiatedBy: string) {
  const room = getRoom(roomId);
  if (!room || room.status !== "in_progress") {
    throw new Error("游戏未在进行中");
  }

  if (!room.gameInstanceId) {
    throw new Error("对局尚未开始，无法指认真凶");
  }

  if (activeAccusationVotes.has(roomId)) {
    throw new Error("指认真凶投票已在进行中");
  }

  cancelRegularVote(roomId);

  const options = buildAccusationOptions(room);
  const votes = new Map<string, string>();
  const gameInstanceId = room.gameInstanceId;
  const timeout = setTimeout(() => {
    void finalizeAccusationVoteFlow(roomId, gameInstanceId);
  }, ACCUSATION_VOTE_MS);

  activeAccusationVotes.set(roomId, { options, votes, timeout, initiatedBy, gameInstanceId });

  const initiator = room.players.find((player) => player.id === initiatedBy);

  const voteState: AccusationVoteState = {
    question: "指认真凶：你认为谁是本案真凶？（多数票决，直接结案）",
    options,
    deadline: Date.now() + ACCUSATION_VOTE_MS,
    initiatedBy: initiator?.name ?? "某玩家",
    gameInstanceId: room.gameInstanceId,
    voterNames: []
  };

  // 将投票状态存入 room.worldState，确保所有玩家都能通过房间状态获取
  updateRoom(roomId, (draft) => {
    draft.worldState.activeAccusation = voteState;
  });

  io.to(roomId).emit("accusation:start", voteState);

  appendMessages(roomId, [
    {
      type: "system",
      speaker: "系统",
      content: `⚖️ ${initiator?.name ?? "某玩家"} 发起了「指认真凶」投票（${ACCUSATION_VOTE_MS / 1000} 秒内，全体真人玩家投票后直接结案）。`
    }
  ]);

  broadcastRoom(roomId);
}

async function finalizeAccusationVoteFlow(roomId: string, expectedGameInstanceId?: string) {
  const vote = activeAccusationVotes.get(roomId);
  if (!vote) {
    return;
  }

  if (expectedGameInstanceId && vote.gameInstanceId !== expectedGameInstanceId) {
    return;
  }

  const roomNow = getRoom(roomId);
  if (!roomNow || roomNow.gameInstanceId !== vote.gameInstanceId) {
    clearTimeout(vote.timeout);
    activeAccusationVotes.delete(roomId);
    return;
  }

  clearTimeout(vote.timeout);
  activeAccusationVotes.delete(roomId);

  // 清除 room.worldState 中的投票状态
  updateRoom(roomId, (draft) => {
    draft.worldState.activeAccusation = undefined;
  });

  const result = await finalizeAccusationVote(roomId, vote.votes, vote.options);
  if (!result) {
    appendMessages(roomId, [
      {
        type: "system",
        speaker: "系统",
        content: "指认真凶投票无效（无人投票），游戏继续。"
      }
    ]);
    updateRoom(roomId, (draft) => {
      draft.worldState.activeAccusation = undefined;
    });
    broadcastRoom(roomId);
    return;
  }

  const room = getRoom(roomId);
  const report = room?.worldState.gameEnd;

  io.to(roomId).emit("accusation:result", result);

  const tallyText = Object.entries(result.tally)
    .map(([label, count]) => `${label}：${count} 票`)
    .join("，");

  appendMessages(roomId, [
    {
      type: "system",
      speaker: "系统",
      content: `📊 指认真凶投票：${tallyText} → 指认「${result.accusedName}」`
    },
    {
      type: "system",
      speaker: "系统",
      content: result.correct
        ? `✅ ${result.verdict}：你们成功揪出真凶！`
        : `❌ ${result.verdict}：指认错误。`,
      variant: result.correct ? "brief" : "ending"
    },
    ...(report
      ? [
          {
            type: "system" as const,
            speaker: "AI主持人",
            content: formatGameEndBrief(report),
            variant: "ending" as const
          }
        ]
      : [])
  ]);

  broadcastRoom(roomId);
}

function triggerVote(roomId: string) {
  const room = getRoom(roomId);
  if (!room || room.status !== "in_progress") return;

  cancelAccusationVote(roomId);

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
  const options = [...q.options, "🙅 弃权"];

  const votes = new Map<string, string>();
  const timeout = setTimeout(() => {
    finalizeVote(roomId);
  }, 30000);

  activeVotes.set(roomId, { question: q.question, options, votes, timeout });

  io.to(roomId).emit("vote:start", {
    question: q.question,
    options,
    deadline: Date.now() + 30000
  });

  appendMessages(roomId, [{
    type: "system",
    speaker: "DM",
    content: `⚡ 投票开始：${q.question}（30 秒内投票，可选弃权）`
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

  const totalVotes = Object.values(tally).reduce((s, c) => s + c, 0);

  const resultText = Object.entries(tally)
    .map(([opt, count]) => `${opt}：${count} 票`)
    .join("，");

  let winner: string | null = null;
  let narrative: string;

  if (totalVotes === 0) {
    narrative = "没有人投票，看来大家对这个话题还没有明确的想法。故事继续推进。";
  } else {
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    if (top[0] === "🙅 弃权") {
      narrative = "多数人选择弃权，没有形成明确的共识。故事继续推进。";
    } else {
      winner = top[0];
      narrative = `投票结果让局势更加明朗——"${winner}"成为了众人目光的焦点。这个结果将影响接下来的剧情走向。`;
    }
  }

  io.to(roomId).emit("vote:result", { tally, winner });

  appendMessages(roomId, [
    {
      type: "system",
      speaker: "DM",
      content: `📊 投票结果：${resultText}${totalVotes === 0 ? "（无人投票）" : ""}`
    },
    {
      type: "ai",
      speaker: "AI主持人",
      content: narrative
    }
  ]);

  broadcastRoom(roomId);
}

// ----- socket.io (real-time communication) -----
io.on("connection", (socket) => {
  console.log("[socket] connected:", socket.id);
  socket.on("room:join", (roomId: string) => {
    console.log("[socket] room:join", socket.id, roomId);
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

  socket.on(
    "accusation:submit",
    (payload: { roomId: string; playerId: string; accusedPlayerId: string }) => {
      const vote = activeAccusationVotes.get(payload.roomId);
      if (!vote) {
        socket.emit("error", "当前没有进行中的指认真凶投票");
        return;
      }

      const room = getRoom(payload.roomId);
      if (!room || room.gameInstanceId !== vote.gameInstanceId) {
        socket.emit("error", "本局指认投票已失效，请开始新的对局");
        return;
      }

      const player = room.players.find((item) => item.id === payload.playerId);

      if (!player || player.kind !== "human") {
        socket.emit("error", "仅真人玩家可参与指认真凶投票");
        return;
      }

      if (!vote.options.some((option) => option.playerId === payload.accusedPlayerId)) {
        socket.emit("error", "无效的指认对象");
        return;
      }

      vote.votes.set(payload.playerId, payload.accusedPlayerId);

      // 更新 room.worldState.activeAccusation 的投票者列表
      updateRoom(payload.roomId, (draft) => {
        if (draft.worldState.activeAccusation) {
          if (!draft.worldState.activeAccusation.voterNames) {
            draft.worldState.activeAccusation.voterNames = [];
          }
          if (!draft.worldState.activeAccusation.voterNames.includes(player.name)) {
            draft.worldState.activeAccusation.voterNames.push(player.name);
          }
        }
      });

      io.to(payload.roomId).emit("accusation:update", {
        voterName: player.name,
        voted: true
      });

      broadcastRoom(payload.roomId);

      const humanPlayers = room?.players.filter((item) => item.kind === "human") ?? [];
      const allVoted = humanPlayers.every((item) => vote.votes.has(item.id));

      if (allVoted) {
        void finalizeAccusationVoteFlow(payload.roomId, vote.gameInstanceId);
      }
    }
  );

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

  // voice relay
  socket.on("voice:start", (roomId: string, playerName: string) => {
    socket.broadcast.to(roomId).emit("voice:start", playerName);
  });

  socket.on("voice:data", (roomId: string, chunk: ArrayBuffer) => {
    socket.broadcast.to(roomId).emit("voice:data", chunk);
  });

  socket.on("voice:end", (roomId: string, playerName: string) => {
    socket.broadcast.to(roomId).emit("voice:end", playerName);
  });

  // chat relay
  socket.on("chat:post", (roomId: string, payload: ChatPostPayload) => {
    console.log("[chat:post] received:", roomId, payload?.playerName, payload?.type, (payload?.content || "").slice(0, 30));
    const room = getRoom(roomId);
    if (!room) {
      console.log("[chat:post] room not found:", roomId);
      socket.emit("error", "房间不存在");
      return;
    }

    const error = validateChatPost(payload);
    if (error) {
      socket.emit("error", error);
      return;
    }

    const chatPost = {
      ...payload,
      type: payload.type ?? "text",
      createdAt: new Date().toISOString()
    };

    updateRoom(roomId, (draft) => {
      touchChatActivity(draft);
      draft.chatPosts.push(chatPost);
    });

    io.to(roomId).emit("chat:post", chatPost);
  });

  socket.on("chat:message", (roomId: string, payload: { playerName: string; content: string; id: string }) => {
    updateRoom(roomId, (draft) => {
      touchChatActivity(draft);
    });

    io.to(roomId).emit("chat:message", {
      ...payload,
      createdAt: new Date().toISOString()
    });
  });

  socket.on("fast-forward", (roomId: string) => {
    setFastForward(roomId);
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
    mode: process.env.DEEPSEEK_API_KEY ? "ai-ready" : "no-api-key",
    localIP: pickBestIP(ips),
    allIPs: ips
  });
});

app.get("/api/scenarios", (_req, res) => {
  res.json(scenarios);
});

app.post("/api/rooms", (req, res) => {
  try {
    const body = req.body as CreateRoomRequest;

    if (!body.hostName?.trim() || !body.scenarioId) {
      return res.status(400).json({ error: "缺少 hostName 或 scenarioId" });
    }

    const session = createRoom(body.hostName.trim(), body.scenarioId, body.maxPlayers, body.mode);
    return res.status(201).json(session);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "创建房间失败"
    });
  }
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
    broadcastRoom(req.params.roomId);
    return res.json(room);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "更新房间设置失败"
    });
  }
});

/* ── HTTP chat fallback ── */
app.post("/api/rooms/:roomId/chat", (req, res) => {
  try {
    const { roomId } = req.params;
    const payload = req.body as ChatPostPayload;
    const room = getRoom(roomId);
    if (!room) { res.status(404).json({ error: "Room not found" }); return; }
    const validationError = validateChatPost(payload);
    if (validationError) { res.status(400).json({ error: validationError }); return; }
    if (!room.worldState) {
      (room as any).worldState = { memory: { storySummary: "", playerActions: {}, memorableMoments: [], lastTeaseAt: null, lastActionAt: null, lastChatAt: new Date().toISOString(), botMinds: {}, playerAgents: {} } };
    } else if (!room.worldState.memory) {
      room.worldState.memory = { storySummary: "", playerActions: {}, memorableMoments: [], lastTeaseAt: null, lastActionAt: null, lastChatAt: new Date().toISOString(), botMinds: {}, playerAgents: {} };
    }
    const chatPost: ChatPost = {
      id: payload.id,
      playerName: payload.playerName ?? "匿名",
      type: payload.type ?? "text",
      content: payload.content ?? "",
      mediaDataUrl: payload.mediaDataUrl,
      createdAt: new Date().toISOString(),
    };
    if (!room.chatPosts) room.chatPosts = [];
    room.chatPosts.push(chatPost);
    touchChatActivity(room);
    io.to(roomId).emit("chat:post", chatPost);
    res.status(201).json(chatPost);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/rooms/:roomId/role", (req, res) => {
  try {
    const body = req.body as SelectRoleRequest;
    if (!body.playerId) {
      return res.status(400).json({ error: "缺少 playerId" });
    }

    const room = choosePlayerRole(req.params.roomId, body.playerId, body.roleSlotId ?? null);
    broadcastRoom(req.params.roomId);
    return res.json(room);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "选择角色失败"
    });
  }
});

app.patch("/api/rooms/:roomId/ready", (req, res) => {
  try {
    const body = req.body as { playerId: string };
    if (!body.playerId) {
      return res.status(400).json({ error: "缺少 playerId" });
    }

    const room = togglePlayerReady(req.params.roomId, body.playerId);
    broadcastRoom(req.params.roomId);
    return res.json(room);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "准备状态切换失败"
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
    broadcastRoom(req.params.roomId);
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

    const noRole = room.players.filter((p) => p.kind === "human" && !p.roleSlotId);
    if (noRole.length > 0) {
      return res.status(400).json({
        error: `以下玩家尚未选择角色：${noRole.map((p) => p.name).join("、")}`
      });
    }

    dedupeHumanPlayers(room);

    const botCount = finalizeGameRoles(room);
    if (botCount > 0) {
      appendMessages(room.id, [
        {
          type: "system",
          speaker: "系统",
          content: `有 ${botCount} 个角色无人选择，已由 AI 机器人扮演。`
        }
      ]);
    }
    applyBotDisplayNames(room);

    // set up initial scene objects
    const sceneState = buildInitialSceneState(room.scenarioId);
    replaceSceneObjects(room.id, sceneState.interactiveObjects);

    initTurnOrder(room);

    const roomWithRoles = getRoom(room.id);
    if (!roomWithRoles) {
      return res.status(404).json({ error: "房间不存在" });
    }

    const opening = await buildOpening(roomWithRoles);

    cancelAccusationVote(room.id);

    const gameInstanceId = `run_${crypto.randomBytes(4).toString("hex")}`;

    updateRoom(room.id, (draft) => {
      draft.gameInstanceId = gameInstanceId;
      draft.status = "in_progress";
      draft.worldState.gameEnd = undefined;
      draft.worldState.behaviorReviews = undefined;
      draft.worldState.fullMysteryReveal = undefined;
      draft.worldState.accusationMeta = undefined;
      draft.worldState.currentLocation = opening.nextLocation;
      draft.worldState.objectives = opening.objectives;
      draft.worldState.quests = opening.sessionObjectives;
      draft.worldState.missionBrief = {
        storyDirection: opening.storyDirection,
        coreTruth: opening.coreTruth,
        victoryChecklist: opening.resolutionCriteria.victoryChecklist,
        naturalEndAction: opening.resolutionCriteria.naturalEndAction,
        suggestedRounds: opening.resolutionCriteria.suggestedRounds
      };
      draft.worldState.resolutionCriteria = opening.resolutionCriteria;
      draft.worldState.clueChainStep = Math.min(1, opening.openingClues.length);
      draft.worldState.mysteryPlan = opening.mysteryPlan;
      draft.worldState.investigationClues =
        opening.openingClues.length > 0
          ? opening.openingClues
          : sceneState.clues.map((text, index) => ({
              id: `clue-${index + 1}`,
              text,
              round: 0,
              source: "开场场景",
              relatesTo: index === 0 ? "session-1" : "core-truth"
            }));
      draft.worldState.clues = draft.worldState.investigationClues.map((item) => item.text);
      draft.worldState.sceneTitle = sceneState.sceneTitle;
      draft.worldState.sceneDescription = sceneState.sceneDescription;
      draft.worldState.memory.storySummary = [
        `走向：${opening.storyDirection}`,
        `真相：${opening.coreTruth}`,
        `本剧必做：${opening.scenarioObjectives.join("；")}`,
        `本局必做：${opening.sessionObjectives.join("；")}`
      ].join("\n");
    });

    /* 逐条发送开场消息 */
    for (const msg of opening.messages) {
      appendMessages(room.id, [msg]);
      await new Promise((r) => setTimeout(r, 500));
    }

    appendMessages(room.id, [
      {
        type: "system" as const,
        speaker: "系统",
        content:
          "📌 本局为独立对局：指认真凶投票结果仅在本局有效；退出游戏或开始新一局后，上次推理结果作废，可重新投票。",
        variant: "brief" as const
      }
    ]);

    const roomStarted = getRoom(room.id);
    if (roomStarted && roomStarted.worldState.investigationClues.length > 0) {
      await new Promise((r) => setTimeout(r, 400));
      const clueLines = roomStarted.worldState.investigationClues
        .map((item) => `· ${item.text}`)
        .join("\n");
      appendMessages(room.id, [
        {
          type: "system",
          speaker: "推理线索",
          content: `🧩 开局已知线索（请据此推理）：\n${clueLines}`,
          variant: "brief"
        }
      ]);
    }

    setProcessingTurn(room.id, false);
    kickoffTurnCycle(room.id);

    void ensureAccusationMeta(room.id).catch((error) => {
      console.error(
        `[accusation] room ${room.id}:`,
        error instanceof Error ? error.message : error
      );
    });

    broadcastRoom(room.id);

    return res.json(getRoom(room.id));
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "开始游戏失败"
    });
  }
});

app.post("/api/rooms/:roomId/accusation", async (req, res) => {
  try {
    const body = req.body as StartAccusationRequest;
    const room = getRoom(req.params.roomId);

    if (!room) {
      return res.status(404).json({ error: "房间不存在" });
    }

    if (room.status !== "in_progress") {
      return res.status(400).json({ error: "游戏进行中才可指认真凶" });
    }

    const player = room.players.find((item) => item.id === body.playerId);
    if (!player || player.kind !== "human") {
      return res.status(400).json({ error: "仅真人玩家可发起指认真凶" });
    }

    await ensureAccusationMeta(room.id);
    startAccusationVote(room.id, body.playerId);

    // 返回投票状态，供前端在 socket 不可用时直接使用
    const options = buildAccusationOptions(room);
    const voteState: AccusationVoteState = {
      question: "指认真凶：你认为谁是本案真凶？（多数票决，直接结案）",
      options,
      deadline: Date.now() + ACCUSATION_VOTE_MS,
      initiatedBy: player.name,
      gameInstanceId: room.gameInstanceId ?? ""
    };

    return res.json({ ok: true, voteState });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "发起指认真凶失败"
    });
  }
});

/* ── HTTP fallback: accusation submit ── */
app.post("/api/rooms/:roomId/accusation-submit", async (req, res) => {
  try {
    const { roomId } = req.params;
    const { playerId, accusedPlayerId } = req.body as { playerId: string; accusedPlayerId: string };

    const vote = activeAccusationVotes.get(roomId);
    if (!vote) {
      return res.status(400).json({ error: "当前没有进行中的指认真凶投票" });
    }

    const room = getRoom(roomId);
    if (!room || room.gameInstanceId !== vote.gameInstanceId) {
      return res.status(400).json({ error: "本局指认投票已失效" });
    }

    const player = room.players.find((item) => item.id === playerId);
    if (!player || player.kind !== "human") {
      return res.status(400).json({ error: "仅真人玩家可参与指认真凶投票" });
    }

    if (!vote.options.some((option) => option.playerId === accusedPlayerId)) {
      return res.status(400).json({ error: "无效的指认对象" });
    }

    vote.votes.set(playerId, accusedPlayerId);

    // 更新 room.worldState.activeAccusation 的投票者列表
    updateRoom(roomId, (draft) => {
      if (draft.worldState.activeAccusation) {
        if (!draft.worldState.activeAccusation.voterNames) {
          draft.worldState.activeAccusation.voterNames = [];
        }
        if (!draft.worldState.activeAccusation.voterNames.includes(player.name)) {
          draft.worldState.activeAccusation.voterNames.push(player.name);
        }
      }
    });

    io.to(roomId).emit("accusation:update", {
      voterName: player.name,
      voted: true
    });

    broadcastRoom(roomId);

    const humanPlayers = room.players.filter((item) => item.kind === "human");
    const allVoted = humanPlayers.every((item) => vote.votes.has(item.id));

    if (allVoted) {
      void finalizeAccusationVoteFlow(roomId, vote.gameInstanceId);
    }

    return res.json({ ok: true, voterName: player.name });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "投票失败"
    });
  }
});

app.post("/api/rooms/:roomId/player-agent", async (req, res) => {
  try {
    const body = req.body as PlayerAgentAssistRequest;

    if (!body.playerId) {
      return res.status(400).json({ error: "缺少 playerId" });
    }

    if (!body.consent) {
      return res.status(400).json({ error: "请先同意 Agent 辅助推理条款" });
    }

    const result = await generatePlayerAgentAssist(req.params.roomId, body.playerId, {
      draftAction: body.draftAction?.trim(),
      question: body.question?.trim()
    });

    return res.json(result);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Agent 推理失败"
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

    if (updatedRoom.status === "ended") {
      broadcastRoom(updatedRoom.id);
      return res.json(updatedRoom);
    }

    // trigger vote every 3 rounds
    if (updatedRoom.worldState.round > 0 && updatedRoom.worldState.round % 3 === 0 && !activeVotes.has(updatedRoom.id)) {
      triggerVote(updatedRoom.id);
    }

    broadcastRoom(updatedRoom.id);

    return res.json(updatedRoom);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "提交行动失败"
    });
  }
});

// ----- serve frontend static files (production) -----
const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
app.use(express.static(distPath));

// ─── Voice signalling API ───
// POST /api/rooms/:roomId/voice/join  - join voice channel
app.post("/api/rooms/:roomId/voice/join", (req, res) => {
  const { roomId } = req.params;
  const { playerId, playerName } = req.body as { playerId: string; playerName: string };
  const room = getRoom(roomId);
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  const vs = getOrCreateVoiceState(roomId);
  vs.voicePeers.set(playerId, { name: playerName, joinedAt: Date.now() });
  io.to(roomId).emit("voice:peer-joined", { playerId, playerName });
  const peers = Array.from(vs.voicePeers.entries()).map(([id, v]) => ({ playerId: id, playerName: v.name, joinedAt: v.joinedAt }));
  res.json({ ok: true, peers });
});

// POST /api/rooms/:roomId/voice/leave  - leave voice channel
app.post("/api/rooms/:roomId/voice/leave", (req, res) => {
  const { roomId } = req.params;
  const { playerId } = req.body as { playerId: string };
  const vs = voiceState.get(roomId);
  if (vs) {
    vs.voicePeers.delete(playerId);
    io.to(roomId).emit("voice:peer-left", { playerId });
  }
  res.json({ ok: true });
});

// GET /api/rooms/:roomId/voice/peers  - get current voice peers
app.get("/api/rooms/:roomId/voice/peers", (req, res) => {
  const { roomId } = req.params;
  const vs = voiceState.get(roomId);
  if (!vs) { res.json({ peers: [] }); return; }
  const peers = Array.from(vs.voicePeers.entries()).map(([id, v]) => ({ playerId: id, playerName: v.name, joinedAt: v.joinedAt }));
  res.json({ peers });
});

// POST /api/rooms/:roomId/voice/chunk  - upload audio chunk
app.post("/api/rooms/:roomId/voice/chunk", (req, res) => {
  const { roomId } = req.params;
  const chunk = req.body as { from: string; name: string; data: string; ts: number };
  const vs = getOrCreateVoiceState(roomId);
  vs.chunks.push(chunk);
  // Keep only last 200 chunks to prevent memory bloat
  if (vs.chunks.length > 200) vs.chunks = vs.chunks.slice(-200);
  res.json({ ok: true });
});

// GET /api/rooms/:roomId/voice/chunks?since=<index>  - poll for audio chunks
app.get("/api/rooms/:roomId/voice/chunks", (req, res) => {
  const { roomId } = req.params;
  const since = parseInt(req.query.since as string) || 0;
  const vs = voiceState.get(roomId);
  if (!vs) { res.json({ chunks: [], nextIndex: 0 }); return; }
  const chunks = vs.chunks.slice(since);
  res.json({ chunks, nextIndex: vs.chunks.length });
});

// SPA fallback: all non-API, non-socket.io routes serve index.html
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

server.listen(port, () => {
  startTeaseScheduler();
  console.log(`AI dungeon server (with WebSocket) listening on http://localhost:${port}`);
});
