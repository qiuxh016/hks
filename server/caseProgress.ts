import {
  GameEndReport,
  MissionObjective,
  ResolutionCriteria,
  Room
} from "../shared/types";
import { allRequiredObjectivesDone, type TurnResolution } from "./dm";
import { normalizeBulletLines } from "./briefFormat";
import { sanitizePlayerFacingText } from "./textFormat";

const MIN_CLUES_FOR_END = 4;

export function computeClueChainStep(room: Room) {
  const sessionClueTargets = new Set(
    room.worldState.investigationClues
      .map((clue) => clue.relatesTo)
      .filter((target) => target.startsWith("session-"))
  );

  const sessionDone = room.worldState.objectives.filter(
    (item) => item.scope === "session" && item.status === "completed"
  ).length;

  return Math.max(sessionClueTargets.size, sessionDone, room.worldState.clueChainStep ?? 0);
}

export function syncClueChainStep(room: Room) {
  room.worldState.clueChainStep = computeClueChainStep(room);
}

export function countPendingObjectives(objectives: MissionObjective[]) {
  return objectives.filter(
    (item) =>
      (item.scope === "session" || item.scope === "scenario") && item.status !== "completed"
  ).length;
}

export function formatCaseProgressForPlayers(room: Room) {
  if (room.status !== "in_progress") {
    return null;
  }

  const objectives = room.worldState.objectives;
  const session = objectives.filter((item) => item.scope === "session");
  const scenario = objectives.filter((item) => item.scope === "scenario");
  const sessionDone = session.filter((item) => item.status === "completed").length;
  const scenarioDone = scenario.filter((item) => item.status === "completed").length;
  const chainLen = room.worldState.mysteryPlan?.clueChain.length ?? 5;
  const chainStep = computeClueChainStep(room);
  const criteria = room.worldState.resolutionCriteria;
  const clueCount = room.worldState.investigationClues.length;

  const sessionLine = session
    .map((item, index) => {
      const mark = item.status === "completed" ? "✅" : "⬜";
      return `${mark} ${index + 1}. ${item.text}`;
    })
    .join("\n");

  const scenarioLine = scenario
    .map((item, index) => {
      const mark = item.status === "completed" ? "✅" : "⬜";
      return `${mark} ${index + 1}. ${item.text}`;
    })
    .join("\n");

  const readyToEnd = allRequiredObjectivesDone(objectives);

  return sanitizePlayerFacingText(
    [
      "📍 结案进度（全部本局必做完成后，指认真凶即可胜利收官）",
      "",
      `线索链：${chainStep}/${chainLen} 步，已收集线索 ${clueCount} 条`,
      "",
      "本局必做：",
      sessionLine || "（无）",
      `进度：${sessionDone}/${session.length}`,
      "",
      "本剧必做：",
      scenarioLine || "（无）",
      `进度：${scenarioDone}/${scenario.length}`,
      "",
      criteria?.naturalEndAction
        ? `✨ 自然结案动作：${criteria.naturalEndAction}`
        : "✨ 结案条件：全部本局必做完成后，在对局中成功指认真凶即可胜利收官",
      criteria?.suggestedRounds ? `⏱ 建议回合：${criteria.suggestedRounds}` : "",
      readyToEnd
        ? "🎯 条件已满足：现在指认真凶即可胜利收官！指认错误会得到否定引导。"
        : `⏳ 未完成 ${countPendingObjectives(objectives)} 项必做，请按顺序调查推进。`
    ]
      .filter(Boolean)
      .join("\n")
  );
}

