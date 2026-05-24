import {
  AI_HOST_SPEAKER,
  GameEndReport,
  GameOutcome,
  InteractiveObject,
  InvestigationClue,
  MissionObjective,
  MysteryPlan,
  Player,
  RoleCard,
  Room,
  ScenarioId
} from "../shared/types";
import { formatCaseProgressForPrompt, parseResolutionCriteria } from "./caseProgress";
import { getScenario, scenarioCaseTemplates, scenarioInvestigationAnchors } from "./scenarios";
import { formatMemoryForPrompt } from "./memory";
import {
  cleanObjectiveText,
  formatClueChainLineForPlayers,
  formatNumberedList,
  normalizeBulletLines
} from "./briefFormat";
import { sanitizePlayerFacingText } from "./textFormat";
import type { ClueChainBeat, ResolutionCriteria } from "../shared/types";

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type DmReply = {
  narration: string;
  nextLocation: string;
};

export type TurnResolution = DmReply & {
  objectiveUpdates: Array<{
    id: string;
    status: MissionObjective["status"];
    evidence?: string;
  }>;
  newClues: InvestigationClue[];
  gameStatus: "in_progress" | "success_end" | "failure_end";
  endDraft?: {
    outcome: GameOutcome;
    truthRevealed: string;
    sessionVerdict: string;
    scenarioVerdict: string;
    epilogue: string;
  };
};

export type OpeningPackage = {
  storyDirection: string;
  coreTruth: string;
  scenarioObjectives: string[];
  sessionObjectives: string[];
  mysteryPlan: MysteryPlan;
  openingClues: InvestigationClue[];
  resolutionCriteria: ResolutionCriteria;
  narration: string;
  nextLocation: string;
};

function extractSection(raw: string, sectionTitle: string) {
  const pattern = new RegExp(
    `##\\s*${sectionTitle}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s*|\\n【地点|$)`,
    "i"
  );
  const match = raw.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function extractBulletList(raw: string, sectionTitle: string, maxItems: number) {
  const block = extractSection(raw, sectionTitle);
  if (!block) {
    return [];
  }

  return normalizeBulletLines(
    block.split("\n").map((line) => line.trim())
  ).slice(0, maxItems);
}

function extractObjectives(raw: string) {
  const session = extractBulletList(raw, "本局必做", 5);
  if (session.length > 0) {
    return session;
  }
  return extractBulletList(raw, "必做事项", 5);
}

function extractScenarioObjectives(raw: string) {
  return extractBulletList(raw, "本剧必做", 4);
}

export function buildObjectivesFromPackage(pkg: OpeningPackage): MissionObjective[] {
  const scenario = pkg.scenarioObjectives.map((text, index) => ({
    id: `scenario-${index + 1}`,
    scope: "scenario" as const,
    text: cleanObjectiveText(text),
    status: "pending" as const
  }));
  const session = pkg.sessionObjectives.map((text, index) => ({
    id: `session-${index + 1}`,
    scope: "session" as const,
    text: cleanObjectiveText(text),
    status: "pending" as const
  }));

  return [...scenario, ...session];
}

function extractSubSection(block: string, title: string) {
  const pattern = new RegExp(
    `###\\s*${title}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s*|\\n##\\s*|$)`,
    "i"
  );
  return block.match(pattern)?.[1]?.trim() ?? "";
}

function parseClueChainBeats(block: string): ClueChainBeat[] {
  const beats: ClueChainBeat[] = [];

  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const structured = trimmed.match(
      /^步骤\s*(\d+)\s*[｜|]\s*关联\s*(session-\d+|scenario-\d+|core-truth)\s*[｜|]\s*(.+?)(?:\s*[｜|]\s*承接\s*[：:]?\s*(.+))?$/iu
    );

    if (structured) {
      beats.push({
        step: Number(structured[1]),
        relatesTo: structured[2],
        content: structured[3].trim(),
        bridge: structured[4]?.trim() || "开场"
      });
      continue;
    }

    const fallback = trimmed.replace(/^[\d\-*、．.]+\s*/, "").trim();
    if (fallback.length > 4) {
      beats.push({
        step: beats.length + 1,
        relatesTo: `session-${Math.min(beats.length + 1, 3)}`,
        content: fallback,
        bridge: beats.length === 0 ? "开场" : `步骤${beats.length}`
      });
    }
  }

  return beats.slice(0, 8);
}

