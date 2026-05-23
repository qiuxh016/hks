import { AI_HOST_TEASE_SPEAKER } from "../shared/types";
import { generateTease } from "./dm";
import { appendMessages, getRoom, listInProgressRooms, updateRoom } from "./store";
import { countPlayerActions, msSince } from "./memory";

const TICK_MS = 30_000;
const TEASE_COOLDOWN_MS = 90_000;
const IDLE_BEFORE_TEASE_MS = 50_000;

const teasingRooms = new Set<string>();

export function startTeaseScheduler() {
  setInterval(() => {
    void runTeaseTick();
  }, TICK_MS);

  console.log(
    `AI主持人 调侃定时器已启动（每 ${TICK_MS / 1000}s 检查，冷却 ${TEASE_COOLDOWN_MS / 1000}s）`
  );
}

async function runTeaseTick() {
  for (const room of listInProgressRooms()) {
    if (!shouldTeaseRoom(room)) {
      continue;
    }

    if (teasingRooms.has(room.id)) {
      continue;
    }

    teasingRooms.add(room.id);

    try {
      const latest = getRoom(room.id);
      if (!latest || latest.status !== "in_progress") {
        continue;
      }

      const tease = await generateTease(latest);

      updateRoom(room.id, (draft) => {
        draft.worldState.memory.lastTeaseAt = new Date().toISOString();
      });

      appendMessages(room.id, [
        {
          type: "ai",
          speaker: AI_HOST_TEASE_SPEAKER,
          content: tease,
          variant: "tease"
        }
      ]);
    } catch (error) {
      console.error(`[tease] room ${room.id}:`, error instanceof Error ? error.message : error);
    } finally {
      teasingRooms.delete(room.id);
    }
  }
}

function shouldTeaseRoom(room: ReturnType<typeof listInProgressRooms>[number]) {
  const memory = room.worldState.memory;

  if (countPlayerActions(room) < 1) {
    return false;
  }

  if (msSince(memory.lastTeaseAt) < TEASE_COOLDOWN_MS) {
    return false;
  }

  const idleLongEnough = msSince(memory.lastActionAt) >= IDLE_BEFORE_TEASE_MS;
  const everyFewRounds = room.worldState.round > 0 && room.worldState.round % 3 === 0;

  return idleLongEnough || everyFewRounds;
}
