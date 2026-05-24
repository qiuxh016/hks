export const AI_HOST_SPEAKER = "AI主持人";
export const AI_HOST_TEASE_SPEAKER = "AI主持人 · 调侃";

export const MIN_ROOM_PLAYERS = 2;
export const MAX_ROOM_PLAYERS = 6;

export type ScenarioId = "midnight-train" | "office-dungeon" | "noble-banquet";

export type GameStatus = "lobby" | "in_progress" | "ended";

export type RoomMode = "single" | "multi";

export type MessageType = "system" | "ai" | "player";

export type MessageVariant = "narration" | "tease" | "brief" | "ending";

export type ObjectiveScope = "session" | "scenario";

export type ObjectiveStatus = "pending" | "completed";

export interface MissionObjective {
  id: string;
  scope: ObjectiveScope;
  text: string;
  status: ObjectiveStatus;
  completedAt?: string;
  evidence?: string;
}

export interface MissionBrief {
  storyDirection: string;
  coreTruth: string;
  victoryChecklist?: string[];
  naturalEndAction?: string;
  suggestedRounds?: string;
}

export interface ResolutionCriteria {
  victoryChecklist: string[];
  failureTriggers: string[];
  naturalEndAction: string;
  suggestedRounds: string;
}

export interface ClueChainBeat {
  step: number;
  relatesTo: string;
  content: string;
  bridge: string;
}

export interface MysteryPlan {
  hiddenTruth: string;
  clueChain: string[];
  redHerrings: string[];
  beats?: ClueChainBeat[];
}

export interface InvestigationClue {
  id: string;
  text: string;
  round: number;
  source: string;
  relatesTo: string;
  isRedHerring?: boolean;
}

export type GameOutcome = "success" | "failure";

export interface HumanBehaviorReview {
  playerId: string;
  playerName: string;
  role?: string;
  highlights: string;
  improvements: string;
  summary: string;
  tags: string[];
  generatedAt: string;
}

export interface GameBehaviorReviews {
  gameInstanceId: string;
  status: "pending" | "ready" | "failed";
  reviews: HumanBehaviorReview[];
  generatedAt?: string;
  errorMessage?: string;
}

export interface FullMysteryReveal {
  gameInstanceId: string;
  status: "pending" | "ready" | "failed";
  content: string;
  generatedAt?: string;
  errorMessage?: string;
}

export interface GameEndReport {
  gameInstanceId?: string;
  outcome: GameOutcome;
  endedAt: string;
  truthRevealed: string;
  sessionVerdict: string;
  scenarioVerdict: string;
  epilogue: string;
  endReason?: "story" | "accusation";
  accusationVerdict?: string;
  accusedName?: string;
}

export interface AccusationMeta {
  correctPlayerIds: string[];
  correctLabels: string[];
  resolvedAt: string;
}

export interface AccusationOption {
  playerId: string;
  label: string;
}

export interface AccusationVoteState {
  question: string;
  options: AccusationOption[];
  deadline: number;
  initiatedBy: string;
  gameInstanceId: string;
}

export interface AccusationResultPayload {
  gameInstanceId: string;
  correct: boolean;
  verdict: string;
  accusedName: string;
  accusedPlayerId: string;
  tally: Record<string, number>;
  truthRevealed: string;
}

export interface StartAccusationRequest {
  playerId: string;
}

export type PlayerKind = "human" | "bot";

export type TurnPhase = "human" | "bot";

export interface RoleCard {
  role: string;
  backstory: string;
  secretGoal: string;
  personality: string;
}

export interface RoleSlot {
  id: string;
  role: string;
  backstory: string;
  secretGoal: string;
  claimedByPlayerId: string | null;
}

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  kind: PlayerKind;
  ready: boolean;
  roleSlotId?: string | null;
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

export interface BotPlayerModel {
  playerId: string;
  playerName: string;
  observedBehavior: string;
  suspectedIntent: string;
  suspectedPlotTheory: string;
}

export interface BotMindState {
  plotTheory: string;
  selfReflection: string;
  playerModels: BotPlayerModel[];
  updatedAtRound: number;
}

export interface PlayerAgentMemory {
  plotTheory: string;
  suspicionOfOthers: string;
  selfSituation: string;
  lastAnalysis: string;
  lastSuggestedAction: string;
  exchangeCount: number;
  updatedAtRound: number;
}

export interface DmMemory {
  storySummary: string;
  playerActions: Record<string, PlayerActionRecord[]>;
  memorableMoments: string[];
  lastTeaseAt: string | null;
  lastActionAt: string | null;
  lastChatAt: string | null;
  botMinds: Record<string, BotMindState>;
  playerAgents: Record<string, PlayerAgentMemory>;
}

export interface PlayerAgentAssistRequest {
  playerId: string;
  consent: boolean;
  draftAction?: string;
  question?: string;
}

export interface PlayerAgentAssistResponse {
  analysis: string;
  suggestedAction: string;
  cluesHighlight: string;
  memoryDigest: string;
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
  missionBrief?: MissionBrief;
  mysteryPlan?: MysteryPlan;
  clueChainStep?: number;
  resolutionCriteria?: ResolutionCriteria;
  objectives: MissionObjective[];
  gameEnd?: GameEndReport;
  behaviorReviews?: GameBehaviorReviews;
  fullMysteryReveal?: FullMysteryReveal;
  clues: string[];
  investigationClues: InvestigationClue[];
  sceneTitle: string;
  sceneDescription: string;
  interactiveObjects: InteractiveObject[];
  npcStates: Record<string, string>;
  playerRelationships: Record<string, string>;
  memory: DmMemory;
  accusationMeta?: AccusationMeta;
}

export interface Room {
  id: string;
  gameInstanceId: string;
  scenarioId: ScenarioId;
  status: GameStatus;
  mode: RoomMode;
  hostPlayerId: string;
  maxPlayers: number;
  roleSlots: RoleSlot[];
  turnPhase: TurnPhase;
  humanTurnOrder: string[];
  botTurnOrder: string[];
  currentTurnIndex: number;
  isProcessingTurn: boolean;
  players: Player[];
  messages: Message[];
  worldState: WorldState;
  createdAt: string;
}

export interface CreateRoomRequest {
  hostName: string;
  scenarioId: ScenarioId;
  mode?: RoomMode;
  maxPlayers?: number;
}

export interface UpdateRoomSettingsRequest {
  maxPlayers: number;
}

export interface JoinRoomRequest {
  playerName: string;
}

export interface TurnRequest {
  playerId: string;
  content: string;
}

export interface SelectRoleRequest {
  playerId: string;
  roleSlotId: string | null;
}

export interface RoomSessionResponse {
  room: Room;
  playerId: string;
}

export function formatBotName(botIndex: number, roleName: string) {
  return `AI机器人${botIndex}号（${roleName}）`;
}

export function getCurrentTurnPlayer(room: Room): Player | undefined {
  const order = room.turnPhase === "human" ? room.humanTurnOrder : room.botTurnOrder;

  if (order.length === 0) {
    return undefined;
  }

  const playerId = order[room.currentTurnIndex];
  return room.players.find((player) => player.id === playerId);
}

export function getTurnPhaseLabel(phase: TurnPhase) {
  return phase === "human" ? "真人回合" : "AI 机器人回合";
}

export type ChatPostType = "text" | "image" | "audio";

export interface ChatPost {
  id: string;
  playerName: string;
  type: ChatPostType;
  content: string;
  mediaDataUrl?: string;
  createdAt: string;
}

export interface ChatPostPayload {
  id: string;
  playerName: string;
  type: ChatPostType;
  content: string;
  mediaDataUrl?: string;
}