function parseMysteryPlan(raw: string, coreTruth: string): MysteryPlan {
  const blueprint = extractSection(raw, "推理蓝图");
  const hiddenTruth =
    extractSubSection(blueprint, "隐藏真相") ||
    extractSection(blueprint || raw, "隐藏真相") ||
    extractSection(raw, "隐藏真相") ||
    coreTruth;
  const clueChainBlock = extractSubSection(blueprint, "线索链") || extractSection(blueprint || raw, "线索链");
  const beats = clueChainBlock ? parseClueChainBeats(clueChainBlock) : [];
  const clueChain =
    beats.length > 0
      ? beats.map((beat) => `【${beat.relatesTo}】${beat.content}（承接：${beat.bridge}）`)
      : clueChainBlock
        ? clueChainBlock
            .split("\n")
            .map((line) => line.replace(/^[\d\-*、．.]+\s*/, "").trim())
            .filter((line) => line.length > 0)
            .slice(0, 8)
        : extractBulletList(blueprint || raw, "线索链", 8);
  const redHerringBlock =
    extractSubSection(blueprint, "可误导项") || extractSection(blueprint || raw, "可误导项");
  const redHerrings = redHerringBlock
    ? redHerringBlock
        .split("\n")
        .map((line) => line.replace(/^[\d\-*、．.]+\s*/, "").trim())
        .filter((line) => line.length > 0)
        .slice(0, 2)
    : extractBulletList(blueprint || raw, "可误导项", 2);

  return {
    hiddenTruth,
    clueChain:
      clueChain.length > 0
        ? clueChain
        : [
            "【session-1】现场第一处物证指向主要嫌疑人（承接：开场）",
            "【session-2】证人证词与物证出现矛盾（承接：步骤1）",
            "【session-3】第二处物证印证或推翻矛盾（承接：步骤2）",
            "【core-truth】关键动机或时间线被揭开（承接：步骤3）",
            "【core-truth】真相关联证据足以指认（承接：步骤4）"
          ],
    redHerrings: redHerrings.length > 0 ? redHerrings : [],
    beats: beats.length > 0 ? beats : undefined
  };
}

function parseOpeningClues(raw: string, round = 0): InvestigationClue[] {
  const block = extractSection(raw, "开场线索") || extractSection(raw, "初始线索");
  const lines = block
    ? block
        .split("\n")
        .map((line) => line.replace(/^[\d\-*、．.]+\s*/, "").trim())
        .filter((line) => line.length > 0)
    : [];

  return lines.slice(0, 4).map((line, index) => {
    const tagged = line.match(
      /^(?:\[(session-\d+|scenario-\d+|core-truth)\]|(session-\d+|scenario-\d+|core-truth))\s*[：:．.]?\s*(.+)$/iu
    );

    const relatesTo = tagged?.[1] ?? tagged?.[2] ?? (index === 0 ? "session-1" : index === 1 ? "session-2" : "session-3");
    const text = tagged?.[3]?.trim() ?? line;

    return {
      id: `clue-${index + 1}`,
      text,
      round,
      source: "开场场景",
      relatesTo
    };
  });
}

function parseOpeningPackage(raw: string, scenarioTitle: string): OpeningPackage {
  const storyDirection =
    extractSection(raw, "故事走向") || "你们被卷入一场无法回头的风波，真相藏在细节里。";
  const coreTruth =
    extractSection(raw, "要找到的真相") ||
    extractSection(raw, "核心真相") ||
    "查明事件背后真正的操纵者。";
  const sessionObjectives = extractObjectives(raw);
  const scenarioObjectives = extractScenarioObjectives(raw);
  const mysteryPlan = parseMysteryPlan(raw, coreTruth);
  const openingClues = parseOpeningClues(raw);
  const resolutionCriteria = parseResolutionCriteria(raw);
  const storyBlock = extractSection(raw, "开场剧情") || raw;
  const parsedStory = parseDmReply(storyBlock, "故事开场");

  return {
    storyDirection,
    coreTruth,
    scenarioObjectives:
      scenarioObjectives.length > 0
        ? scenarioObjectives
        : [`查明《${scenarioTitle}》事件的核心真相并公之于众`],
    sessionObjectives:
      sessionObjectives.length > 0
        ? sessionObjectives.slice(0, 3)
        : [
            "调查现场并记录第一条可验证物证",
            "找出与核心矛盾相关的证人或矛盾点",
            "获得能指向真凶的关键证据"
          ],
    mysteryPlan,
    openingClues,
    resolutionCriteria,
    narration: parsedStory.narration,
    nextLocation: parsedStory.nextLocation
  };
}

function formatMissionBrief(pkg: OpeningPackage) {
  const scenarioLines = formatNumberedList(
    pkg.scenarioObjectives.map((item) => cleanObjectiveText(item))
  );
  const sessionLines = formatNumberedList(
    pkg.sessionObjectives.map((item) => cleanObjectiveText(item))
  );
  const victoryLines = formatNumberedList(
    normalizeBulletLines(pkg.resolutionCriteria.victoryChecklist)
  );
  const failureLines = formatNumberedList(
    normalizeBulletLines(pkg.resolutionCriteria.failureTriggers)
  );
  const chainPreview = formatNumberedList(
    pkg.mysteryPlan.clueChain
      .slice(0, 5)
      .map((item) => formatClueChainLineForPlayers(item))
      .filter((line) => line.length > 0)
  );

  const naturalEnd = cleanObjectiveText(pkg.resolutionCriteria.naturalEndAction);

  return sanitizePlayerFacingText(
    [
      "📜 本局任务简报（请先阅读，再开始行动）",
      "",
      "故事走向",
      cleanObjectiveText(pkg.storyDirection),
      "",
      "要找到的真相",
      cleanObjectiveText(pkg.coreTruth),
      "",
      "胜利条件（全部满足后可自然结案）",
      victoryLines || "（见下方本局必做与本剧必做）",
      ...(failureLines
        ? ["", "失败条件（出现即可能失败收官）", failureLines]
        : []),
      "",
      "本剧必做",
      scenarioLines,
      "",
      "本局必做（请按 1→2→3 顺序完成）",
      sessionLines,
      "",
      "线索链预告",
      chainPreview || "（调查推进后逐条揭示）",
      "",
      naturalEnd ? `自然结案：${naturalEnd}` : "",
      pkg.resolutionCriteria.suggestedRounds
        ? `建议回合：${cleanObjectiveText(pkg.resolutionCriteria.suggestedRounds)}`
        : "",
      "",
      "提示：完成上述必做后，执行自然结案动作，主持人将宣布胜利收官。"
    ]
      .filter((line) => line !== "")
      .join("\n")
  );
}

