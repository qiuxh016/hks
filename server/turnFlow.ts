import {
  AI_HOST_SPEAKER,
  Player,
  Room,
  getCurrentTurnPlayer,
  getTurnPhaseLabel
} from "../shared/types";
import { generateBotAction } from "./botPlayer";
import { refreshStorySummary, resolveTurn } from "./dm";
import { recordPlayerAction } from "./memory";
import {
  advanceTurn,
  appendMessages,
  broadcastRoom,
  getRoom,
  setProcessingTurn,
  updateRoom
} from "./store";

const roomLocks = new Set<string>();

const BOT_DELAY_MS = 4000;
const fastForwardRooms = new Set<string>();

export function setFastForward(roomId: string) {
  fastForwardRooms.add(roomId);
}

async function delayWithFastForward(roomId: string, totalMs: number) {
  const pollMs = 200;
  let elapsed = 0;
  while (elapsed < totalMs) {
    if (fastForwardRooms.has(roomId)) return;
    await new Promise((r) => setTimeout(r, pollMs));
    elapsed += pollMs;
  }
}

function announceTurn(room: Room, player: Player) {
  appendMessages(room.id, [
    {
      type: "system",
      speaker: "系统",
      content: `轮到 ${player.name} 行动。`
    }
  ]);
}

function announcePhaseChange(room: Room) {
  if (room.turnPhase === "bot") {
    appendMessages(room.id, [
      {
        type: "system",
        speaker: "系统",
        content: "真人玩家已全部行动完毕，AI 机器人开始本轮行动。"
      }
    ]);
    return;
  }

  appendMessages(room.id, [
    {
      type: "system",
      speaker: "系统",
      content: `第 ${room.worldState.round + 1} 轮开始：真人玩家先行动，随后 AI 机器人行动。`
    }
  ]);
}

async function runSingleTurn(roomId: string, player: Player, content: string) {
  const room = getRoom(roomId);

  if (!room || room.status !== "in_progress") {
    throw new Error("游戏未在进行中");
  }

  // show player action immediately, before waiting for AI
  appendMessages(roomId, [
    {
      type: "player",
      speaker: player.name,
      content,
      playerId: player.id
    }
  ]);
  broadcastRoom(roomId);

  const dmResult = await resolveTurn(room, player, content);

  updateRoom(roomId, (draft) => {
    draft.worldState.tension = Math.min(10, draft.worldState.tension + 1);
    draft.worldState.currentLocation = dmResult.nextLocation;
  });

  const roomAfterAction = getRoom(roomId);
  if (roomAfterAction) {
    recordPlayerAction(roomAfterAction, player, content);

    if (roomAfterAction.worldState.round > 0 && roomAfterAction.worldState.round % 4 === 0) {
      void refreshStorySummary(roomAfterAction).catch((error) => {
        console.error(`[memory] room ${roomId}:`, error instanceof Error ? error.message : error);
      });
    }
  }

  // DM narration follows after AI responds
  appendMessages(roomId, [
    {
      type: "ai",
      speaker: AI_HOST_SPEAKER,
      content: dmResult.narration
    }
  ]);

  const beforePhase = getRoom(roomId)!.turnPhase;
  advanceTurn(getRoom(roomId)!);
  const afterRoom = getRoom(roomId)!;

  if (beforePhase === "human" && afterRoom.turnPhase === "bot") {
    announcePhaseChange(afterRoom);
  } else if (beforePhase === "bot" && afterRoom.turnPhase === "human") {
    announcePhaseChange(afterRoom);
  }
}

async function runBotPhaseLoop(roomId: string) {
  let room = getRoom(roomId);

  while (room?.status === "in_progress" && room.turnPhase === "bot") {
    const current = getCurrentTurnPlayer(room);

    if (!current || current.kind !== "bot") {
      break;
    }

    announceTurn(room, current);
    broadcastRoom(roomId);

    const action = await generateBotAction(room, current);
    await runSingleTurn(roomId, current, action);
    broadcastRoom(roomId);
    room = getRoom(roomId);

    // delay between bots for immersive reading, skippable via fast-forward
    if (room && room.turnPhase === "bot" && !fastForwardRooms.has(roomId)) {
      await delayWithFastForward(roomId, BOT_DELAY_MS);
    }
  }

  fastForwardRooms.delete(roomId);

  const nextHuman = room ? getCurrentTurnPlayer(room) : undefined;
  if (room && nextHuman && room.turnPhase === "human") {
    announceTurn(room, nextHuman);
  }
}

export async function executeHumanTurn(roomId: string, playerId: string, content: string) {
  if (roomLocks.has(roomId)) {
    throw new Error("正在处理回合，请稍候");
  }

  const room = getRoom(roomId);

  if (!room || room.status !== "in_progress") {
    throw new Error("游戏尚未开始");
  }

  if (room.turnPhase !== "human") {
    throw new Error(`当前为${getTurnPhaseLabel(room.turnPhase)}，请等待 AI 机器人行动结束`);
  }

  if (room.isProcessingTurn) {
    throw new Error("正在处理行动，请稍候");
  }

  const player = room.players.find((item) => item.id === playerId);
  if (!player) {
    throw new Error("玩家不存在");
  }

  if (player.kind === "bot") {
    throw new Error("AI 机器人由系统自动操作");
  }

  const current = getCurrentTurnPlayer(room);
  if (!current || current.id !== playerId) {
    throw new Error(`还没轮到你，当前行动：${current?.name ?? "未知"}`);
  }

  roomLocks.add(roomId);
  setProcessingTurn(roomId, true);

  try {
    await runSingleTurn(roomId, player, content.trim());

    const afterHuman = getRoom(roomId)!;

    if (afterHuman.turnPhase === "bot") {
      await runBotPhaseLoop(roomId);
    } else {
      const nextHuman = getCurrentTurnPlayer(afterHuman);
      if (nextHuman) {
        announceTurn(afterHuman, nextHuman);
      }
    }

    return getRoom(roomId)!;
  } finally {
    setProcessingTurn(roomId, false);
    roomLocks.delete(roomId);
  }
}

export function kickoffTurnCycle(roomId: string) {
  const room = getRoom(roomId);

  if (!room || room.status !== "in_progress") {
    return;
  }

  appendMessages(roomId, [
    {
      type: "system",
      speaker: "系统",
      content: "每轮规则：真人玩家先依次输入指令，再由 AI 机器人依次行动。"
    }
  ]);

  announcePhaseChange(room);

  const first = getCurrentTurnPlayer(room);
  if (first) {
    announceTurn(room, first);
  }
}
