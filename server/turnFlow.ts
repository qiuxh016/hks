import {
  AI_HOST_SPEAKER,
  Player,
  Room,
  getCurrentTurnPlayer,
  getTurnPhaseLabel
} from "../shared/types";
import { refreshBotMind } from "./botMind";
import { generateBotAction } from "./botPlayer";
import {
  applyObjectiveUpdates,
  buildGameEndReport,
  formatGameEndBrief,
  formatNewClueMessage,
  formatObjectiveProgressMessage,
  mergeInvestigationClues,
  refreshStorySummary,
  resolveTurn
} from "./dm";
import { formatCaseProgressForPlayers, reconcileTurnOutcome, syncClueChainStep } from "./caseProgress";
import { recordPlayerAction } from "./memory";
import {
  advanceTurn,
  appendMessages,
  endGame,
  getRoom,
  setProcessingTurn,
  updateRoom
} from "./store";

const roomLocks = new Set<string>();

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

async function runSingleTurn(roomId: string, player: Player, content: string): Promise<boolean> {
  const room = getRoom(roomId);

  if (!room || room.status !== "in_progress") {
    throw new Error("游戏未在进行中");
  }

  const beforeObjectives = room.worldState.objectives.map((item) => ({ ...item }));
  const dmResult = await resolveTurn(room, player, content);
  const provisionalObjectives = applyObjectiveUpdates(
    room.worldState.objectives,
    dmResult.objectiveUpdates
  );
  const reconciled = reconcileTurnOutcome(
    { ...room, worldState: { ...room.worldState, objectives: provisionalObjectives } },
    dmResult,
    provisionalObjectives,
    content
  );
  const afterObjectives = applyObjectiveUpdates(
    room.worldState.objectives,
    reconciled.objectiveUpdates
  );
  const mergedClues = mergeInvestigationClues(
    room.worldState.investigationClues,
    reconciled.newClues
  );

  updateRoom(roomId, (draft) => {
    draft.worldState.tension = Math.min(10, draft.worldState.tension + 1);
    draft.worldState.currentLocation = reconciled.nextLocation;
    draft.worldState.objectives = afterObjectives;
    draft.worldState.investigationClues = mergedClues;
    draft.worldState.clues = mergedClues.map((item) => item.text);
    draft.worldState.quests = afterObjectives
      .filter((item) => item.scope === "session")
      .map((item) => item.text);
    syncClueChainStep(draft);
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

  const storyMessages: Array<Parameters<typeof appendMessages>[1][number]> = [
    {
      type: "player",
      speaker: player.name,
      content,
      playerId: player.id
    },
    {
      type: "ai",
      speaker: AI_HOST_SPEAKER,
      content: reconciled.narration
    }
  ];

  const progressMessage = formatObjectiveProgressMessage(beforeObjectives, afterObjectives);
  if (progressMessage) {
    storyMessages.push({
      type: "system",
      speaker: "任务进度",
      content: progressMessage
    });
  }

  const clueMessage = formatNewClueMessage(reconciled.newClues);
  if (clueMessage) {
    storyMessages.push({
      type: "system",
      speaker: "推理线索",
      content: clueMessage
    });
  }

  const roomForProgress = getRoom(roomId);
  if (roomForProgress && reconciled.gameStatus === "in_progress") {
    const caseProgress = formatCaseProgressForPlayers(roomForProgress);
    if (caseProgress) {
      storyMessages.push({
        type: "system",
        speaker: "结案进度",
        content: caseProgress,
        variant: "brief"
      });
    }
  }

  appendMessages(roomId, storyMessages);

  if (reconciled.gameStatus !== "in_progress") {
    const latest = getRoom(roomId)!;
    const endDraft = reconciled.endDraft ?? {
      outcome: reconciled.gameStatus === "success_end" ? "success" : "failure",
      truthRevealed: latest.worldState.missionBrief?.coreTruth ?? "（未记录）",
      sessionVerdict: "",
      scenarioVerdict: "",
      epilogue: reconciled.narration
    };
    const report = buildGameEndReport(latest, endDraft);

    appendMessages(roomId, [
      {
        type: "system",
        speaker: AI_HOST_SPEAKER,
        content: formatGameEndBrief(report),
        variant: "ending"
      }
    ]);

    endGame(roomId, report);
    return true;
  }

  const beforePhase = getRoom(roomId)!.turnPhase;
  advanceTurn(getRoom(roomId)!);
  const afterRoom = getRoom(roomId)!;

  if (beforePhase === "human" && afterRoom.turnPhase === "bot") {
    announcePhaseChange(afterRoom);
  } else if (beforePhase === "bot" && afterRoom.turnPhase === "human") {
    announcePhaseChange(afterRoom);
  }

  return false;
}

async function runBotPhaseLoop(roomId: string) {
  let room = getRoom(roomId);

  while (room?.status === "in_progress" && room.turnPhase === "bot") {
    const current = getCurrentTurnPlayer(room);

    if (!current || current.kind !== "bot") {
      break;
    }

    announceTurn(room, current);

    await refreshBotMind(roomId, current);
    const roomForAction = getRoom(roomId) ?? room;
    const action = await generateBotAction(roomForAction, current);
    const ended = await runSingleTurn(roomId, current, action);
    if (ended) {
      break;
    }
    room = getRoom(roomId);
  }

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
    const ended = await runSingleTurn(roomId, player, content.trim());
    if (ended) {
      return getRoom(roomId)!;
    }

    const afterHuman = getRoom(roomId)!;

    if (afterHuman.status !== "in_progress") {
      return afterHuman;
    }

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