const MAX_CLUES = 16;

function normalizeClueText(text: string) {
  return text.replace(/\s+/g, "").toLowerCase();
}

export function mergeInvestigationClues(
  existing: InvestigationClue[],
  incoming: InvestigationClue[]
) {
  const merged = [...existing];
  const seen = new Set(existing.map((item) => normalizeClueText(item.text)));

  for (const clue of incoming) {
    const key = normalizeClueText(clue.text);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(clue);
  }

  return merged.slice(-MAX_CLUES);
}

function parseClueUpdates(raw: string, round: number, playerAction: string): InvestigationClue[] {
  const block = extractSection(raw, "线索更新");
  if (!block || /^无新增/u.test(block.trim())) {
    return [];
  }

  const clues: InvestigationClue[] = [];
  let index = 0;

  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^无新增/u.test(trimmed)) {
      continue;
    }

    const match = trimmed.match(
      /^新增[：:]\s*(.+?)(?:[｜|]\s*关联[：:]\s*([\w-]+))?(?:[｜|]\s*衔接[：:]\s*(.+?))?(?:[｜|]\s*来源[：:]\s*(.+))?$/u
    );
    if (!match) {
      continue;
    }

    const bridge = match[3]?.trim();
    const clueText = bridge ? `${match[1].trim()}（衔接：${bridge}）` : match[1].trim();

    index += 1;
    clues.push({
      id: `clue-r${round}-${index}`,
      text: clueText,
      round,
      relatesTo: match[2]?.trim() || "core-truth",
      source: match[4]?.trim() || playerAction.slice(0, 40),
      isRedHerring: /误导|红鲱鱼/u.test(trimmed)
    });
  }

  return clues.slice(0, 2);
}

function formatMysteryPlanForPrompt(plan: MysteryPlan | undefined) {
  if (!plan) {
    return "（推理蓝图未生成，仍须保持线索前后一致）";
  }

  const beatLines =
    plan.beats && plan.beats.length > 0
      ? plan.beats
          .map(
            (beat) =>
              `${beat.step}. [${beat.relatesTo}] ${beat.content} ← 承接：${beat.bridge}`
          )
          .join("\n")
      : plan.clueChain.map((beat, index) => `${index + 1}. ${beat}`).join("\n");

  return [
    "【推理蓝图·仅主持人可见，勿向玩家泄露隐藏真相原文】",
    `隐藏真相：${plan.hiddenTruth}`,
    "线索链（严格按顺序，每次调查最多揭示当前步骤 1 条，且必须写明衔接上一条）：",
    beatLines,
    plan.redHerrings.length > 0
      ? `可误导项（最多用这些，且须能解释）：\n${plan.redHerrings.map((item) => `- ${item}`).join("\n")}`
      : "可误导项：无（不要凭空制造红鲱鱼）"
  ].join("\n");
}

function formatClueBoardForPrompt(clues: InvestigationClue[]) {
  if (clues.length === 0) {
    return "（玩家尚未获得任何结构化线索）";
  }

  return clues
    .map(
      (item) =>
        `- [${item.id}] 回合${item.round}｜${item.text}｜关联：${item.relatesTo}｜来源：${item.source}`
    )
    .join("\n");
}

export function formatNewClueMessage(clues: InvestigationClue[]) {
  if (clues.length === 0) {
    return null;
  }

  const lines = clues.map((item) => {
    const tag = item.isRedHerring ? "（待验证）" : "";
    const text = sanitizePlayerFacingText(item.text);
    return `🔍 ${text}${tag}`;
  });

  return sanitizePlayerFacingText(
    ["🧩 新线索（请与左侧必做对照）", ...lines].join("\n")
  );
}

function formatInvestigationAnchors(scenarioId: ScenarioId) {
  const anchors = scenarioInvestigationAnchors[scenarioId];
  return [
    `场景锚点：${anchors.setting}`,
    `核心矛盾：${anchors.coreConflict}`,
    `关键要素（线索必须能挂接其中至少一项）：${anchors.keyEntities.join("、")}`
  ].join("\n");
}

function isInvestigationAction(action: string) {
  return /搜查|调查|检查|观察|盘问|询问|试探|翻看|寻找|取证|偷听|跟踪|化验|比对|推理|线索|证据|尸体|抽屉|手机|邮件|脚印|灯|遗嘱|车票|底片/u.test(
    action
  );
}

function formatObjectivesForPrompt(objectives: MissionObjective[]) {
  if (objectives.length === 0) {
    return "（尚未设定任务）";
  }

  const scenario = objectives.filter((item) => item.scope === "scenario");
  const session = objectives.filter((item) => item.scope === "session");

  const formatLine = (item: MissionObjective) => {
    const status = item.status === "completed" ? "已完成" : "未完成";
    const evidence = item.evidence ? `（依据：${item.evidence}）` : "";
    return `- ${item.id}｜${status}｜${item.text}${evidence}`;
  };

  return [
    "【本剧必做·通关条件】",
    scenario.map(formatLine).join("\n") || "（无）",
    "",
    "【本局必做·本局步骤】",
    session.map(formatLine).join("\n") || "（无）"
  ].join("\n");
}

