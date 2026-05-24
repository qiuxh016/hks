import { Link } from "react-router-dom";
import {
  GameBehaviorReviews,
  GameEndReport,
  HumanBehaviorReview,
  Room
} from "../../../shared/types";
import { isBehaviorReviewsGenerating } from "../outcomeNavigation";
import { canOpenFullMysteryReveal } from "../revealNavigation";

export interface GameReviewsPageProps {
  room: Room | null;
  reviews: GameBehaviorReviews | null;
  gameEnd: GameEndReport | null;
  activePlayerId: string;
  onExitGame: () => void;
}

function outcomeHeadline(gameEnd: GameEndReport | null) {
  if (!gameEnd) {
    return null;
  }

  if (gameEnd.endReason === "accusation") {
    return gameEnd.outcome === "success"
      ? `✅ ${gameEnd.accusationVerdict ?? "推理成功"}`
      : `❌ ${gameEnd.accusationVerdict ?? "推理错误"}`;
  }

  return gameEnd.outcome === "success" ? "🏆 本局胜利收官" : "💀 本局失败收官";
}

function ReviewCard({
  review,
  isSelf
}: {
  review: HumanBehaviorReview;
  isSelf: boolean;
}) {
  return (
    <article className={`review-card ${isSelf ? "is-self" : ""}`}>
      <header className="review-card-header">
        <div>
          <h3>
            {review.playerName}
            {isSelf && <span className="review-self-badge">你</span>}
          </h3>
          {review.role && <p className="muted review-role">{review.role}</p>}
        </div>
        {review.tags.length > 0 && (
          <ul className="review-tags">
            {review.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
      </header>

      <div className="review-section">
        <h4>亮点</h4>
        <p>{review.highlights}</p>
      </div>

      <div className="review-section">
        <h4>可改进</h4>
        <p>{review.improvements}</p>
      </div>

      <div className="review-section">
        <h4>综合评价</h4>
        <p>{review.summary}</p>
      </div>
    </article>
  );
}

export default function GameReviewsPage({
  room,
  reviews,
  gameEnd,
  activePlayerId,
  onExitGame
}: GameReviewsPageProps) {
  const humans = room?.players.filter((player) => player.kind === "human") ?? [];
  const headline = outcomeHeadline(gameEnd);
  const isGenerating = isBehaviorReviewsGenerating(room);
  const isReady = Boolean(
    reviews?.status === "ready" && reviews.reviews.length > 0 && !isGenerating
  );
  const reviewList = reviews?.reviews ?? [];
  const showRevealLink = canOpenFullMysteryReveal(room);

  return (
    <main className="reviews-page">
      <div className="reviews-page-inner">
        <header className="reviews-header">
          <p className="eyebrow">对局复盘</p>
          <h1>真人玩家行为点评</h1>
          <p className="muted reviews-subtitle">
            本局所有真人玩家的点评会显示在同一页面，便于互相参考与复盘。
          </p>
          {room && (
            <p className="muted reviews-room-meta">
              房间 {room.id} · {humans.length} 位真人
            </p>
          )}
          {headline && <p className="reviews-outcome-line">{headline}</p>}
        </header>

        {!room && (
          <section className="reviews-card">
            <p>请先加入房间并完成一局游戏。</p>
            <Link to="/" className="outcome-btn outcome-btn-secondary">
              返回大厅
            </Link>
          </section>
        )}

        {room && isGenerating && (
          <section className="reviews-card reviews-loading" aria-busy="true">
            <div className="reviews-spinner" aria-hidden="true" />
            <p className="reviews-loading-title">点评生成中…</p>
            <p className="muted">
              AI 正在根据本局每位真人的行动撰写点评，请稍候（通常十几秒内完成）。
            </p>
          </section>
        )}

        {room && !isGenerating && reviews?.status === "failed" && !isReady && (
          <section className="reviews-card reviews-error">
            <p>点评生成遇到问题：{reviews.errorMessage ?? "未知错误"}</p>
          </section>
        )}

        {room && isReady && (
          <div className="reviews-grid">
            {reviewList.map((review) => (
              <ReviewCard
                key={review.playerId}
                review={review}
                isSelf={review.playerId === activePlayerId}
              />
            ))}
          </div>
        )}

        {room && !isGenerating && !isReady && humans.length === 0 && (
          <section className="reviews-card">
            <p className="muted">本局没有真人玩家，暂无行为点评。</p>
          </section>
        )}

        <footer className="reviews-actions">
          {showRevealLink && (
            <Link to="/reveal" className="outcome-btn outcome-btn-secondary">
              查看故事谜底
            </Link>
          )}
          <button type="button" className="outcome-btn outcome-btn-exit" onClick={onExitGame}>
            退出游戏，返回大厅
          </button>
        </footer>
      </div>
    </main>
  );
}
