import crypto from "node:crypto";
import {
  InteractiveObject,
  Message,
  Player,
  RoleCard,
  Room,
  RoomMode,
  ScenarioId,
  WorldState
} from "../shared/types";

const rooms = new Map<string, Room>();

function createId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(3).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function createWorldState(): WorldState {
  return {
    currentLocation: "准备区",
    round: 0,
    tension: 1,
    quests: [],
    clues: [],
    sceneTitle: "等待开场",
    sceneDescription: "房主开始游戏后，这里会出现第一个可交互场景。",
    interactiveObjects: [],
    npcStates: {},
    playerRelationships: {}
  };
}

function createMessage(message: Omit<Message, "id" | "createdAt">): Message {
  return {
    id: createId("msg"),
    createdAt: now(),
    ...message
  };
}

export function getRoom(roomId: string) {
  return rooms.get(roomId);
}

export function createRoom(hostName: string, scenarioId: ScenarioId, mode: RoomMode) {
  const roomId = createId("room");
  const hostPlayerId = createId("player");
  const host: Player = {
    id: hostPlayerId,
    name: hostName,
    isHost: true,
    ready: true
  };

  const title = mode === "single" ? "单人" : "多人";
  const room: Room = {
    id: roomId,
    scenarioId,
    status: "lobby",
    mode,
    hostPlayerId,
    players: [host],
    messages: [
      createMessage({
        type: "system",
        speaker: "系统",
        content: mode === "single"
          ? `${hostName} 开启了单人冒险。`
          : `${hostName} 创建了房间，等待更多玩家加入。`
      })
    ],
    worldState: createWorldState(),
    createdAt: now()
  };

  rooms.set(roomId, room);
  return { room, playerId: hostPlayerId };
}

export function joinRoom(roomId: string, playerName: string) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  if (room.mode === "single") {
    throw new Error("单人房间不支持加入");
  }

  if (room.status !== "lobby") {
    throw new Error("游戏已经开始，暂时不能加入");
  }

  const playerId = createId("player");
  const player: Player = {
    id: playerId,
    name: playerName,
    isHost: false,
    ready: false
  };

  room.players.push(player);
  room.messages.push(
    createMessage({
      type: "system",
      speaker: "系统",
      content: `${playerName} 加入了房间。`
    })
  );

  return { room, playerId };
}

export function appendMessages(roomId: string, messages: Array<Omit<Message, "id" | "createdAt">>) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  room.messages.push(...messages.map(createMessage));
  return room;
}

export function assignRoleCards(roomId: string, roleCards: RoleCard[]) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  room.players = room.players.map((player, index) => ({
    ...player,
    roleCard: roleCards[index]
  }));

  return room;
}

export function replaceSceneObjects(roomId: string, interactiveObjects: InteractiveObject[]) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  room.worldState.interactiveObjects = interactiveObjects;

  return room;
}

export function toggleReady(roomId: string, playerId: string) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  if (room.status !== "lobby") {
    throw new Error("游戏已经开始");
  }

  const player = room.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error("玩家不存在");
  }

  player.ready = !player.ready;

  room.messages.push(
    createMessage({
      type: "system",
      speaker: "系统",
      content: player.ready
        ? `${player.name} 已准备。`
        : `${player.name} 取消了准备。`
    })
  );

  return room;
}

export function updateRoom(roomId: string, updater: (room: Room) => void) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  updater(room);
  return room;
}

// turn lock: prevent concurrent turn processing per room
const turnLocks = new Set<string>();

export function lockTurn(roomId: string): boolean {
  if (turnLocks.has(roomId)) return false;
  turnLocks.add(roomId);
  return true;
}

export function unlockTurn(roomId: string) {
  turnLocks.delete(roomId);
}
