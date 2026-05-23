export type ScenarioId = "midnight-train" | "office-dungeon" | "noble-banquet";

export type GameStatus = "lobby" | "in_progress" | "ended";

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

export interface WorldState {
  currentLocation: string;
  round: number;
  tension: number;
  quests: string[];
  npcStates: Record<string, string>;
  playerRelationships: Record<string, string>;
}

export interface Room {
  id: string;
  scenarioId: ScenarioId;
  status: GameStatus;
  hostPlayerId: string;
  players: Player[];
  messages: Message[];
  worldState: WorldState;
  createdAt: string;
}

export interface CreateRoomRequest {
  hostName: string;
  scenarioId: ScenarioId;
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