function normalizeObjectiveId(token: string) {
  const trimmed = token.trim();
  const scoped = trimmed.match(/^(本剧|本局)必做[-\s]*(\d+)$/i);
  if (scoped) {
    const scope = scoped[1] === "本剧" ? "scenario" : "session";
    return `${scope}-${scoped[2]}`;
  }

  const short = trimmed.match(/^(scenario|session)[-\s]*(\d+)$/i);
  if (short) {
    return `${short[1].toLowerCase()}-${short[2]}`;
  }

  return trimmed;
}

function parseObjectiveJudgments(raw: string) {
  const block = extractSection(raw, "任务判定");
  if (!block) {
    return [];
  }

  const updates: TurnResolution["objectiveUpdates"] = [];

  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const match = trimmed.match(
      /^([\w\u4e00-\u9fa5-]+)[：:]\s*(已完成|未完成)(?:[｜|](.+))?$/u
    );
    if (!match) {
      continue;
    }

    const id = normalizeObjectiveId(match[1]);
    updates.push({
      id,
      status: match[2] === "已完成" ? "completed" : "pending",
      evidence: match[3]?.trim()
    });
  }

  return updates;
}

function parseGameStatus(raw: string): TurnResolution["gameStatus"] {
  const block = extractSection(raw, "对局状态") || "";
  const line = block.split("\n")[0]?.trim() ?? "";

  if (/失败收官/.test(line)) {
    return "failure_end";
  }
  if (/胜利收官/.test(line)) {
    return "success_end";
  }

  return "in_progress";
}

function parseEndDraft(raw: string, fallbackOutcome: GameOutcome): TurnResolution["endDraft"] {
  const block = extractSection(raw, "收官说明");
  if (!block) {
    return undefined;
  }

  const pick = (labels: string[]) => {
    for (const label of labels) {
      const value = extractSection(block, label);
      if (value) {
        return value;
      }
    }
    return "";
  };

  const truthRevealed = pick(["真相揭晓", "真相"]);
  const sessionVerdict = pick(["本局必做完成情况", "本局完成情况"]);
  const scenarioVerdict = pick(["本剧必做完成情况", "本剧完成情况", "通关条件完成情况"]);
  const epilogue = pick(["收官叙事", "结局叙事"]) || block;

  let outcome = fallbackOutcome;
  const outcomeLine = block.match(/结局[：:]\s*(胜利|失败)/);
  if (outcomeLine) {
    outcome = outcomeLine[1] === "胜利" ? "success" : "failure";
  }

  return {
    outcome,
    truthRevealed: truthRevealed || "（主持人未写明）",
    sessionVerdict: sessionVerdict || "（主持人未写明）",
    scenarioVerdict: scenarioVerdict || "（主持人未写明）",
    epilogue: epilogue.trim()
  };
}

function stripTurnMeta(raw: string) {
  const metaStart = raw.search(/\n【(?:任务判定|线索更新|对局状态|收官说明)】/u);
  if (metaStart === -1) {
    return raw;
  }

  const beforeMeta = raw.slice(0, metaStart);
  const locationMatch = raw.match(/【地点[：:]\s*(.+?)】\s*$/u);
  if (locationMatch) {
    return `${beforeMeta.trim()}\n【地点：${locationMatch[1].trim()}】`;
  }

  return beforeMeta.trim();
}

function parseTurnResolution(
  raw: string,
  fallbackLocation: string,
  round: number,
  playerAction: string
): TurnResolution {
  const stripped = stripTurnMeta(raw);
  const base = parseDmReply(stripped, fallbackLocation);
  const gameStatus = parseGameStatus(raw);
  const objectiveUpdates = parseObjectiveJudgments(raw);
  const newClues = parseClueUpdates(raw, round, playerAction);

  const fallbackOutcome: GameOutcome =
    gameStatus === "failure_end" ? "failure" : "success";

  const endDraft =
    gameStatus === "in_progress" ? undefined : parseEndDraft(raw, fallbackOutcome);

  return {
    narration: base.narration,
    nextLocation: base.nextLocation,
    objectiveUpdates,
    newClues,
    gameStatus,
    endDraft
  };
}

export function applyObjectiveUpdates(
  objectives: MissionObjective[],
  updates: TurnResolution["objectiveUpdates"]
) {
  if (updates.length === 0) {
    return objectives;
  }

  const map = new Map(updates.map((item) => [item.id, item]));

  return objectives.map((objective) => {
    const update = map.get(objective.id);
    if (!update) {
      return objective;
    }

    if (update.status === "completed") {
      return {
        ...objective,
        status: "completed" as const,
        completedAt: new Date().toISOString(),
        evidence: update.evidence ?? objective.evidence
      };
    }

    return {
      ...objective,
      status: "pending" as const,
      completedAt: undefined,
      evidence: update.evidence
    };
  });
}

export function allRequiredObjectivesDone(objectives: MissionObjective[]) {
  const required = objectives.filter((item) => item.scope === "session" || item.scope === "scenario");
  return required.length > 0 && required.every((item) => item.status === "completed");
}

