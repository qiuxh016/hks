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

function formatPlayerActionArchive(room: Room, perPlayerLimit: number) {
  const memory = room.worldState.memory;

  return room.players
    .map((player) => {
      const actions = memory.playerActions[player.id] ?? [];
      if (actions.length === 0) {
        return `- ${player.name}：尚无行动记录`;
      }

      const recent = actions
        .slice(-perPlayerLimit)
        .map((item) => `  ·[回合${item.round}] ${item.content}`)
        .join("\n");

      return `- ${player.name} 的历史操作：\n${recent}`;
    })
    .join("\n");
}

export function formatMemoryForPrompt(room: Room) {
  const memory = room.worldState.memory;
  const moments =
    memory.memorableMoments.length > 0
      ? memory.memorableMoments.slice(-6).join("\n")
      : "（暂无）";

  return [
    "【长期记忆·剧情摘要】",
    memory.storySummary || "（故事刚开场）",
    "",
    "【玩家长期操作档案】",
    formatPlayerActionArchive(room, 8),
    "",
    "【值得调侃的名场面】",
    moments,
    "",
    "你必须记住以上玩家操作，判定时要呼应他们之前做过的事，不要失忆。"
  ].join("\n");
}

/** AI 机器人视角：区分「我做过什么」与「别人做过什么」，便于连贯扮演 */
export function formatMemoryForBotPrompt(room: Room, player: Player) {
  const memory = room.worldState.memory;
  const myActions = memory.playerActions[player.id] ?? [];

  const myActionLines =
    myActions.length === 0
      ? "（你尚未行动过）"
      : myActions
          .slice(-10)
          .map((item) => `·[回合${item.round}] ${item.content}`)
          .join("\n");

  const othersLines = room.players
    .filter((other) => other.id !== player.id)
    .map((other) => {
      const actions = memory.playerActions[other.id] ?? [];
      if (actions.length === 0) {
        return `- ${other.name}：尚无行动记录`;
      }

      const recent = actions
        .slice(-6)
        .map((item) => `  ·[回合${item.round}] ${item.content}`)
        .join("\n");

      return `- ${other.name} 做过的事：\n${recent}`;
    })
    .join("\n");

  const moments =
    memory.memorableMoments.length > 0
      ? memory.memorableMoments.slice(-8).join("\n")
      : "（暂无）";

  return [
    "【剧情记忆——你必须连贯记住以下故事，不要前后矛盾】",
    memory.storySummary || "（故事刚开场）",
    "",
    `【你（${player.name}）的过往行动】`,
    myActionLines,
    "",
    "【其他角色做过的事】",
    othersLines,
    "",
    "【值得记住的名场面】",
    moments,
    "",
    "行动时要呼应自己与他人之前的言行；若有人曾怀疑、帮助或挑衅你，要有相应反应。"
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

export function touchChatActivity(room: Room) {
  room.worldState.memory.lastChatAt = new Date().toISOString();
}

/** 距最近一次剧情行动或交流区发言过了多久 */
export function msSinceLastPlayerMessage(room: Room) {
  const memory = room.worldState.memory;
  const stamps = [memory.lastActionAt, memory.lastChatAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime());

  if (stamps.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Date.now() - Math.max(...stamps);
}