export function formatCaseProgressForPrompt(room: Room) {
  const chainLen = room.worldState.mysteryPlan?.clueChain.length ?? 5;
  const step = computeClueChainStep(room);
  const nextBeat = room.worldState.mysteryPlan?.clueChain[step] ?? "（终局指认）";
  const pending = room.worldState.objectives
    .filter(
      (item) =>
        (item.scope === "session" || item.scope === "scenario") && item.status !== "completed"
    )
    .map((item) => `${item.id}：${item.text}`)
    .join("\n");

  const criteria = room.worldState.resolutionCriteria;

  return [
    "【结案进度·主持人必须据此推进，禁止发散无关悬疑】",
    `线索链进度：${step}/${chainLen}（下一步应揭示：${nextBeat}）`,
    `已登记线索 ${room.worldState.investigationClues.length} 条`,
    pending ? `未完成必做：\n${pending}` : "全部必做已完成——若玩家在对话中成功指认了真凶，必须「胜利收官」；若指认错误，给出否定引导继续推理。",
    criteria
      ? [
          "胜利条件：" + criteria.victoryChecklist.join("；"),
          "自然结案动作：" + criteria.naturalEndAction
        ].join("\n")
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function sessionIndex(id: string) {
  const match = id.match(/^session-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

/** 禁止跳关：session-2 未完成时不得完成 session-3 */
export function enforceObjectiveOrder(
  objectives: MissionObjective[],
  updates: TurnResolution["objectiveUpdates"]
) {
  if (updates.length === 0) {
    return updates;
  }

  const current = new Map(objectives.map((item) => [item.id, item]));

  return updates.map((update) => {
    if (update.status !== "completed" || !update.id.startsWith("session-")) {
      return update;
    }

    const index = sessionIndex(update.id);
    for (let step = 1; step < index; step += 1) {
      const prevId = `session-${step}`;
      const prev = current.get(prevId);
      const prevUpdate = updates.find((item) => item.id === prevId);

      const prevDone =
        prev?.status === "completed" || prevUpdate?.status === "completed";

      if (!prevDone) {
        return {
          ...update,
          status: "pending" as const,
          evidence: `须先完成 ${prevId} 对应调查`
        };
      }
    }

    return update;
  });
}

export function buildNaturalSuccessEndDraft(room: Room, lastNarration: string) {
  const truth =
    room.worldState.mysteryPlan?.hiddenTruth ??
    room.worldState.missionBrief?.coreTruth ??
    "（未记录）";

  return {
    outcome: "success" as const,
    truthRevealed: truth,
    sessionVerdict: room.worldState.objectives
      .filter((item) => item.scope === "session")
      .map((item) => `✅ ${item.text}${item.evidence ? `（${item.evidence}）` : ""}`)
      .join("\n"),
    scenarioVerdict: room.worldState.objectives
      .filter((item) => item.scope === "scenario")
      .map((item) => `✅ ${item.text}${item.evidence ? `（${item.evidence}）` : ""}`)
      .join("\n"),
    epilogue:
      lastNarration.trim() ||
      `在全体玩家的推理下，真相终于水落石出。${truth} 本案以胜利收官。`
  };
}

export function shouldAutoSuccessEnd(room: Room, objectives: MissionObjective[]) {
  if (!allRequiredObjectivesDone(objectives)) {
    return false;
  }

  return room.worldState.objectives.filter((item) => item.scope === "session").length > 0;
}

function isNaturalEndPlayerAction(action: string, naturalEndHint: string) {
  if (
    /公开真相|指认真凶|揭晓真凶|结案|出示.*证据|说明动机|完整推理|投票总结|就是.*凶手|凶手.*就是|是.*杀的|杀人的是|作案的是|指认.*真凶|我认为.*真凶|我觉得.*凶手|真凶.*是/u.test(action)
  ) {
    return true;
  }

  if (
    /指认|真凶|凶手|杀人|作案|罪魁祸首/u.test(action) &&
    /我|认为|觉得|确定|肯定|断定|判定|认定/u.test(action)
  ) {
    return true;
  }

  if (!naturalEndHint) {
    return false;
  }

  const keywords = naturalEndHint
    .replace(/[「」"'']/g, "")
    .split(/[，,、；;]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);

  return keywords.some((keyword) => action.includes(keyword.slice(0, 8)));
}

export function reconcileTurnOutcome(
  room: Room,
  dmResult: TurnResolution,
  objectives: MissionObjective[],
  playerAction: string
): TurnResolution {
  const objectiveUpdates = enforceObjectiveOrder(objectives, dmResult.objectiveUpdates);

  const patchedObjectives = objectives.map((objective) => {
    const update = objectiveUpdates.find((item) => item.id === objective.id);
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

  syncClueChainStep({ ...room, worldState: { ...room.worldState, objectives: patchedObjectives } });

  let gameStatus = dmResult.gameStatus;
  let endDraft = dmResult.endDraft;

  const roomPatched = { ...room, worldState: { ...room.worldState, objectives: patchedObjectives } };

  if (shouldAutoSuccessEnd(roomPatched, patchedObjectives)) {
    const naturalEndAction = room.worldState.resolutionCriteria?.naturalEndAction ?? "";
    const lastActionLooksLikeReveal =
      /公开|指认|真凶|揭晓|真相|结案|说明动机|出示证据|凶手|杀人的|作案/u.test(dmResult.narration) ||
      isNaturalEndPlayerAction(playerAction, naturalEndAction);

    if (gameStatus === "in_progress" && lastActionLooksLikeReveal) {
      gameStatus = "success_end";
      endDraft = buildNaturalSuccessEndDraft(roomPatched, dmResult.narration);
    }
  }

  if (gameStatus === "success_end" && !allRequiredObjectivesDone(patchedObjectives)) {
    gameStatus = "in_progress";
    endDraft = undefined;
  }

  return {
    ...dmResult,
    objectiveUpdates,
    gameStatus,
    endDraft
  };
}

export function parseResolutionCriteria(raw: string): ResolutionCriteria {
  const block = extractSection(raw, "结案条件");
  const victoryBlock = block.match(/胜利[：:]([\s\S]*?)(?=失败|$)/)?.[1] ?? block;
  const failureBlock = block.match(/失败[：:]([\s\S]*?)(?=自然结案|$)/)?.[1] ?? "";

  const victoryChecklist = normalizeBulletLines(victoryBlock.split("\n")).slice(0, 6);

  const failureTriggers = normalizeBulletLines(failureBlock.split("\n")).slice(0, 4);

  const naturalEndAction =
    block.match(/自然结案[：:]\s*(.+)/)?.[1]?.trim() ||
    "全体完成必做后，由一名玩家输入「公开真相并指认真凶，出示关键证据」";

  const suggestedRounds =
    block.match(/建议回合[：:]\s*(.+)/)?.[1]?.trim() || "约 6–10 轮";

  return {
    victoryChecklist:
      victoryChecklist.length > 0
        ? victoryChecklist
        : [
            "完成全部本局必做（session-1～3）",
            "完成全部本剧必做（scenario-1～2）",
            "线索链关键步骤已揭示",
            "执行自然结案动作后胜利收官"
          ],
    failureTriggers:
      failureTriggers.length > 0
        ? failureTriggers
        : ["关键证人死亡且无法翻案", "证据被毁且无法继续调查"],
    naturalEndAction,
    suggestedRounds
  };
}

function extractSection(raw: string, sectionTitle: string) {
  const pattern = new RegExp(
    `##\\s*${sectionTitle}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s*|\\n【地点|$)`,
    "i"
  );
  return raw.match(pattern)?.[1]?.trim() ?? "";
}

export function attachEndReason(report: GameEndReport): GameEndReport {
  return { ...report, endReason: report.endReason ?? "story" };
}
