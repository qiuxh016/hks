import {
  AccusationMeta,
  AccusationOption,
  AccusationResultPayload,
  GameEndReport,
  Room
} from "../shared/types";
import { createDeepSeekReply } from "./dm";
import { endGame, getRoom, updateRoom } from "./store";

function extractSection(raw: string, sectionTitle: string) {
  const pattern = new RegExp(
    `##\\s*${sectionTitle}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s*|$)`,
    "i"
  );
  const match = raw.match(pattern);
  return match?.[1]?.trim() ?? "";
}

export function formatAccusationLabel(player: Room["players"][number]) {
  const role = player.roleCard?.role;
  return role ? `${player.name}（${role}）` : player.name;
}

export function buildAccusationOptions(room: Room): AccusationOption[] {
  return room.players.map((player) => ({
    playerId: player.id,
    label: formatAccusationLabel(player)
  }));
}

function matchCulpritHeuristic(room: Room, truth: string): AccusationMeta | null {
  const normalizedTruth = truth.replace(/\s/g, "");

  for (const player of room.players) {
    const labels = [player.name, player.roleCard?.role].filter(Boolean) as string[];

    for (const label of labels) {
      if (label.length < 2) {
        continue;
      }

      if (truth.includes(label) || normalizedTruth.includes(label.replace(/\s/g, ""))) {
        return {
          correctPlayerIds: [player.id],
          correctLabels: labels,
          resolvedAt: new Date().toISOString()
        };
      }
    }
  }

  return null;
}

