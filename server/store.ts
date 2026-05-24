import crypto from "node:crypto";
import {
  InteractiveObject,
  MAX_ROOM_PLAYERS,
  Message,
  MIN_ROOM_PLAYERS,
  Player,
  PlayerKind,
  GameEndReport,
  RoleCard,
  Room,
  ScenarioId,
  WorldState,
  formatBotName
} from "../shared/types";
import {
  finalizeGameRoles,
  selectPlayerRole as applyRoleSelection,
  syncLobbyBots,
  syncRoleSlots
} from "./roles";

const rooms = new Map<string, Room>();

function createId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(3).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function createMemory(): WorldState["memory"] {
  return {
    storySummary: "",
    playerActions: {},
    memorableMoments: [],
    lastTeaseAt: null,
    lastActionAt: null,
    lastChatAt: null,
    botMinds: {},
    playerAgents: {}
  };
}

function createWorldState(): WorldState {
  return {
    currentLocation: "准备区",
    round: 0,
    tension: 1,
    quests: [],
    objectives: [],
    clues: [],
    investigationClues: [],
    sceneTitle: "等待开场",
    sceneDescription: "房主开始游戏后，这里会出现第一个可交互场景。",
    interactiveObjects: [],
    npcStates: {},
    playerRelationships: {},
    memory: createMemory()
  };
}

function createMessage(message: Omit<Message, "id" | "createdAt">): Message {
  return {
    id: createId("msg"),
    createdAt: now(),
    ...message
  };
}

function clampMaxPlayers(value: number) {
  return Math.min(MAX_ROOM_PLAYERS, Math.max(MIN_ROOM_PLAYERS, Math.floor(value)));
}

function ensurePlayer(player: Player): Player {
  if (player.kind === "bot") {
    player.ready = player.ready ?? true;
    return player;
  }

  if (!player.kind) {
    player.kind = "human";
  }

  player.ready = player.ready ?? (player.isHost ? true : false);
  return player;
}

export function dedupeHumanPlayers(room: Room) {
  const seenNames = new Set<string>();

  room.players = room.players.filter((player) => {
    if (player.kind === "bot") {
      return true;
    }

    const key = player.name.trim().toLowerCase();
    if (seenNames.has(key)) {
      return false;
    }

    seenNames.add(key);
    return true;
  });
}

export function findHumanByName(room: Room, playerName: string) {
  const key = playerName.trim().toLowerCase();
  return room.players.find(
    (player) => player.kind === "human" && player.name.trim().toLowerCase() === key
  );
}

function ensureRoomShape(room: Room) {
  ensureRoomMemory(room);
  if (!room.gameInstanceId) {
    room.gameInstanceId = "";
  }
  room.players = room.players.map(ensurePlayer);

  if (room.status === "lobby") {
    dedupeHumanPlayers(room);
  }
  room.maxPlayers = clampMaxPlayers(room.maxPlayers || room.players.length || MIN_ROOM_PLAYERS);
  if (!room.humanTurnOrder?.length) {
    room.humanTurnOrder = room.players.filter((player) => player.kind === "human").map((player) => player.id);
  }

  if (!room.botTurnOrder?.length) {
    room.botTurnOrder = room.players.filter((player) => player.kind === "bot").map((player) => player.id);
  }

  room.turnPhase = room.turnPhase ?? "human";

  if (room.turnPhase === "human" && room.humanTurnOrder.length > 0) {
    room.currentTurnIndex = Math.min(room.currentTurnIndex ?? 0, room.humanTurnOrder.length - 1);
  } else if (room.turnPhase === "bot" && room.botTurnOrder.length > 0) {
    room.currentTurnIndex = Math.min(room.currentTurnIndex ?? 0, room.botTurnOrder.length - 1);
  } else {
    room.currentTurnIndex = 0;
  }
  room.isProcessingTurn = room.isProcessingTurn ?? false;
  if (!room.mode) {
    room.mode = "multi";
  }
  if (!room.roleSlots?.length) {
    syncRoleSlots(room);
  } else if (room.roleSlots.length !== room.maxPlayers) {
    syncRoleSlots(room);
  }
  return room;
}

function ensureRoomMemory(room: Room) {
  if (!room.worldState.memory) {
    room.worldState.memory = createMemory();
  }

  if (!room.worldState.memory.botMinds) {
    room.worldState.memory.botMinds = {};
  }

  if (!room.worldState.memory.playerAgents) {
    room.worldState.memory.playerAgents = {};
  }

  if (room.worldState.memory.lastChatAt === undefined) {
    room.worldState.memory.lastChatAt = null;
  }

  if (!room.worldState.objectives) {
    room.worldState.objectives = (room.worldState.quests ?? []).map((text, index) => ({
      id: `session-${index + 1}`,
      scope: "session" as const,
      text,
      status: "pending" as const
    }));
  }

  if (!room.worldState.investigationClues) {
    room.worldState.investigationClues = (room.worldState.clues ?? []).map((text, index) => ({
      id: `clue-${index + 1}`,
      text,
      round: 0,
      source: "场景",
      relatesTo: "core-truth"
    }));
  }

  room.worldState.clues = room.worldState.investigationClues.map((item) => item.text);

  return room;
}

