import { Room } from "../../shared/types";

const STORAGE_KEY = "ai-dungeon-session";

export interface PlayerSession {
  roomId: string;
  playerId: string;
  playerName: string;
}

export function savePlayerSession(session: PlayerSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadPlayerSession(): PlayerSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as PlayerSession;
  } catch {
    return null;
  }
}

export function clearPlayerSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function resolvePlayerId(room: Room, preferredId: string, preferredName: string) {
  if (preferredId && room.players.some((player) => player.id === preferredId)) {
    return preferredId;
  }

  const session = loadPlayerSession();
  if (session?.roomId === room.id && session.playerId) {
    if (room.players.some((player) => player.id === session.playerId)) {
      return session.playerId;
    }
  }

  const name = session?.playerName || preferredName;
  const byName = room.players.find((player) => player.kind === "human" && player.name === name);
  return byName?.id ?? preferredId;
}
