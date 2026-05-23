export type ScenarioId = "midnight-train" | "office-dungeon" | "noble-banquet";

export type GameStatus = "lobby" | "in_progress" | "ended";

export type RoomMode = "single" | "multi";

export type MessageType = "system" | "ai" | "player";

export interface RoleCard {
  role: string;
  backstory: string;
  secretGoal: string;
  personality: string;
}

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  roleCard?: RoleCard;
}

export interface Message {
  id: string;
  type: MessageType;
  speaker: string;
  content: string;
  createdAt: string;
  playerId?: string;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  tone: string;
  pitch: string;
  openingHook: string;
}

export interface InteractiveObject {
  id: string;
  name: string;
  description: string;
  status: string;
  actions: string[];
  x: number;
  y: number;
  accent?: "danger" | "mystery" | "neutral";
}

export interface WorldState {
  currentLocation: string;
  round: number;
  tension: number;
  quests: string[];
  clues: string[];
  sceneTitle: string;
  sceneDescription: string;
  interactiveObjects: InteractiveObject[];
  npcStates: Record<string, string>;
  playerRelationships: Record<string, string>;
}

export interface Room {
  id: string;
  scenarioId: ScenarioId;
  status: GameStatus;
  mode: RoomMode;
  hostPlayerId: string;
  players: Player[];
  messages: Message[];
  worldState: WorldState;
  createdAt: string;
}

export interface CreateRoomRequest {
  hostName: string;
  scenarioId: ScenarioId;
  mode: RoomMode;
}

export interface JoinRoomRequest {
  playerName: string;
}

export interface TurnRequest {
  playerId: string;
  content: string;
}

export interface RoomSessionResponse {
  room: Room;
  playerId: string;
}
