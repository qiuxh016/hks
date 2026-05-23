import { Player, PlayerActionRecord, Room } from "../shared/types";

const MAX_ACTIONS_PER_PLAYER = 30;
const MAX_MEMORABLE_MOMENTS = 12;

export function recordPlayerAction(room: Room, player: Player, content: string) {
  const memory = room.worldState.memory;
  const round = room.worldState.round;
  const record: PlayerActionRecord = {
    round,
    content,
    at: new Date().toISOString()
  };

  if (!memory.playerActions[player.id]) {
    memory.playerActions[player.id] = [];
  }

  memory.playerActions[player.id].push(record);
  memory.playerActions[player.id] = memory.playerActions[player.id].slice(-MAX_ACTIONS_PER_PLAYER);
  memory.lastActionAt = record.at;

  const snippet = `第${round}回合·${player.name}：${content}`;
  memory.memorableMoments.push(snippet);
  memory.memorableMoments = memory.memorableMoments.slice(-MAX_MEMORABLE_MOMENTS);

  appendStorySummaryLine(room, player.name, content, round);
}

function appendStorySummaryLine(room: Room, playerName: string, content: string, round: number) {
  const line = `R${round} ${playerName}→${content}`;
  const memory = room.worldState.memory;

  memory.storySummary = memory.storySummary
    ? `${memory.storySummary}\n${line}`
    : line;

  const lines = memory.storySummary.split("\n");
  if (lines.length > 24) {
    memory.storySummary = lines.slice(-24).join("\n");
  }
}

export function formatMemoryForPrompt(room: Room) {
  const memory = room.worldState.memory;
  const actionLines = room.players
    .map((player) => {
      const actions = memory.playerActions[player.id] ?? [];
      if (actions.length === 0) {
        return `- ${player.name}：尚无行动记录`;
      }

      const recent = actions
        .slice(-8)
        .map((item) => `  ·[回合${item.round}] ${item.content}`)
        .join("\n");

      return `- ${player.name} 的历史操作：\n${recent}`;
    })
    .join("\n");

  const moments =
    memory.memorableMoments.length > 0
      ? memory.memorableMoments.slice(-6).join("\n")
      : "（暂无）";

  return [
    "【长期记忆·剧情摘要】",
    memory.storySummary || "（故事刚开场）",
    "",
    "【玩家长期操作档案】",
    actionLines,
    "",
    "【值得调侃的名场面】",
    moments,
    "",
    "你必须记住以上玩家操作，判定时要呼应他们之前做过的事，不要失忆。"
  ].join("\n");
}

export function countPlayerActions(room: Room) {
  return Object.values(room.worldState.memory.playerActions).reduce(
    (total, list) => total + list.length,
    0
  );
}

export function msSince(iso: string | null) {
  if (!iso) {
    return Number.POSITIVE_INFINITY;
  }

  return Date.now() - new Date(iso).getTime();
}
