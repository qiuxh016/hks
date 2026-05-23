import { Player, Room } from "../shared/types";
import { createDeepSeekReply } from "./dm";
import { formatMemoryForPrompt } from "./memory";

export async function generateBotAction(room: Room, player: Player) {
  const card = player.roleCard;

  if (!card) {
    throw new Error("AI 机器人尚未分配角色");
  }

  const recentStory = room.messages
    .filter((message) => message.type === "player" || message.type === "ai")
    .slice(-8)
    .map((message) => `${message.speaker}: ${message.content}`)
    .join("\n");

  const action = await createDeepSeekReply([
    {
      role: "system",
      content: [
        "你是桌游中的 AI 玩家，需要根据角色人设自主决定行动。",
        `角色：${card.role}`,
        `性格：${card.personality}`,
        `背景：${card.backstory}`,
        `隐藏目标：${card.secretGoal}`,
        formatMemoryForPrompt(room),
        "",
        "规则：",
        "1. 以第一人称输出一个具体行动，20-60 字。",
        "2. 行动要符合性格与隐藏目标，可以阴险、搞笑或冲动。",
        "3. 只输出行动句子，不要解释，不要加引号。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `你是 ${player.name}，现在轮到你行动。`,
        "最近剧情：",
        recentStory || "（刚开场）",
        "",
        "请给出你的行动："
      ].join("\n")
    }
  ]);

  return action.replace(/^["「]|["」]$/g, "").trim();
}
