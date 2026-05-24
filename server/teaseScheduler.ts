import { AI_HOST_TEASE_SPEAKER } from "../shared/types";
import { generateTease } from "./dm";
import { countPlayerActions, msSince, msSinceLastPlayerMessage } from "./memory";
import { appendMessages, getRoom, listInProgressRooms, updateRoom } from "./store";

const TICK_MS = 30_000;
/** 最近有人发言（剧情行动或交流区）时，调侃间隔 */
const TEASE_INTERVAL_ACTIVE_MS = 2 * 60 * 1000;
/** 无人发言时的调侃间隔 */
const TEASE_INTERVAL_IDLE_MS = 5 * 60 * 1000;
/** 判定「有人发消息」：此时间窗内有行动或聊天 */
const ACTIVE_MESSAGE_WINDOW_MS = 2 * 60 * 1000;

const teasingRooms = new Set<string>();

export function startTeaseScheduler() {
  setInterval(() => {
    void runTeaseTick();
  }, TICK_MS);

  console.log(
    `AI主持人 调侃定时器已启动（有人发言每 ${TEASE_INTERVAL_ACTIVE_MS / 60_000} 分钟，无人发言每 ${TEASE_INTERVAL_IDLE_MS / 60_000} 分钟）`
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

function teaseIntervalForRoom(room: ReturnType<typeof listInProgressRooms>[number]) {
  const recentlyActive = msSinceLastPlayerMessage(room) <= ACTIVE_MESSAGE_WINDOW_MS;
  return recentlyActive ? TEASE_INTERVAL_ACTIVE_MS : TEASE_INTERVAL_IDLE_MS;
}

function shouldTeaseRoom(room: ReturnType<typeof listInProgressRooms>[number]) {
  const memory = room.worldState.memory;

  const hasStoryPlay = countPlayerActions(room) >= 1;
  const hasChat = Boolean(memory.lastChatAt);
  if (!hasStoryPlay && !hasChat) {
    return false;
  }

  const interval = teaseIntervalForRoom(room);
  if (msSince(memory.lastTeaseAt) < interval) {
    return false;
  }

  return true;
}
