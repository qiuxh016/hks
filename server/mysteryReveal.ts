import { FullMysteryReveal, Room } from "../shared/types";
import { createDeepSeekReply } from "./dm";
import { formatMemoryForPrompt } from "./memory";
import { sanitizePlayerFacingText } from "./textFormat";
import { getRoom, updateRoom } from "./store";

const generationLocks = new Set<string>();

let broadcastRoomState: (roomId: string) => void = () => {};

export function registerMysteryRevealBroadcaster(fn: (roomId: string) => void) {
  broadcastRoomState = fn;
}

function collectOpeningContext(room: Room) {
  const briefMessages = room.messages
    .filter((message) => message.variant === "brief" || message.speaker === "AI主持人")
    .slice(0, 8)
    .map((message) => `${message.speaker}：${message.content}`)
    .join("\n\n");

  const mission = room.worldState.missionBrief;
  const plan = room.worldState.mysteryPlan;

  return [
    mission?.storyDirection ? `故事走向：${mission.storyDirection}` : "",
    mission?.coreTruth ? `核心设定：${mission.coreTruth}` : "",
    plan?.hiddenTruth ? `隐藏真相（主持人用）：${plan.hiddenTruth}` : "",
    plan?.clueChain?.length
      ? `线索链：\n${plan.clueChain.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : "",
    plan?.redHerrings?.length
      ? `红鲱鱼：${plan.redHerrings.join("；")}`
      : "",
    briefMessages ? `开场与任务简报摘录：\n${briefMessages}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function collectClueArchive(room: Room) {
  const clues = room.worldState.investigationClues;
  if (clues.length === 0) {
    return "（本局未登记额外线索）";
  }

  return clues.map((item) => `· ${item.text}${item.source ? `（${item.source}）` : ""}`).join("\n");
}

function buildFallbackReveal(room: Room): string {
  const plan = room.worldState.mysteryPlan;
  const mission = room.worldState.missionBrief;
  const gameEnd = room.worldState.gameEnd;
  const culprit = room.worldState.accusationMeta?.correctLabels[0] ?? "（见下方真相）";
  const hidden = plan?.hiddenTruth ?? mission?.coreTruth ?? gameEnd?.truthRevealed ?? "（未记录）";

  const clueLines =
    plan?.clueChain?.map((line, index) => `${index + 1}. ${line}`).join("\n") ??
    collectClueArchive(room);

  return sanitizePlayerFacingText(
    [
      "## 故事回顾",
      mission?.storyDirection ?? "本局为一宗悬疑案件，玩家从开场简报进入调查。",
      "",
      "## 完整谜底",
      hidden,
      gameEnd?.accusedName
        ? `本局公投指认：${gameEnd.accusedName}。真凶身份：${culprit}。`
        : `真凶/幕后：${culprit}`,
      "",
      "## 作案手法与动机",
      gameEnd?.epilogue ?? "请结合上方真相与你们在局内发现的线索理解完整因果。",
      "",
      "## 线索链复盘",
      clueLines,
      "",
      "## 红鲱鱼说明",
      plan?.redHerrings?.length
        ? plan.redHerrings.map((item) => `· ${item}`).join("\n")
        : "本局未设置明显红鲱鱼，或已在调查中排除。",
      "",
      "## 本局结局",
      gameEnd?.truthRevealed ?? hidden
    ].join("\n")
  );
}

async function generateRevealWithAi(room: Room): Promise<string> {
  const gameEnd = room.worldState.gameEnd;
  const raw = await createDeepSeekReply(
    [
      {
        role: "system",
        content:
          "你是剧本杀复盘主持人。请根据本局开场设定、隐藏真相、线索链与玩家实际推进，写一份「完整故事谜底」供全体玩家阅读。必须前后一致，禁止与开场矛盾；不要 Markdown 加粗或【】；用 ## 标题分节。"
      },
      {
        role: "user",
        content: [
          `剧本：${room.scenarioId}`,
          `对局结果：${gameEnd?.outcome === "success" ? "玩家方胜利/成功结案" : "失败或推理偏差"}`,
          "",
          "【开局与任务设定】",
          collectOpeningContext(room),
          "",
          "【本局已登记线索】",
          collectClueArchive(room),
          "",
          "【剧情与玩家行动摘要】",
          formatMemoryForPrompt(room),
          "",
          gameEnd
            ? [
                "【已公布的结案信息】",
                `真相：${gameEnd.truthRevealed}`,
                `结局叙事：${gameEnd.epilogue}`
              ].join("\n")
            : "",
          "",
          "请输出完整谜底，严格包含以下章节（每节 2-6 段，具体引用本局线索）：",
          "## 故事回顾",
          "## 完整谜底",
          "## 真凶身份",
          "## 作案手法与动机",
          "## 线索链复盘",
          "## 关键转折点",
          "## 红鲱鱼说明",
          "## 本局结局"
        ]
          .filter(Boolean)
          .join("\n")
      }
    ],
    { temperature: 0.45, maxTokens: 1800 }
  );

  const sections = [
    "故事回顾",
    "完整谜底",
    "真凶身份",
    "作案手法与动机",
    "线索链复盘",
    "关键转折点",
    "红鲱鱼说明",
    "本局结局"
  ];

  const hasStructure = sections.some((title) => raw.includes(title));
  if (!hasStructure) {
    return sanitizePlayerFacingText(raw);
  }

  return sanitizePlayerFacingText(raw);
}

function initPendingReveal(room: Room): FullMysteryReveal {
  return {
    gameInstanceId: room.gameInstanceId,
    status: "pending",
    content: ""
  };
}

export async function generateFullMysteryRevealForRoom(roomId: string) {
  const room = getRoom(roomId);
  if (!room || room.status !== "ended") {
    return;
  }

  const lockKey = `${roomId}:${room.gameInstanceId}`;
  if (generationLocks.has(lockKey)) {
    return;
  }

  generationLocks.add(lockKey);

  try {
    let content: string;

    try {
      content = await generateRevealWithAi(room);
    } catch {
      content = buildFallbackReveal(room);
    }

    if (!content.trim()) {
      content = buildFallbackReveal(room);
    }

    updateRoom(roomId, (draft) => {
      if (draft.status !== "ended" || draft.gameInstanceId !== room.gameInstanceId) {
        return;
      }

      draft.worldState.fullMysteryReveal = {
        gameInstanceId: room.gameInstanceId,
        status: "ready",
        content,
        generatedAt: new Date().toISOString()
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成完整谜底失败";
    const content = buildFallbackReveal(room);

    updateRoom(roomId, (draft) => {
      if (draft.gameInstanceId !== room.gameInstanceId) {
        return;
      }

      draft.worldState.fullMysteryReveal = {
        gameInstanceId: room.gameInstanceId,
        status: "ready",
        content,
        generatedAt: new Date().toISOString(),
        errorMessage: message
      };
    });
  } finally {
    generationLocks.delete(lockKey);
    broadcastRoomState(roomId);
  }
}

export function triggerFullMysteryReveal(roomId: string) {
  const room = getRoom(roomId);
  if (!room || room.status !== "ended") {
    return;
  }

  if (
    room.worldState.fullMysteryReveal?.gameInstanceId === room.gameInstanceId &&
    room.worldState.fullMysteryReveal.status === "ready" &&
    room.worldState.fullMysteryReveal.content.trim()
  ) {
    return;
  }

  if (
    !room.worldState.fullMysteryReveal ||
    room.worldState.fullMysteryReveal.gameInstanceId !== room.gameInstanceId
  ) {
    updateRoom(roomId, (draft) => {
      if (draft.status !== "ended") {
        return;
      }

      draft.worldState.fullMysteryReveal = initPendingReveal(draft);
    });
    broadcastRoomState(roomId);
  }

  void generateFullMysteryRevealForRoom(roomId);
}