export function endGame(roomId: string, report: GameEndReport) {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error("房间不存在");
  }

  room.status = "ended";
  room.worldState.gameEnd = report;
  room.isProcessingTurn = false;

  if (room.gameInstanceId) {
    room.worldState.behaviorReviews = {
      gameInstanceId: room.gameInstanceId,
      status: "pending",
      reviews: []
    };
    room.worldState.fullMysteryReveal = {
      gameInstanceId: room.gameInstanceId,
      status: "pending",
      content: ""
    };
  }

  const shaped = ensureRoomShape(room);
  void import("./behaviorReview").then((module) => module.generateBehaviorReviewsForRoom(roomId));
  void import("./mysteryReveal").then((module) => module.generateFullMysteryRevealForRoom(roomId));
  return shaped;
}

export function getRoom(roomId: string) {
  const room = rooms.get(roomId);
  return room ? ensureRoomShape(room) : undefined;
}

export function countHumanPlayers(room: Room) {
  return room.players.filter((player) => player.kind === "human").length;
}

export function createRoom(hostName: string, scenarioId: ScenarioId, maxPlayers = 3, mode: Room["mode"] = "multi") {
  const roomId = createId("room");
  const hostPlayerId = createId("player");
  const capped = clampMaxPlayers(maxPlayers);
  const host: Player = {
    id: hostPlayerId,
    name: hostName,
    isHost: true,
    kind: "human",
    ready: true
  };

  const room: Room = {
    id: roomId,
    gameInstanceId: "",
    scenarioId,
    status: "lobby",
    mode,
    hostPlayerId,
    maxPlayers: capped,
    roleSlots: [],
    turnPhase: "human",
    humanTurnOrder: [],
    botTurnOrder: [],
    currentTurnIndex: 0,
    isProcessingTurn: false,
    players: [host],
    messages: [
      createMessage({
        type: "system",
        speaker: "系统",
        content: `${hostName} 创建了房间（${capped} 人局），等待玩家加入。`
      })
    ],
    chatPosts: [],
    worldState: createWorldState(),
    createdAt: now()
  };

  rooms.set(roomId, room);
  syncRoleSlots(room);

  if (mode === "single" && room.roleSlots[0]) {
    room.roleSlots[0].claimedByPlayerId = hostPlayerId;
    host.roleSlotId = room.roleSlots[0].id;
  }

  return { room: ensureRoomShape(room), playerId: hostPlayerId };
}

export function updateRoomMaxPlayers(roomId: string, hostPlayerId: string, maxPlayers: number) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  if (room.status !== "lobby") {
    throw new Error("游戏已开始，不能修改人数");
  }

  if (room.hostPlayerId !== hostPlayerId) {
    throw new Error("只有房主可以修改房间人数");
  }

  const capped = clampMaxPlayers(maxPlayers);
  if (capped < countHumanPlayers(room)) {
    throw new Error(`人数不能少于当前真人玩家（${countHumanPlayers(room)} 人）`);
  }

  room.maxPlayers = capped;
  syncRoleSlots(room);
  syncLobbyBots(room);
  room.messages.push(
    createMessage({
      type: "system",
      speaker: "系统",
      content: `房主将房间人数设置为 ${capped} 人，已刷新 ${capped} 个可选角色。`
    })
  );

  return ensureRoomShape(room);
}

export function choosePlayerRole(roomId: string, playerId: string, roleSlotId: string | null) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  if (room.status !== "lobby") {
    throw new Error("游戏已开始，不能更换角色");
  }

  ensureRoomShape(room);
  const player = room.players.find((item) => item.id === playerId);
  if (!player) {
    throw new Error("玩家不存在");
  }

  const previousSlotId = player.roleSlotId;
  applyRoleSelection(room, playerId, roleSlotId);

  if (roleSlotId) {
    const slot = room.roleSlots.find((item) => item.id === roleSlotId);
    room.messages.push(
      createMessage({
        type: "system",
        speaker: "系统",
        content: `${player.name} 选择了角色「${slot?.role ?? "未知"}」。`
      })
    );
  } else if (previousSlotId) {
    room.messages.push(
      createMessage({
        type: "system",
        speaker: "系统",
        content: `${player.name} 取消了角色选择。`
      })
    );
  }

  if (roleSlotId) {
    player.ready = true;
  } else {
    player.ready = false;
  }

  const botsAdded = syncLobbyBots(room);
  if (botsAdded > 0) {
    room.messages.push(
      createMessage({
        type: "system",
        speaker: "系统",
        content: `所有真人已选角，剩余 ${botsAdded} 个角色已由 AI 机器人扮演。`
      })
    );
  }

  return ensureRoomShape(room);
}

