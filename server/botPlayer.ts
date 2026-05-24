import { Player, Room } from "../shared/types";
import { formatBotMindForPrompt } from "./botMind";
import { createDeepSeekReply } from "./dm";
import { formatMemoryForBotPrompt } from "./memory";
import { sanitizePlayerFacingText } from "./textFormat";

function formatRecentStoryForBot(room: Room) {
  return room.messages
    .filter(
      (message) =>
        message.type === "player" ||
        message.type === "ai" ||
        (message.type === "system" && message.speaker === "推理线索")
    )
    .slice(-16)
    .map((message) => {
      if (message.type === "system") {
        return `[线索] ${message.content}`;
      }

      return `${message.speaker}: ${message.content}`;
    })
    .join("\n");
}

function formatBotWorldContext(room: Room) {
  const objectives = room.worldState.objectives
    .filter((item) => item.scope === "session" && item.status !== "completed")
    .map((item) => `- ${item.text}`)
    .join("\n");

  const clues = room.worldState.investigationClues
    .slice(-6)
    .map((item) => `- ${item.text}`)
    .join("\n");

  return [
    `当前回合：${room.worldState.round}`,
    `当前地点：${room.worldState.currentLocation}`,
    objectives ? `当前任务：\n${objectives}` : "",
    clues ? `已知线索：\n${clues}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateBotAction(room: Room, player: Player) {
  const card = player.roleCard;

  if (!card) {
    throw new Error("AI 机器人尚未分配角色");
  }

  const recentStory = formatRecentStoryForBot(room);
  const mindBlock = formatBotMindForPrompt(room, player);
  const memoryBlock = formatMemoryForBotPrompt(room, player);

  const action = await createDeepSeekReply(
    [
      {
        role: "system",
        content: [
          "你是桌游中的 AI 玩家 Agent：你有持续的内心档案、行动记忆与对他人的心智推测。",
          "行动前先在内心对照：剧情判断、他人可能在猜什么、自己之前做过什么。",
          "",
          `角色：${card.role}`,
          `性格：${card.personality}`,
          `背景：${card.backstory}`,
          `隐藏目标：${card.secretGoal}`,
          "",
          formatBotWorldContext(room),
          "",
          mindBlock,
          "",
          memoryBlock,
          "",
          "规则：",
          "1. 以第一人称输出一个具体行动，20-60 字。",
          "2. 行动要符合性格与隐藏目标；可试探、误导、追问、搜查、对峙。",
          "3. 若你内心档案里怀疑某人在隐瞒或撒谎，行动里要有对应试探或反驳。",
          "4. 若他人先前帮助/挑衅/怀疑过你，要有连贯回应，禁止失忆式开场。",
          "5. 可基于你对剧情的错误判断行动（真人也会猜错），但要像真人在推理。",
          "6. 只输出行动句子，不要解释内心过程，不要加引号。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `你是 ${player.name}，现在轮到你行动。`,
          "最近剧情与主持人叙事：",
          recentStory || "（刚开场）",
          "",
          "结合你的内心档案与记忆，给出本回合行动："
        ].join("\n")
      }
    ],
    { maxTokens: 120, temperature: 0.88 }
  );

  return sanitizePlayerFacingText(action.replace(/^["「]|["」]$/g, "").trim());
}
