import crypto from "node:crypto";
import {
  InteractiveObject,
  Message,
  Player,
  RoleCard,
  Room,
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

export function createRoom(hostName: string, scenarioId: ScenarioId) {
  const roomId = createId("room");
  const hostPlayerId = createId("player");
  const host: Player = {
    id: hostPlayerId,
    name: hostName,
    isHost: true
  };

  const room: Room = {
    id: roomId,
    scenarioId,
    status: "lobby",
    hostPlayerId,
    players: [host],
    messages: [
      createMessage({
        type: "system",
        speaker: "系统",
        content: `${hostName} 创建了房间，等待更多玩家加入。`
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

  if (room.status !== "lobby") {
    throw new Error("游戏已经开始，暂时不能加入");
  }

  const playerId = createId("player");
  const player: Player = {
    id: playerId,
    name: playerName,
    isHost: false
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

export function updateRoom(roomId: string, updater: (room: Room) => void) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  updater(room);
  return room;
}