export function formatObjectiveProgressMessage(
  before: MissionObjective[],
  after: MissionObjective[]
) {
  const lines: string[] = [];

  for (const next of after) {
    const prev = before.find((item) => item.id === next.id);
    if (!prev || prev.status === next.status) {
      continue;
    }

    const label = next.scope === "scenario" ? "本剧必做" : "本局必做";
    const statusText = next.status === "completed" ? "✅ 已完成" : "⬜ 未完成";
    const evidence = next.evidence ? `｜${next.evidence}` : "";
    lines.push(`${label}「${next.text}」→ ${statusText}${evidence}`);
  }

  if (lines.length === 0) {
    return null;
  }

  return sanitizePlayerFacingText(["📋 任务进度更新", ...lines].join("\n"));
}

export function formatGameEndBrief(report: GameEndReport) {
  const outcomeLabel = report.outcome === "success" ? "🏆 胜利收官" : "💀 失败收官";

  return sanitizePlayerFacingText(
    [
      outcomeLabel,
      "",
      "真相揭晓：",
      report.truthRevealed,
      "",
      "本局必做完成情况：",
      report.sessionVerdict,
      "",
      "本剧必做完成情况：",
      report.scenarioVerdict,
      "",
      "结局：",
      report.epilogue
    ].join("\n")
  );
}

export function buildGameEndReport(
  room: Room,
  endDraft: NonNullable<TurnResolution["endDraft"]>
): GameEndReport {
  const objectives = room.worldState.objectives;
  const sessionLines = objectives
    .filter((item) => item.scope === "session")
    .map((item, index) => {
      const mark = item.status === "completed" ? "✅" : "❌";
      const evidence = item.evidence ? `（${item.evidence}）` : "";
      return `${index + 1}. ${mark} ${item.text}${evidence}`;
    })
    .join("\n");
  const scenarioLines = objectives
    .filter((item) => item.scope === "scenario")
    .map((item, index) => {
      const mark = item.status === "completed" ? "✅" : "❌";
      const evidence = item.evidence ? `（${item.evidence}）` : "";
      return `${index + 1}. ${mark} ${item.text}${evidence}`;
    })
    .join("\n");

  const allDone = allRequiredObjectivesDone(objectives);
  let outcome = endDraft.outcome;
  if (outcome === "success" && !allDone) {
    outcome = "failure";
  }

  return {
    gameInstanceId: room.gameInstanceId || undefined,
    outcome,
    endedAt: new Date().toISOString(),
    truthRevealed: endDraft.truthRevealed,
    sessionVerdict: endDraft.sessionVerdict || sessionLines || "（无记录）",
    scenarioVerdict: endDraft.scenarioVerdict || scenarioLines || "（无记录）",
    epilogue: endDraft.epilogue,
    endReason: "story"
  };
}

// ----- scene objects (for interactive scene visualization) -----

export function buildSceneObjects(scenarioId: ScenarioId): InteractiveObject[] {
  if (scenarioId === "midnight-train") {
    return [
      {
        id: "conductor",
        name: "乘务员",
        description: "站在左侧车门旁，过于镇定，像是早就知道会发生什么。",
        status: "低着头，不愿和任何人对视",
        actions: ["盘问乘务员", "观察神情", "偷偷跟着他"],
        x: 8,
        y: 54,
        accent: "neutral"
      },
      {
        id: "body",
        name: "尸体",
        description: "倒在车厢中央，手边散落着纸片和一部手机。",
        status: "暂时无人敢靠近",
        actions: ["搜查尸体", "检查伤口", "偷看手边物品"],
        x: 48,
        y: 82,
        accent: "danger"
      },
      {
        id: "shadow-figure",
        name: "窗外黑影",
        description: "右侧窗外站着一个模糊身影，像是在隔着玻璃看你们。",
        status: "一动不动，像在等待什么",
        actions: ["观察黑影", "敲窗试探", "记录它出现的位置"],
        x: 84,
        y: 43,
        accent: "mystery"
      }
    ];
  }

  if (scenarioId === "office-dungeon") {
    return [
      {
        id: "meeting-room",
        name: "会议室",
        description: "玻璃门后坐着几位脸色发青的同事，桌上散落着还没收走的方案纸。",
        status: "会议暂停，但里面像刚爆发过激烈争执",
        actions: ["偷听会议", "闯进会议室", "寻找会议纪要"],
        x: 23,
        y: 47,
        accent: "mystery"
      },
      {
        id: "pantry",
        name: "茶水间",
        description: "台面凌乱，咖啡渍还没干，像刚有人情绪崩溃过。",
        status: "咖啡机还热着，墙上贴着可疑便签",
        actions: ["安抚同事", "寻找痕迹", "翻看便签"],
        x: 48,
        y: 33,
        accent: "neutral"
      },
      {
        id: "boss-desk",
        name: "老板工位",
        description: "电脑亮着，台灯也没关，像是主人刚匆忙离开。",
        status: "有一封未发送邮件，时间停在 23:47",
        actions: ["查看电脑", "搜老板抽屉", "拍下邮件内容"],
        x: 75,
        y: 46,
        accent: "danger"
      }
    ];
  }

  return [
    {
      id: "chandelier",
      name: "水晶灯",
      description: "巨大的吊灯被人动过手脚，链条和缠上的红线都像在提醒今晚不只是失窃。",
      status: "灯火依旧华丽，但顶部连接处看上去并不稳",
      actions: ["检查吊灯链条", "观察谁在抬头看灯", "寻找被剪断的痕迹"],
      x: 53,
      y: 15,
      accent: "danger"
    },
    {
      id: "stage",
      name: "舞台",
      description: "钢琴、提琴和谱架都留在原位，像是有人故意用音乐掩盖过某个时刻。",
      status: "乐手不见了，只剩舞台灯还亮着",
      actions: ["检查钢琴边", "翻看谱架", "搜寻舞台台阶"],
      x: 15,
      y: 44,
      accent: "neutral"
    },
    {
      id: "duke-seat",
      name: "公爵座席",
      description: "主位旁的酒杯和桌布都沾了血，披肩和手套被丢在最显眼的位置。",
      status: "失窃之后，这里成了所有人视线汇聚的中心",
      actions: ["搜主位", "观察宾客反应", "检查桌布血迹"],
      x: 77,
      y: 64,
      accent: "mystery"
    },
    {
      id: "balcony-trail",
      name: "露台脚印",
      description: "红毯上的脚印一路延伸到敞开的露台，像有人匆忙离开后又不敢回头。",
      status: "脚印还很新，夜风正从门外灌进大厅",
      actions: ["追去露台", "检查脚印深浅", "查看遗落手套"],
      x: 56,
      y: 72,
      accent: "neutral"
    }
  ];
}

