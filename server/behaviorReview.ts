import {
  GameBehaviorReviews,
  HumanBehaviorReview,
  Player,
  Room
} from "../shared/types";
import { createDeepSeekReply } from "./dm";
import { sanitizePlayerFacingText } from "./textFormat";
import { getRoom, updateRoom } from "./store";

const generationLocks = new Set<string>();

let broadcastRoomState: (roomId: string) => void = () => {};

export function registerBehaviorReviewBroadcaster(fn: (roomId: string) => void) {
  broadcastRoomState = fn;
}

function extractSection(raw: string, sectionTitle: string) {
  const pattern = new RegExp(
    `##\\s*${sectionTitle}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s*|$)`,
    "i"
  );
  const match = raw.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function parseTags(raw: string) {
  const line = raw.replace(/^标签[：:]\s*/u, "").trim();
  if (!line) {
    return [];
  }

  return line
    .split(/[,，、|/]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 12)
    .slice(0, 4);
}

function formatHumanActionArchive(room: Room, player: Player) {
  const actions = room.worldState.memory.playerActions[player.id] ?? [];
  if (actions.length === 0) {
    return "（本局几乎无行动记录）";
  }

  return actions
    .slice(-12)
    .map((item) => `·[回合${item.round}] ${item.content}`)
    .join("\n");
}

function buildFallbackReview(room: Room, player: Player): HumanBehaviorReview {
  const actions = room.worldState.memory.playerActions[player.id] ?? [];
  const gameEnd = room.worldState.gameEnd;
  const outcomeHint =
    gameEnd?.outcome === "success" ? "本局整体胜利收官。" : "本局未能全员达成胜利条件。";

  return {
    playerId: player.id,
    playerName: player.name,
    role: player.roleCard?.role,
    highlights:
      actions.length >= 3
        ? `共 ${actions.length} 次有效行动，持续推动调查与讨论。`
        : actions.length > 0
          ? "有参与关键调查，可进一步加深推理表达。"
          : "本局出镜较少，下次可多主动搜查与发言。",
    improvements:
      actions.length > 0
        ? "建议在结案前用 2～3 句话串联线索，向全员公开动机与手法。"
        : "建议多利用场景互动与线索链，避免只观望不行动。",
    summary: `${player.name} 完成了本局扮演。${outcomeHint}`,
    tags: actions.length >= 3 ? ["积极参与", "调查推进"] : ["本局参与者"],
    generatedAt: new Date().toISOString()
  };
}

function parsePlayerReviewBlock(
  block: string,
  humans: Player[],
  room: Room
): HumanBehaviorReview | null {
  const idLine = block.match(/playerId[：:]\s*(\S+)/i)?.[1]?.trim();
  const nameLine = block.match(/玩家[：:]\s*(.+)/)?.[1]?.trim();

  const player =
    humans.find((item) => item.id === idLine) ??
    humans.find((item) => item.name === nameLine) ??
    null;

  if (!player) {
    return null;
  }

  const highlights =
    extractSection(block, "亮点") ||
    extractSection(block, "亮点表现") ||
    "有参与本局推理与互动。";
  const improvements =
    extractSection(block, "可改进") ||
    extractSection(block, "可改进之处") ||
    "可更完整地公开推理链条。";
  const summary = extractSection(block, "综合评价") || extractSection(block, "评价") || highlights;
  const tags = parseTags(extractSection(block, "标签") || "");

  return {
    playerId: player.id,
    playerName: player.name,
    role: player.roleCard?.role,
    highlights: sanitizePlayerFacingText(highlights),
    improvements: sanitizePlayerFacingText(improvements),
    summary: sanitizePlayerFacingText(summary),
    tags: tags.length > 0 ? tags : ["本局参与者"],
    generatedAt: new Date().toISOString()
  };
}

function parseAllReviews(raw: string, room: Room): HumanBehaviorReview[] {
  const humans = room.players.filter((item) => item.kind === "human");
  const blocks = raw.split(/(?=###\s*玩家点评)/i).filter((item) => /玩家点评/i.test(item));

  const parsed = blocks
    .map((block) => parsePlayerReviewBlock(block, humans, room))
    .filter((item): item is HumanBehaviorReview => Boolean(item));

  const byId = new Map(parsed.map((item) => [item.playerId, item]));

  return humans.map((player) => byId.get(player.id) ?? buildFallbackReview(room, player));
}

async function generateSingleReviewWithAi(room: Room, player: Player): Promise<HumanBehaviorReview> {
  const gameEnd = room.worldState.gameEnd;
  const raw = await createDeepSeekReply(
    [
      {
        role: "system",
        content:
          "你是剧本杀复盘主持人。根据该玩家本局真实行动写简短行为点评。禁止捏造未发生的事。简体中文，不要 Markdown 或【】。"
      },
      {
        role: "user",
        content: [
          `playerId: ${player.id}`,
          `玩家：${player.name}`,
          `角色：${player.roleCard?.role ?? "未知"}`,
          `对局：${gameEnd?.outcome === "success" ? "胜利" : "失败/中途结案"}`,
          "",
          "【本玩家行动】",
          formatHumanActionArchive(room, player),
          "",
          "严格按格式输出：",
          `### 玩家点评：${player.name}`,
          `playerId: ${player.id}`,
          "## 亮点",
          "## 可改进",
          "## 综合评价",
          "## 标签",
          "标签1, 标签2"
        ].join("\n")
      }
    ],
    { temperature: 0.5, maxTokens: 480 }
  );

  const parsed = parsePlayerReviewBlock(raw, [player], room);
  return parsed ?? buildFallbackReview(room, player);
}

async function generateReviewsWithAi(room: Room): Promise<HumanBehaviorReview[]> {
  const humans = room.players.filter((item) => item.kind === "human");
  if (humans.length === 0) {
    return [];
  }

  const results = await Promise.all(
    humans.map(async (player) => {
      try {
        return await generateSingleReviewWithAi(room, player);
      } catch {
        return buildFallbackReview(room, player);
      }
    })
  );

  return results;
}

function initPendingReviews(room: Room): GameBehaviorReviews {
  return {
    gameInstanceId: room.gameInstanceId,
    status: "pending",
    reviews: []
  };
}

export async function generateBehaviorReviewsForRoom(roomId: string) {
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
    let reviews: HumanBehaviorReview[];

    try {
      reviews = await generateReviewsWithAi(room);
    } catch {
      reviews = room.players
        .filter((item) => item.kind === "human")
        .map((player) => buildFallbackReview(room, player));
    }

    updateRoom(roomId, (draft) => {
      if (draft.status !== "ended" || draft.gameInstanceId !== room.gameInstanceId) {
        return;
      }

      draft.worldState.behaviorReviews = {
        gameInstanceId: room.gameInstanceId,
        status: "ready",
        reviews,
        generatedAt: new Date().toISOString()
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成点评失败";
    const fallback = room.players
      .filter((item) => item.kind === "human")
      .map((player) => buildFallbackReview(room, player));

    updateRoom(roomId, (draft) => {
      if (draft.gameInstanceId !== room.gameInstanceId) {
        return;
      }

      draft.worldState.behaviorReviews = {
        gameInstanceId: room.gameInstanceId,
        status: fallback.length > 0 ? "ready" : "failed",
        reviews: fallback,
        generatedAt: new Date().toISOString(),
        errorMessage: message
      };
    });
  } finally {
    generationLocks.delete(lockKey);
    broadcastRoomState(roomId);
  }
}

export function triggerBehaviorReviews(roomId: string) {
  const room = getRoom(roomId);
  if (!room || room.status !== "ended") {
    return;
  }

  if (
    room.worldState.behaviorReviews?.gameInstanceId === room.gameInstanceId &&
    room.worldState.behaviorReviews.status === "ready"
  ) {
    return;
  }

  if (
    !room.worldState.behaviorReviews ||
    room.worldState.behaviorReviews.gameInstanceId !== room.gameInstanceId
  ) {
    updateRoom(roomId, (draft) => {
      if (draft.status !== "ended") {
        return;
      }

      draft.worldState.behaviorReviews = initPendingReviews(draft);
    });
    broadcastRoomState(roomId);
  }

  void generateBehaviorReviewsForRoom(roomId);
}
