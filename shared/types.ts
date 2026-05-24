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
  /** 完成或未达成时的具体依据（由 AI 判定写出） */
  evidence?: string;
}

export interface MissionBrief {
  storyDirection: string;
  coreTruth: string;
  /** 玩家可见的胜利条件清单 */
  victoryChecklist?: string[];
  /** 自然结案动作提示（非投票按钮） */
  naturalEndAction?: string;
  suggestedRounds?: string;
}

/** 玩家可见的明确结案条件 */
export interface ResolutionCriteria {
  victoryChecklist: string[];
  failureTriggers: string[];
  naturalEndAction: string;
  suggestedRounds: string;
}

/** 结构化线索链步骤（主持人用） */
export interface ClueChainBeat {
  step: number;
  relatesTo: string;
  content: string;
  bridge: string;
}

/** 主持人专用推理蓝图（不对玩家展示隐藏真相全文） */
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
  /** 来自哪位玩家的何种行动 */
  source: string;
  /** 关联任务 id（session-1）或 core-truth */
  relatesTo: string;
  isRedHerring?: boolean;
}

export type GameOutcome = "success" | "failure";

/** 单名真人玩家的本局行为点评（全员可见） */
export interface HumanBehaviorReview {
  playerId: string;
  playerName: string;
  role?: string;
  /** 亮点表现 */
  highlights: string;
  /** 可改进之处 */
  improvements: string;
  /** 综合评价 */
  summary: string;
  /** 贡献标签，如「线索推进者」 */
  tags: string[];
  generatedAt: string;
}

/** 本局全员行为点评（按 gameInstanceId 绑定） */
export interface GameBehaviorReviews {
  gameInstanceId: string;
  status: "pending" | "ready" | "failed";
  reviews: HumanBehaviorReview[];
  generatedAt?: string;
  errorMessage?: string;
}

/** 完整故事谜底（结合开场、线索链与隐藏真相生成，全员可读） */
export interface FullMysteryReveal {
  gameInstanceId: string;
  status: "pending" | "ready" | "failed";
  content: string;
  generatedAt?: string;
  errorMessage?: string;
}

export interface GameEndReport {
  /** 所属对局实例（每开一局游戏更新；指认结果仅在该实例内有效） */
  gameInstanceId?: string;
  outcome: GameOutcome;
  endedAt: string;
  /** 本局真相是否已明确揭晓 */
  truthRevealed: string;
  /** 本局必做逐条结论 */
  sessionVerdict: string;
  /** 本剧必做逐条结论 */
  scenarioVerdict: string;
  /** 主持人收官叙事（150-280字） */
  epilogue: string;
  /** 结案方式：剧情推进或指认真凶投票 */
  endReason?: "story" | "accusation";
  /** 指认真凶时的结论文案 */
  accusationVerdict?: string;
  /** 被公投指认的角色名 */
  accusedName?: string;
}

/** 指认真凶环节：服务端保存的正确答案 */
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
  /** 大厅选角：对应 roleSlots 中的 id */
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

/** 单个 AI 机器人对另一名玩家的心智模型（含二阶推测：猜对方在猜什么） */
export interface BotPlayerModel {
  playerId: string;
  playerName: string;
  /** 我观察到的对方言行 */
  observedBehavior: string;
  /** 我猜对方此刻在想什么、想达成什么 */
  suspectedIntent: string;
  /** 我猜对方对剧情/真相的推理（推测别人的推测） */
  suspectedPlotTheory: string;
}

/** AI 机器人私密内心档案（不对玩家展示） */
export interface BotMindState {
  /** 我目前对整体剧情的理解（可错，符合角色视角） */
  plotTheory: string;
  /** 自我处境、秘密目标进展、下一步打算 */
  selfReflection: string;
  /** 对其他角色的心智模型 */
  playerModels: BotPlayerModel[];
  updatedAtRound: number;
}

/** 真人玩家私密推理 Agent 的本局记忆（仅服务端，按 playerId 隔离） */
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
  /** 交流区最近发帖时间（用于调侃频率） */
  lastChatAt: string | null;
  /** 各 AI 机器人的内心档案（playerId → 心智状态） */
  botMinds: Record<string, BotMindState>;
  /** 各真人玩家的推理 Agent 记忆（playerId → 私密档案） */
  playerAgents: Record<string, PlayerAgentMemory>;
}

export interface PlayerAgentAssistRequest {
  playerId: string;
  /** 必须为 true，表示玩家已同意 Agent 辅助 */
  consent: boolean;
  /** 玩家当前草稿行动（可选） */
  draftAction?: string;
  /** 追加提问（可选） */
  question?: string;
}

export interface PlayerAgentAssistResponse {
  analysis: string;
  suggestedAction: string;
  cluesHighlight: string;
  /** 简要说明 Agent 记住了什么（仅返回给请求者） */
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
  /** @deprecated 请用 objectives；保留以兼容旧房间 */
  quests: string[];
  missionBrief?: MissionBrief;
  mysteryPlan?: MysteryPlan;
  /** 当前线索链已推进到的步骤（0=仅开场） */
  clueChainStep?: number;
  resolutionCriteria?: ResolutionCriteria;
  objectives: MissionObjective[];
  gameEnd?: GameEndReport;
  /** 本局结束后 AI 生成的真人行为点评（全员同屏可见） */
  behaviorReviews?: GameBehaviorReviews;
  /** 完整故事谜底（开局设定 + 全剧线索复盘） */
  fullMysteryReveal?: FullMysteryReveal;
  /** @deprecated 由 investigationClues 同步 */
  clues: string[];
  investigationClues: InvestigationClue[];
  sceneTitle: string;
  sceneDescription: string;
  interactiveObjects: InteractiveObject[];
  npcStates: Record<string, string>;
  playerRelationships: Record<string, string>;
  memory: DmMemory;
  /** 指认真凶正确答案（开局解析） */
  accusationMeta?: AccusationMeta;
}

export interface Room {
  id: string;
  /** 当前对局实例 ID（每次「开始游戏」刷新；指认/结案仅绑定本实例） */
  gameInstanceId: string;
  scenarioId: ScenarioId;
  status: GameStatus;
  mode: RoomMode;
  hostPlayerId: string;
  maxPlayers: number;
  /** 本局可选角色（数量 = maxPlayers） */
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
  /** 文字正文、图片说明或语音附言 */
  content: string;
  /** data URL（image/* 或 audio/webm 等） */
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