export function getSceneMeta(scenarioId: ScenarioId) {
  if (scenarioId === "midnight-train") {
    return {
      sceneTitle: "暴雨列车车厢",
      sceneDescription: "尸体倒在车厢中央，左门旁的乘务员和右窗外的黑影都像藏着秘密。"
    };
  }

  if (scenarioId === "office-dungeon") {
    return {
      sceneTitle: "失控办公区",
      sceneDescription: "会议室、茶水间和老板工位三处都像刚发生过什么，整层楼弥漫着压抑的加班气味。"
    };
  }

  return {
    sceneTitle: "贵族晚宴主厅",
    sceneDescription: "吊灯、舞台、公爵主位和通往露台的脚印都像在互相指认，音乐却还在硬撑着体面。"
  };
}

export function buildInitialSceneState(scenarioId: ScenarioId) {
  const meta = getSceneMeta(scenarioId);

  return {
    ...meta,
    clues:
      scenarioId === "midnight-train"
        ? ["尸体手边散落着纸片和手机", "乘务员与窗外黑影都过于可疑"]
        : scenarioId === "office-dungeon"
          ? ["会议室像刚临时中断", "茶水间和老板工位都留着加班痕迹"]
          : ["遗嘱在灯亮起后消失", "红毯上的脚印一直通向露台", "公爵座席旁留下了带血的桌布和手套"],
    interactiveObjects: buildSceneObjects(scenarioId)
  };
}

// ----- DeepSeek AI DM integration -----

function formatPlayerRoster(room: Room) {
  return room.players
    .map((player) => {
      const card = player.roleCard;
      if (!card) {
        return `- ${player.name}`;
      }

      return [
        `- ${player.name}｜${card.role}｜性格：${card.personality}`,
        `  背景：${card.backstory}`,
        `  隐藏目标（仅主持人知晓，勿向其他玩家泄露）：${card.secretGoal}`
      ].join("\n");
    })
    .join("\n");
}

function buildSystemPrompt(room: Room) {
  const scenario = getScenario(room.scenarioId);
  const brief = room.worldState.missionBrief;
  const sceneObjects = room.worldState.interactiveObjects
    .map((item) => `- ${item.name}（${item.status}）可：${item.actions.join("、")}`)
    .join("\n");

  return [
    "你是悬疑推理桌游的 AI 主持人。本局是可通关的推理案件，不是无限悬疑散文。",
    "",
    "叙事与线索原则（必须遵守）：",
    "1. 调查/搜查/盘问：正文必须给出可验证事实（物证、时间、数字、原话、矛盾），禁止空泛氛围。",
    "2. 每条新线索格式：新增：…｜关联：session-N或scenario-N或core-truth｜衔接：承接哪条已有线索｜来源：…",
    "3. 严格按【推理蓝图·线索链】当前步骤发放，一次最多 1 条新线索；必须写明「衔接」已有线索板中的具体事实。",
    "4. 本局必做须按 session-1→2→3 顺序完成；未完成的 session 不得跳关标为已完成。",
    "5. 禁止引入蓝图外的无关人物/道具/超自然设定；红鲱鱼仅限蓝图列出的可误导项。",
    "6. 非调查行动可「线索更新：无新增」；正文 100-220 字；呼应历史操作。",
    "7. 当【结案进度】显示全部必做已完成：玩家若执行了自然结案动作（公开真相/指认真凶/出示证据），必须「胜利收官」并揭晓隐藏真相。",
    "8. 任务「已完成」须在正文中有明确物证或对话依据；不可凭感觉勾选。",
    "9. 不要代替玩家做决定。",
    "10. 正文叙事必须是纯中文+emoji：禁止 Markdown（不要 **、---、#、###、【】、|、* 列表符）。结构化判定写在正文之后的独立块里，不要混进叙事。",
    "",
    formatCaseProgressForPrompt(room),
    "",
    formatInvestigationAnchors(room.scenarioId),
    "",
    formatMysteryPlanForPrompt(room.worldState.mysteryPlan),
    "",
    "【已有线索板——新线索必须能与之关联】",
    formatClueBoardForPrompt(room.worldState.investigationClues),
    "",
    formatMemoryForPrompt(room),
    "",
    `剧本：${scenario.title}（${scenario.tone}）`,
    `简介：${scenario.pitch}`,
    `核心异象：${scenario.openingHook}`,
    brief
      ? `故事走向：${brief.storyDirection}\n玩家可见真相方向：${brief.coreTruth}`
      : "",
    `当前回合：${room.worldState.round}`,
    `当前地点：${room.worldState.currentLocation}`,
    `紧张度：${room.worldState.tension}/10`,
    sceneObjects ? `可交互要素：\n${sceneObjects}` : "",
    "",
    formatObjectivesForPrompt(room.worldState.objectives),
    "",
    "玩家与身份（主持人视角）：",
    formatPlayerRoster(room)
  ].join("\n");
}

