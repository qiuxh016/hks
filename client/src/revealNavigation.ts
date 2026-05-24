import { FullMysteryReveal, Room } from "../../shared/types";

export function mysteryRevealMatchesCurrentRun(room: Room): boolean {
  const reveal = room.worldState.fullMysteryReveal;
  if (!reveal?.gameInstanceId) {
    return true;
  }
  return reveal.gameInstanceId === room.gameInstanceId;
}

export function isMysteryRevealGenerating(room: Room | null) {
  if (!room || room.status !== "ended") {
    return false;
  }

  const reveal = room.worldState.fullMysteryReveal;
  if (!reveal || !mysteryRevealMatchesCurrentRun(room)) {
    return true;
  }

  return reveal.status === "pending";
}

export function resolveActiveMysteryReveal(room: Room | null): FullMysteryReveal | null {
  if (!room || room.status !== "ended") {
    return null;
  }

  const reveal = room.worldState.fullMysteryReveal;
  if (reveal && mysteryRevealMatchesCurrentRun(room)) {
    return reveal;
  }

  return {
    gameInstanceId: room.gameInstanceId,
    status: "pending",
    content: ""
  };
}

/** 对局结束后可查看完整谜底（会异步生成） */
export function canOpenFullMysteryReveal(room: Room | null) {
  return Boolean(room?.status === "ended");
}

export function parseRevealSections(content: string) {
  const chunks = content.split(/(?=##\s+)/).filter((part) => part.trim());
  if (chunks.length <= 1 && !content.includes("##")) {
    return [{ title: "完整故事谜底", body: content.trim() }];
  }

  return chunks.map((chunk) => {
    const match = chunk.match(/^##\s*(.+?)\s*\n+([\s\S]*)$/);
    if (!match) {
      return { title: "说明", body: chunk.trim() };
    }
    return { title: match[1].trim(), body: match[2].trim() };
  });
}
