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

export function clearGameplaySessionCache() {
  const keysToRemove: string[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("dnd_accusation_") || key?.startsWith("dnd_gameplay_")) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }

  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith("dnd_accusation_")) {
      sessionStorage.removeItem(key);
    }
  }
}

export function saveActiveGameplaySession(roomId: string, gameInstanceId: string) {
  if (!gameInstanceId) {
    return;
  }

  sessionStorage.setItem(
    "dnd_gameplay_active",
    JSON.stringify({ roomId, gameInstanceId })
  );
}

export function loadActiveGameplaySession() {
  try {
    const raw = sessionStorage.getItem("dnd_gameplay_active");
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as { roomId: string; gameInstanceId: string };
  } catch {
    return null;
  }
}

export function clearActiveGameplaySession() {
  sessionStorage.removeItem("dnd_gameplay_active");
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
