import { GameBehaviorReviews, Room } from "../../shared/types";

export function gameEndMatchesCurrentRun(room: Room): boolean {
  const report = room.worldState.gameEnd;
  if (!report?.gameInstanceId) {
    return true;
  }
  return report.gameInstanceId === room.gameInstanceId;
}

export function behaviorReviewsMatchCurrentRun(room: Room): boolean {
  const bundle = room.worldState.behaviorReviews;
  if (!bundle?.gameInstanceId) {
    return true;
  }
  return bundle.gameInstanceId === room.gameInstanceId;
}

export function isBehaviorReviewsGenerating(room: Room | null) {
  if (!room || room.status !== "ended") {
    return false;
  }

  const hasHumans = room.players.some((player) => player.kind === "human");
  if (!hasHumans) {
    return false;
  }

  const bundle = room.worldState.behaviorReviews;
  if (!bundle || !behaviorReviewsMatchCurrentRun(room)) {
    return true;
  }

  return bundle.status === "pending";
}

export function resolveActiveBehaviorReviews(room: Room | null): GameBehaviorReviews | null {
  if (!room || room.status !== "ended") {
    return null;
  }

  const bundle = room.worldState.behaviorReviews;
  if (bundle && behaviorReviewsMatchCurrentRun(room)) {
    return bundle;
  }

  if (room.players.some((player) => player.kind === "human")) {
    return {
      gameInstanceId: room.gameInstanceId,
      status: "pending",
      reviews: []
    };
  }

  return null;
}

/** 指认投票进行中：进入结案页 */
export function shouldNavigateToOutcomePage(
  room: Room | null,
  options: {
    accusationVoteActive: boolean;
    accusationResultActive: boolean;
  }
): boolean {
  if (!room || room.status === "ended") {
    return false;
  }

  return options.accusationVoteActive || options.accusationResultActive;
}

/** 对局已结束：进入全员行为点评页 */
export function shouldNavigateToReviewsPage(room: Room | null): boolean {
  if (!room) {
    return false;
  }

  return room.status === "ended";
}

export function resolveActiveGameEnd(room: Room | null) {
  if (!room || room.status !== "ended") {
    return null;
  }

  const report = room.worldState.gameEnd;
  if (!report) {
    return null;
  }

  return gameEndMatchesCurrentRun(room) ? report : null;
}