function buildConversationMessages(room: Room, player: Player, action: string): DeepSeekMessage[] {
  const messages: DeepSeekMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(room)
    }
  ];

  const storyMessages = room.messages.filter(
    (message) => message.type === "player" || message.type === "ai"
  );

  for (const message of storyMessages.slice(-24)) {
    if (message.type === "player") {
      messages.push({
        role: "user",
        content: `【玩家 ${message.speaker}】${message.content}`
      });
      continue;
    }

    messages.push({
      role: "assistant",
      content: message.content
    });
  }

  const mustGiveClue = isInvestigationAction(action);

  messages.push({
    role: "user",
    content: [
      `【玩家 ${player.name} 本轮行动】${action}`,
      mustGiveClue
        ? "⚠️ 调查类行动：正文须有可验证事实；【线索更新】登记 1 条，必须含「关联」与「衔接」（衔接须引用已有线索板原文关键词）。"
        : "非调查类：无新事实则【线索更新】写「无新增」。",
      "输出顺序：",
      "1) 正文叙事 100-220 字（纯文本+emoji，禁止任何 Markdown 或【】符号）",
      "2) 【任务判定】session-1：已完成｜具体依据（仅当正文已满足该任务的可验证条件）",
      "3) 【线索更新】新增：…｜关联：session-N｜衔接：…｜来源：… ；无则写「无新增」",
      "4) 【对局状态】进行中｜胜利收官｜失败收官（全部必做完成且玩家公开指认/结案时选胜利收官）",
      "5) 若收官：【收官说明】真相揭晓、本局/本剧完成情况、收官叙事",
      "6) 最后一行：【地点：xxx】"
    ].join("\n")
  });

  return messages;
}

function parseDmReply(raw: string, fallbackLocation: string): DmReply {
  const locationPattern = /【地点[：:]\s*(.+?)】\s*$/;
  const match = raw.match(locationPattern);

  if (!match) {
    return {
      narration: sanitizePlayerFacingText(raw),
      nextLocation: fallbackLocation
    };
  }

  return {
    narration: sanitizePlayerFacingText(raw.replace(locationPattern, "")),
    nextLocation: match[1].trim() || fallbackLocation
  };
}

