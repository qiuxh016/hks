export const AI_HOST_SPEAKER = "AI主持人";
export const AI_HOST_TEASE_SPEAKER = "AI主持人 · 调侃";

export type ScenarioId = "midnight-train" | "office-dungeon" | "noble-banquet";

export type GameStatus = "lobby" | "in_progress" | "ended";

export type MessageType = "system" | "ai" | "player";

export type MessageVariant = "narration" | "tease";

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
  variant?: MessageVariant;
}

export interface PlayerActionRecord {
  round: number;
  content: string;
  at: string;
}

export interface DmMemory {
  storySummary: string;
  playerActions: Record<string, PlayerActionRecord[]>;
  memorableMoments: string[];
  lastTeaseAt: string | null;
  lastActionAt: string | null;
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
  memory: DmMemory;
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

