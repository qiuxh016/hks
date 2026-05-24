import {
  Player,
  PlayerAgentAssistResponse,
  PlayerAgentMemory,
  Room
} from "../shared/types";
import { createDeepSeekReply } from "./dm";
import { formatMemoryForBotPrompt } from "./memory";
import { sanitizePlayerFacingText } from "./textFormat";
import { getRoom, updateRoom } from "./store";

function extractSection(raw: string, sectionTitle: string) {
  const pattern = new RegExp(
    `##\\s*${sectionTitle}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s*|$)`,
    "i"
  );
  const match = raw.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function formatRecentEvents(room: Room) {
  return room.messages
    .filter(
      (message) =>
        message.type === "player" ||
        message.type === "ai" ||
        (message.type === "system" &&
          (message.speaker === "推理线索" || message.speaker === "任务进度"))
    )
    .slice(-28)
    .map((message) => {
      if (message.type === "system") {
        return `[${message.speaker}] ${message.content}`;
      }

      return `${message.speaker}: ${message.content}`;
    })
    .join("\n");
}

function formatClues(room: Room) {
  const clues = room.worldState.investigationClues.slice(-10);
  if (clues.length === 0) {
    return "（尚无登记线索）";
  }

  return clues.map((item) => `- ${item.text}`).join("\n");
}

function formatObjectives(room: Room) {
  return room.worldState.objectives
    .filter((item) => item.status !== "completed")
    .map((item) => `- [${item.scope}] ${item.text}`)
    .join("\n");
}

function formatPreviousAgentMemory(previous: PlayerAgentMemory | undefined) {
  if (!previous) {
    return "（首次为本玩家服务，尚无上一轮 Agent 档案）";
  }

  return [
    `【上轮·回合 ${previous.updatedAtRound}】`,
    `剧情判断：${previous.plotTheory}`,
    `对他人怀疑：${previous.suspicionOfOthers}`,
    `自身处境：${previous.selfSituation}`,
    `上次分析摘要：${previous.lastAnalysis.slice(0, 200)}${previous.lastAnalysis.length > 200 ? "…" : ""}`
  ].join("\n");
}

function parseAgentMemoryUpdate(raw: string, room: Room, previous?: PlayerAgentMemory): PlayerAgentMemory {
  const plotTheory =
    extractSection(raw, "Agent记忆·剧情判断") ||
    extractSection(raw, "剧情判断") ||
    previous?.plotTheory ||
    "";

  const suspicionOfOthers =
    extractSection(raw, "Agent记忆·对他人推测") ||
    extractSection(raw, "对他人推测") ||
    previous?.suspicionOfOthers ||
    "";

  const selfSituation =
    extractSection(raw, "Agent记忆·自身处境") ||
    extractSection(raw, "自身处境") ||
    previous?.selfSituation ||
    "";

  const lastAnalysis =
    extractSection(raw, "推理分析") || previous?.lastAnalysis || "";
  const lastSuggestedAction = (
    extractSection(raw, "建议行动") ||
    previous?.lastSuggestedAction ||
    ""
  ).replace(/^["「]|["」]$/g, "").trim();

  return {
    plotTheory,
    suspicionOfOthers,
    selfSituation,
    lastAnalysis,
    lastSuggestedAction,
    exchangeCount: (previous?.exchangeCount ?? 0) + 1,
    updatedAtRound: room.worldState.round
  };
}

function buildMemoryDigest(room: Room, player: Player, agentMemory: PlayerAgentMemory) {
  const myCount = room.worldState.memory.playerActions[player.id]?.length ?? 0;
  const totalActions = Object.values(room.worldState.memory.playerActions).reduce(
    (sum, list) => sum + list.length,
    0
  );

  return [
    `已记录本局 ${totalActions} 条玩家操作（含你 ${myCount} 条）`,
    `剧情摘要 ${room.worldState.memory.storySummary ? "已同步" : "待积累"}`,
    `线索 ${room.worldState.investigationClues.length} 条`,
    `Agent 档案已更新至第 ${agentMemory.updatedAtRound} 回合（第 ${agentMemory.exchangeCount} 次辅助）`
  ].join("；");
}

export async function generatePlayerAgentAssist(
  roomId: string,
  playerId: string,
  options: { draftAction?: string; question?: string }
): Promise<PlayerAgentAssistResponse> {
  const room = getRoom(roomId);
  if (!room) {
    throw new Error("房间不存在");
  }

  if (room.status !== "in_progress") {
    throw new Error("游戏进行中才可使用 Agent 辅助");
  }

  const player = room.players.find((item) => item.id === playerId);
  if (!player || player.kind !== "human") {
    throw new Error("仅真人玩家可使用推理 Agent");
  }

  const card = player.roleCard;
  if (!card) {
    throw new Error("请先选择角色并开始游戏");
  }

  const previous = room.worldState.memory.playerAgents?.[playerId];
  const others = room.players
    .filter((other) => other.id !== playerId)
    .map((other) => other.name)
    .join("、");

  const raw = await createDeepSeekReply(
    [
      {
        role: "system",
        content: [
          "你是悬疑推理桌游中**某位真人玩家的私密推理 Agent**，仅对该玩家可见。",
          "你必须记住本局所有已发生的玩家操作、主持人叙事与推理线索，并在分析时引用具体事实。",
          "你可以推测其他玩家在猜什么（二阶推理），但不要替玩家直接泄露其角色卡的隐藏目标原文。",
          "分析要务实：线索串联、矛盾点、谁可疑、下一步调查方向。",
          "建议行动须符合该玩家角色人设，20-60 字，第一人称，可直接填入行动框。",
          "",
          `玩家角色：${card.role}；性格：${card.personality}`,
          `（隐藏目标仅供你内部权衡，勿在「推理分析」里原文复述）`,
          "",
          "严格按下列 Markdown 标题输出，不要省略：",
          "## 推理分析",
          "## 线索要点",
          "## 建议行动",
          "## Agent记忆·剧情判断",
          "## Agent记忆·对他人推测",
          "## Agent记忆·自身处境"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `玩家 ${player.name} 请求推理辅助。`,
          options.question ? `玩家追问：${options.question}` : "",
          options.draftAction
            ? `玩家当前草稿行动：${options.draftAction}`
            : "玩家尚未写好行动草稿。",
          "",
          formatPreviousAgentMemory(previous),
          "",
          formatMemoryForBotPrompt(room, player),
          "",
          `当前回合：${room.worldState.round}；地点：${room.worldState.currentLocation}`,
          `其他在场角色：${others || "无"}`,
          "",
          "【未完成任务】",
          formatObjectives(room) || "（无）",
          "",
          "【推理线索】",
          formatClues(room),
          "",
          "【本局全部近期事件（含所有人操作）】",
          formatRecentEvents(room) || "（刚开场）",
          "",
          "请输出推理辅助（含更新后的 Agent 记忆三节）："
        ]
          .filter(Boolean)
          .join("\n")
      }
    ],
    { maxTokens: 1100, temperature: 0.68 }
  );

  const agentMemory = parseAgentMemoryUpdate(raw, room, previous);

  updateRoom(roomId, (draft) => {
    if (!draft.worldState.memory.playerAgents) {
      draft.worldState.memory.playerAgents = {};
    }

    draft.worldState.memory.playerAgents[playerId] = agentMemory;
  });

  const analysis = agentMemory.lastAnalysis || extractSection(raw, "推理分析");
  const suggestedAction =
    agentMemory.lastSuggestedAction || extractSection(raw, "建议行动");
  const cluesHighlight = extractSection(raw, "线索要点");

  return {
    analysis: sanitizePlayerFacingText(analysis || raw.trim()),
    suggestedAction: sanitizePlayerFacingText(
      suggestedAction.replace(/^["「]|["」]$/g, "").trim()
    ),
    cluesHighlight: sanitizePlayerFacingText(cluesHighlight || "（暂无单独线索摘要）"),
    memoryDigest: buildMemoryDigest(room, player, agentMemory)
  };
}