export async function createDeepSeekReply(
  messages: DeepSeekMessage[],
  options?: { maxTokens?: number; temperature?: number }
) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("未配置 DEEPSEEK_API_KEY，请先在 .env 中设置。");
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const endpoint = baseUrl.endsWith("/v1")
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: options?.temperature ?? 0.85,
        max_tokens: options?.maxTokens ?? 600,
        messages
      })
    });

    const payload = (await response.json().catch(() => ({}))) as DeepSeekResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `DeepSeek 请求失败（${response.status}）`);
    }

    const reply = payload.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      throw new Error("DeepSeek 返回为空");
    }

    return reply;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("DeepSeek 响应超时，请稍后重试。");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildOpening(room: Room) {
  const scenario = getScenario(room.scenarioId);
  const playerNames = room.players.map((player) => player.name).join("、");
  const roster = room.players
    .map((player) => {
      const card = player.roleCard;
      return card ? `${player.name}（${card.role}）` : player.name;
    })
    .join("、");

  const template = scenarioCaseTemplates[room.scenarioId];

  const openingRaw = await createDeepSeekReply(
    [
      {
        role: "system",
        content: [
          "你是悬疑推理桌游 AI 主持人，正在生成**可通关、线索强关联**的案件开局。",
          "禁止写成散文化悬疑；玩家必须能按任务清单与线索链自然玩到胜利收官。",
          "",
          "必须用中文，严格按下列 Markdown 标题输出，不要省略：",
          "## 故事走向",
          "## 要找到的真相",
          "## 本剧必做",
          "## 本局必做",
          "## 推理蓝图",
          "## 开场线索",
          "## 结案条件",
          "## 开场剧情",
          "",
          "写作要求：",
          "- 故事走向：80-120字，点明核心矛盾与可调查入口。",
          "- 要找到的真相：玩家可见的谜题（不写完整剧透）。",
          "- 本剧必做：恰好 2 条纯中文，写清要完成什么（禁止写 scenario-1、session-2、[ ] 勾选框）。",
          "- 本局必做：恰好 3 条纯中文，按调查顺序排列，每条写清完成标志（禁止写 session-1 等英文 id）。",
          "- 推理蓝图：含 ### 隐藏真相（真凶姓名/角色+动机+手法）、### 线索链（5-6行，每行格式：步骤N｜关联session-N｜具体线索｜承接上一步）、### 可误导项（0-1条）。",
          "- 开场线索：恰好 3 条纯中文事实（行首可用「步骤一：」等，不要用 [session-1] 英文标签），彼此因果关联。",
          "- 结案条件：胜利写 3～4 条纯中文（不要 [ ]、不要 session/scenario 编号）；失败 1～2 条；自然结案、建议回合各一行中文。",
          "- 开场剧情：180-240字纯文本+emoji，嵌入全部开场线索事实，禁止 Markdown 与【】；末行单独一行【地点：xxx】（仅这一行可用方括号）。",
          "",
          formatInvestigationAnchors(room.scenarioId),
          `- 剧本：${scenario.title}（${scenario.tone}）`,
          `- 简介：${scenario.pitch}`,
          `- 异象：${scenario.openingHook}`,
          "",
          "结构参考（勿照抄剧情，仅学格式）：",
          `本局必做示例：\n${template.sessionSteps.join("\n")}`,
          `本剧必做示例：\n${template.scenarioGoals.join("\n")}`,
          `线索链示例：\n${template.clueChainExample.join("\n")}`
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `请为《${scenario.title}》生成开局。`,
          `参与角色：${roster}`,
          `玩家名：${playerNames}`,
          "要求：线索链步骤与三条本局必做一一对应；胜利条件必须明确、可勾选。"
        ].join("\n")
      }
    ],
    { maxTokens: 1400, temperature: 0.52 }
  );

  const opening = parseOpeningPackage(openingRaw, scenario.title);

  return {
    messages: [
      {
        type: "system" as const,
        speaker: "系统",
        content: `游戏开始 · 剧本《${scenario.title}》。共 ${room.players.length} 名成员。请先阅读下方任务简报，再输入你的行动。`,
        variant: "brief" as const
      },
      {
        type: "system" as const,
        speaker: "任务简报",
        content: formatMissionBrief(opening),
        variant: "brief" as const
      },
      {
        type: "ai" as const,
        speaker: AI_HOST_SPEAKER,
        content: opening.narration
      }
    ],
    nextLocation: opening.nextLocation,
    objectives: buildObjectivesFromPackage(opening),
    sessionObjectives: opening.sessionObjectives,
    scenarioObjectives: opening.scenarioObjectives,
    storyDirection: opening.storyDirection,
    coreTruth: opening.coreTruth,
    mysteryPlan: opening.mysteryPlan,
    openingClues: opening.openingClues,
    resolutionCriteria: opening.resolutionCriteria
  };
}

export async function resolveTurn(
  room: Room,
  player: Player,
  content: string
): Promise<TurnResolution> {
  const raw = await createDeepSeekReply(buildConversationMessages(room, player, content), {
    maxTokens: 1100,
    temperature: 0.62
  });
  return parseTurnResolution(
    raw,
    room.worldState.currentLocation,
    room.worldState.round,
    content
  );
}

export async function refreshStorySummary(room: Room) {
  const memory = room.worldState.memory;
  if (!memory.storySummary && countActions(memory) === 0) {
    return memory.storySummary;
  }

  const summary = await createDeepSeekReply([
    {
      role: "system",
      content:
        "你是主持人助理，负责把冒险日志压缩成简洁中文摘要（150字以内），保留：关键事件、玩家做过的重要行动、未解悬念。只输出摘要正文。"
    },
    {
      role: "user",
      content: [
        formatMemoryForPrompt(room),
        "",
        "最近对话摘录：",
        room.messages
          .filter((message) => message.type === "player" || message.type === "ai")
          .slice(-10)
          .map((message) => `${message.speaker}: ${message.content}`)
          .join("\n")
      ].join("\n")
    }
  ]);

  memory.storySummary = summary.trim();
  return memory.storySummary;
}

function countActions(memory: Room["worldState"]["memory"]) {
  return Object.values(memory.playerActions).reduce((total, list) => total + list.length, 0);
}

export async function generateTease(room: Room) {
  const recentActions = room.players
    .map((player) => {
      const actions = room.worldState.memory.playerActions[player.id] ?? [];
      const last = actions.slice(-3).map((item) => item.content).join("；");
      return last ? `${player.name}最近：${last}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const raw = await createDeepSeekReply([
    {
      role: "system",
      content: [
        "你是桌游 AI 主持人，现在暂时跳出剧情，用 50-120 字调侃玩家最近的骚操作。",
        "要求：诙谐、腹黑、像老朋友吐槽；可夸张但不要人身攻击；不要推进主线剧情；不要写地点标记。",
        "必须引用玩家真实做过的操作（见记忆档案），让他们感到你记得他们干过什么。",
        formatMemoryForPrompt(room)
      ].join("\n")
    },
    {
      role: "user",
      content: `请根据以下最近操作写一段调侃旁白：\n${recentActions || "玩家们还在观望"}`
    }
  ]);

  return sanitizePlayerFacingText(raw.replace(/【地点[：:].+?】\s*$/u, ""));
}