export { finalizeGameRoles };

export function joinRoom(roomId: string, playerName: string) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  ensureRoomShape(room);
  dedupeHumanPlayers(room);

  if (room.status !== "lobby") {
    throw new Error("游戏已经开始，暂时不能加入");
  }

  const trimmedName = playerName.trim();
  const existing = findHumanByName(room, trimmedName);

  if (existing) {
    return { room, playerId: existing.id };
  }

  if (countHumanPlayers(room) >= room.maxPlayers) {
    throw new Error("真人玩家已满，无法加入");
  }

  const playerId = createId("player");
  const player: Player = {
    id: playerId,
    name: trimmedName,
    isHost: false,
    kind: "human",
    ready: false
  };

  room.players.push(player);
  room.messages.push(
    createMessage({
      type: "system",
      speaker: "系统",
      content: `${trimmedName} 加入了房间（${countHumanPlayers(room)}/${room.maxPlayers} 真人）。`
    })
  );

  return { room, playerId };
}

export function togglePlayerReady(roomId: string, playerId: string) {
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error("房间不存在");
  }

  if (room.status !== "lobby") {
    throw new Error("游戏已开始");
  }

  const player = room.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error("玩家不存在");
  }

  if (player.kind !== "human") {
    throw new Error("AI 机器人不需要准备");
  }

  if (player.isHost) {
    throw new Error("房主默认已准备");
  }

  if (!player.roleSlotId && !player.ready) {
    throw new Error("请先选择角色，再点击准备");
  }

  player.ready = !player.ready;

  const readyCount = room.players.filter((p) => p.kind === "human" && p.ready).length;
  const humanCount = countHumanPlayers(room);
  room.messages.push(
    createMessage({
      type: "system",
      speaker: "系统",
      content: `${player.name} ${player.ready ? "已准备" : "取消准备"}（${readyCount}/${humanCount} 真人已准备）。`
    })
  );

  return room;
}

export function fillBotPlayers(room: Room) {
  const botsNeeded = room.maxPlayers - room.players.length;

  if (botsNeeded <= 0) {
    return;
  }

  let botIndex = room.players.filter((player) => player.kind === "bot").length + 1;

  for (let i = 0; i < botsNeeded; i += 1) {
    room.players.push({
      id: createId("player"),
      name: formatBotName(botIndex, "待定"),
      isHost: false,
      kind: "bot",
      ready: true
    });
    botIndex += 1;
  }

  room.messages.push(
    createMessage({
      type: "system",
      speaker: "系统",
      content: `真人未满员，系统已补入 ${botsNeeded} 名 AI 机器人。`
    })
  );
}

export function applyBotDisplayNames(room: Room) {
  let botIndex = 1;

  for (const player of room.players) {
    if (player.kind !== "bot") {
      continue;
    }

    player.name = formatBotName(botIndex, player.roleCard?.role ?? "未知");
    botIndex += 1;
  }
}

export function initTurnOrder(room: Room) {
  room.humanTurnOrder = room.players.filter((player) => player.kind === "human").map((player) => player.id);
  room.botTurnOrder = room.players.filter((player) => player.kind === "bot").map((player) => player.id);
  room.turnPhase = "human";
  room.currentTurnIndex = 0;
}

export function advanceTurn(room: Room) {
  if (room.turnPhase === "human") {
    const nextIndex = room.currentTurnIndex + 1;

    if (nextIndex < room.humanTurnOrder.length) {
      room.currentTurnIndex = nextIndex;
      return;
    }

    if (room.botTurnOrder.length > 0) {
      room.turnPhase = "bot";
      room.currentTurnIndex = 0;
      return;
    }

    room.currentTurnIndex = 0;
    room.worldState.round += 1;
    return;
  }

  const nextBotIndex = room.currentTurnIndex + 1;

  if (nextBotIndex < room.botTurnOrder.length) {
    room.currentTurnIndex = nextBotIndex;
    return;
  }

  room.turnPhase = "human";
  room.currentTurnIndex = 0;
  room.worldState.round += 1;
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

export function setProcessingTurn(roomId: string, value: boolean) {
  const room = rooms.get(roomId);
  if (room) {
    room.isProcessingTurn = value;
  }
}

export function listInProgressRooms() {
  return [...rooms.values()]
    .map((room) => ensureRoomShape(room))
    .filter((room) => room.status === "in_progress");
}