export async function resolveAccusationMeta(room: Room): Promise<AccusationMeta> {
  const existing = room.worldState.accusationMeta;
  if (existing?.correctPlayerIds.length) {
    return existing;
  }

  const truth =
    room.worldState.mysteryPlan?.hiddenTruth ??
    room.worldState.missionBrief?.coreTruth ??
    "";

  const heuristic = matchCulpritHeuristic(room, truth);
  if (heuristic) {
    return heuristic;
  }

  const roster = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    role: player.roleCard?.role ?? "未知"
  }));

  const raw = await createDeepSeekReply(
    [
      {
        role: "system",
        content: [
          "你是推理游戏裁判。根据「隐藏真相」从玩家名单中确定真凶（一人）。",
          "只输出 Markdown：",
          "## 真凶玩家ID",
          "（必须是名单中某人的 id）",
          "## 真凶",
          "（姓名或角色名）"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `隐藏真相：${truth}`,
          "",
          "玩家名单：",
          roster.map((item) => `- id=${item.id} 姓名=${item.name} 角色=${item.role}`).join("\n"),
          "",
          "请指认真凶："
        ].join("\n")
      }
    ],
    { maxTokens: 120, temperature: 0.15 }
  );

  const idFromLlm = extractSection(raw, "真凶玩家ID").replace(/[`'"]/g, "").trim();
  const labelFromLlm = extractSection(raw, "真凶");

  const byId = room.players.find((player) => player.id === idFromLlm);
  const byLabel = room.players.find(
    (player) =>
      player.name === labelFromLlm ||
      player.roleCard?.role === labelFromLlm ||
      formatAccusationLabel(player) === labelFromLlm
  );

  const culprit = byId ?? byLabel ?? room.players[0];

  return {
    correctPlayerIds: [culprit.id],
    correctLabels: [culprit.name, culprit.roleCard?.role ?? ""].filter(Boolean),
    resolvedAt: new Date().toISOString()
  };
}

export function isAccusationCorrect(room: Room, accusedPlayerId: string) {
  const meta = room.worldState.accusationMeta;
  if (!meta) {
    return false;
  }

  return meta.correctPlayerIds.includes(accusedPlayerId);
}

export function getCorrectCulpritName(room: Room) {
  const meta = room.worldState.accusationMeta;
  const culpritId = meta?.correctPlayerIds[0];
  const player = room.players.find((item) => item.id === culpritId);
  return player ? formatAccusationLabel(player) : meta?.correctLabels[0] ?? "未知";
}

export function buildAccusationEndReport(
  room: Room,
  accusedPlayerId: string,
  correct: boolean
): GameEndReport {
  const accused = room.players.find((player) => player.id === accusedPlayerId);
  const accusedName = accused ? formatAccusationLabel(accused) : "未知";
  const truth =
    room.worldState.mysteryPlan?.hiddenTruth ??
    room.worldState.missionBrief?.coreTruth ??
    "（未记录）";
  const realCulprit = getCorrectCulpritName(room);
  const verdict = correct ? "推理成功" : "推理错误";

  const epilogue = correct
    ? `经全体公投，你们指认「${accusedName}」为真凶，与隐藏真相一致。${realCulprit}的罪行就此揭开，本案圆满告破。`
    : `经全体公投，你们指认「${accusedName}」为真凶，但真相并非如此。真凶实为「${realCulprit}」。${truth}`;

  return {
    gameInstanceId: room.gameInstanceId,
    outcome: correct ? "success" : "failure",
    endedAt: new Date().toISOString(),
    truthRevealed: truth,
    sessionVerdict: correct
      ? `✅ 指认真凶投票：${verdict}（指认「${accusedName}」）`
      : `❌ 指认真凶投票：${verdict}（指认「${accusedName}」，真凶为「${realCulprit}」）`,
    scenarioVerdict: correct
      ? "✅ 提前结案：推理指认正确"
      : "❌ 提前结案：推理指认错误",
    epilogue,
    endReason: "accusation",
    accusationVerdict: verdict,
    accusedName
  };
}

export function pickAccusationWinner(
  options: AccusationOption[],
  votes: Map<string, string>
): { playerId: string; label: string } | null {
  const tally = new Map<string, number>();

  for (const option of options) {
    tally.set(option.playerId, 0);
  }

  for (const accusedId of votes.values()) {
    tally.set(accusedId, (tally.get(accusedId) ?? 0) + 1);
  }

  let bestId = "";
  let bestCount = -1;

  for (const [playerId, count] of tally.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestId = playerId;
    }
  }

  if (!bestId || bestCount <= 0) {
    return null;
  }

  const option = options.find((item) => item.playerId === bestId);
  return option ? { playerId: option.playerId, label: option.label } : null;
}

export function buildAccusationTally(
  options: AccusationOption[],
  votes: Map<string, string>
): Record<string, number> {
  const tally: Record<string, number> = {};

  for (const option of options) {
    tally[option.label] = 0;
  }

  for (const accusedId of votes.values()) {
    const option = options.find((item) => item.playerId === accusedId);
    if (option) {
      tally[option.label] = (tally[option.label] ?? 0) + 1;
    }
  }

  return tally;
}

export async function finalizeAccusationVote(
  roomId: string,
  votes: Map<string, string>,
  options: AccusationOption[]
): Promise<AccusationResultPayload | null> {
  const room = getRoom(roomId);
  if (!room || room.status !== "in_progress") {
    return null;
  }

  if (!room.worldState.accusationMeta) {
    const meta = await resolveAccusationMeta(room);
    updateRoom(roomId, (draft) => {
      draft.worldState.accusationMeta = meta;
    });
  }

  const latest = getRoom(roomId)!;
  const winner = pickAccusationWinner(options, votes);

  if (!winner) {
    return null;
  }

  const correct = isAccusationCorrect(latest, winner.playerId);
  const report = buildAccusationEndReport(latest, winner.playerId, correct);
  endGame(roomId, report);

  return {
    gameInstanceId: latest.gameInstanceId,
    correct,
    verdict: report.accusationVerdict ?? (correct ? "推理成功" : "推理错误"),
    accusedName: winner.label,
    accusedPlayerId: winner.playerId,
    tally: buildAccusationTally(options, votes),
    truthRevealed: report.truthRevealed
  };
}

export async function ensureAccusationMeta(roomId: string) {
  const room = getRoom(roomId);
  if (!room) {
    throw new Error("房间不存在");
  }

  if (room.worldState.accusationMeta?.correctPlayerIds.length) {
    return room.worldState.accusationMeta;
  }

  const meta = await resolveAccusationMeta(room);
  updateRoom(roomId, (draft) => {
    draft.worldState.accusationMeta = meta;
  });

  return meta;
}
