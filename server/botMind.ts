import { BotMindState, BotPlayerModel, Player, Room } from "../shared/types";
import { createDeepSeekReply } from "./dm";
import { formatMemoryForBotPrompt } from "./memory";
import { getRoom, updateRoom } from "./store";

function extractSection(raw: string, sectionTitle: string) {
  const pattern = new RegExp(
    `##\\s*${sectionTitle}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s*|\\n###\\s*|$)`,
    "i"
  );
  const match = raw.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function extractSubSection(raw: string, title: string) {
  const pattern = new RegExp(
    `###\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s*|\\n##\\s*|$)`,
    "i"
  );
  const match = raw.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function extractBulletValue(block: string, label: string) {
  const pattern = new RegExp(`[-*]\\s*${label}[：:]\\s*(.+)$`, "im");
  const match = block.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function formatRecentEventsForMind(room: Room) {
  return room.messages
    .filter(
      (message) =>
        message.type === "player" ||
        message.type === "ai" ||
        (message.type === "system" &&
          (message.speaker === "推理线索" || message.speaker === "任务进度"))
    )
    .slice(-22)
    .map((message) => {
      if (message.type === "system") {
        return `[${message.speaker}] ${message.content}`;
      }

      return `${message.speaker}: ${message.content}`;
    })
    .join("\n");
}

function formatCluesForMind(room: Room) {
  const clues = room.worldState.investigationClues.slice(-8);
  if (clues.length === 0) {
    return "（尚无登记线索）";
  }

  return clues.map((item) => `- ${item.text}（来源：${item.source}）`).join("\n");
}

function formatPreviousMind(previous: BotMindState | undefined) {
  if (!previous) {
    return "（首次建档，尚无上一轮内心档案）";
  }

  const others = previous.playerModels
    .map(
      (model) =>
        `·${model.playerName}：观察「${model.observedBehavior}」；猜其意图「${model.suspectedIntent}」；猜其剧情推理「${model.suspectedPlotTheory}」`
    )
    .join("\n");

  return [
    `【上轮·回合${previous.updatedAtRound}】`,
    `剧情判断：${previous.plotTheory}`,
    `自我处境：${previous.selfReflection}`,
    others ? `对他人推测：\n${others}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function parsePlayerModels(
  raw: string,
  room: Room,
  self: Player
): BotPlayerModel[] {
  const block = extractSection(raw, "对他人心智的推测");
  if (!block) {
    return [];
  }

  const others = room.players.filter((player) => player.id !== self.id);

  return others.map((other) => {
    const section = extractSubSection(block, other.name) || extractSubSection(block, other.roleCard?.role ?? "");

    if (!section) {
      return {
        playerId: other.id,
        playerName: other.name,
        observedBehavior: "（暂无明确观察）",
        suspectedIntent: "（尚不清楚）",
        suspectedPlotTheory: "（尚不清楚）"
      };
    }

    return {
      playerId: other.id,
      playerName: other.name,
      observedBehavior:
        extractBulletValue(section, "观察") ||
        extractBulletValue(section, "观察到的行为") ||
        "（暂无）",
      suspectedIntent:
        extractBulletValue(section, "我猜他在想什么") ||
        extractBulletValue(section, "我猜她在想什么") ||
        extractBulletValue(section, "我猜其意图") ||
        extractBulletValue(section, "意图推测") ||
        "（暂无）",
      suspectedPlotTheory:
        extractBulletValue(section, "我猜他对剧情的推理") ||
        extractBulletValue(section, "我猜她对剧情的推理") ||
        extractBulletValue(section, "剧情推理推测") ||
        "（暂无）"
    };
  });
}

function parseBotMindResponse(raw: string, room: Room, player: Player): BotMindState {
  const plotTheory =
    extractSection(raw, "我对剧情的判断") ||
    extractSection(raw, "剧情判断") ||
    "剧情仍在发展中，线索不足。";

  const selfReflection =
    extractSection(raw, "我的处境与打算") ||
    extractSection(raw, "我的处境") ||
    "继续按角色目标行动。";

  return {
    plotTheory,
    selfReflection,
    playerModels: parsePlayerModels(raw, room, player),
    updatedAtRound: room.worldState.round
  };
}

export function formatBotMindForPrompt(room: Room, player: Player) {
  const mind = room.worldState.memory.botMinds?.[player.id];
  if (!mind) {
    return [
      "【Agent 内心档案】",
      "（尚未建立，请结合下方行动记录与最近剧情自行推理。）"
    ].join("\n");
  }

  const othersBlock =
    mind.playerModels.length > 0
      ? mind.playerModels
          .map(
            (model) =>
              [
                `·${model.playerName}：`,
                `  观察：${model.observedBehavior}`,
                `  我猜他在想什么：${model.suspectedIntent}`,
                `  我猜他对剧情的推理：${model.suspectedPlotTheory}`
              ].join("\n")
          )
          .join("\n")
      : "（尚无对他人推测）";

  return [
    "【Agent 内心档案·你的私密推理，行动要体现但不要把档案原文念出来】",
    `（第 ${mind.updatedAtRound} 回合更新）`,
    "",
    "▸ 我对剧情的判断：",
    mind.plotTheory,
    "",
    "▸ 我的处境与打算：",
    mind.selfReflection,
    "",
    "▸ 对他人心智的推测（含「推测别人的推测」）：",
    othersBlock
  ].join("\n");
}

/** 在机器人行动前刷新内心档案：整合剧情、线索、众人行动与二阶推测 */
export async function refreshBotMind(roomId: string, player: Player) {
  const room = getRoom(roomId);
  if (!room || player.kind !== "bot") {
    return;
  }

  const card = player.roleCard;
  if (!card) {
    return;
  }

  const previous = room.worldState.memory.botMinds?.[player.id];
  const others = room.players
    .filter((other) => other.id !== player.id)
    .map((other) => other.name)
    .join("、");

  const raw = await createDeepSeekReply(
    [
      {
        role: "system",
        content: [
          "你是悬疑推理桌游中的 AI 玩家，正在更新自己的「内心档案」。",
          "档案仅你自己可见，要像真人玩家一样持续推理、记仇、记恩、记谎。",
          "",
          "你必须做到：",
          "1. 记住自己做过什么、别人做过什么（见下方行动档案与最近事件）。",
          "2. 根据线索与叙事更新对剧情的判断（可以猜错，符合角色视角即可）。",
          "3. 对每个其他角色做「二阶心智」推测：不仅猜他在想什么，还要猜他对剧情/真相的推理是什么。",
          "4. 结合你的隐藏目标自省，但不要泄露隐藏目标原文。",
          "",
          `你的角色：${card.role}；性格：${card.personality}`,
          `隐藏目标（仅内心参考）：${card.secretGoal}`,
          "",
          "严格按下列 Markdown 标题输出，不要省略：",
          "## 我对剧情的判断",
          "## 我的处境与打算",
          "## 对他人心智的推测",
          "### 其他角色名",
          "- 观察：…",
          "- 我猜他在想什么：…",
          "- 我猜他对剧情的推理：…",
          `（为每位其他玩家各写一节：${others || "无"}）`
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `你是 ${player.name}，请更新内心档案。`,
          "",
          formatPreviousMind(previous),
          "",
          formatMemoryForBotPrompt(room, player),
          "",
          `当前回合：${room.worldState.round}；地点：${room.worldState.currentLocation}`,
          "",
          "【已知推理线索】",
          formatCluesForMind(room),
          "",
          "【最近剧情与众人言行】",
          formatRecentEventsForMind(room) || "（刚开场）",
          "",
          "请输出更新后的内心档案："
        ].join("\n")
      }
    ],
    { maxTokens: 900, temperature: 0.72 }
  );

  const mind = parseBotMindResponse(raw, room, player);

  updateRoom(roomId, (draft) => {
    if (!draft.worldState.memory.botMinds) {
      draft.worldState.memory.botMinds = {};
    }

    draft.worldState.memory.botMinds[player.id] = mind;
  });
}
