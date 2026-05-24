import { FormEvent } from "react";
import { Link } from "react-router-dom";
import { GameEndReport, Room } from "../../../shared/types";
import { AccusationResultPayload, AccusationVoteState } from "../useSocket";

export interface GameOutcomePageProps {
  room: Room | null;
  gameEnd: GameEndReport | null;
  /** 房间已结束但收官报告尚未同步到客户端 */
  gameEndPending?: boolean;
  gameEndMatchesCurrentRun: boolean;
  accusationVote: AccusationVoteState | null;
  accusationVoteActive: boolean;
  accusationChoice: string;
  accusationVoters: string[];
  accusationResult: AccusationResultPayload | null;
  accusationResultActive: boolean;
  accusationLoading: boolean;
  canVoteAccusation: boolean;
  canLaunchAccusation: boolean;
  aiReady: boolean;
  error: string;
  onAccusationChoiceChange: (playerId: string) => void;
  onAccusationSubmit: (event: FormEvent) => void;
  onStartAccusation: () => void;
  onExitGame: () => void;
}

export default function GameOutcomePage({
  room,
  gameEnd,
  gameEndPending = false,
  gameEndMatchesCurrentRun,
  accusationVote,
  accusationVoteActive,
  accusationChoice,
  accusationVoters,
  accusationResult,
  accusationResultActive,
  accusationLoading,
  canVoteAccusation,
  canLaunchAccusation,
  aiReady,
  error,
  onAccusationChoiceChange,
  onAccusationSubmit,
  onStartAccusation,
  onExitGame
}: GameOutcomePageProps) {
  const showGameEnd = Boolean(room?.status === "ended");
  const showGameEndDetails = Boolean(showGameEnd && gameEnd && gameEndMatchesCurrentRun);
  const isAccusationEnd = gameEnd?.endReason === "accusation";
  const isSuccess = gameEnd?.outcome === "success";

  return (
    <main className="outcome-page">
      <div className="outcome-page-inner">
        <header className="outcome-header">
          <p className="eyebrow">本局结案</p>
          <h1>{showGameEnd ? "对局已结束" : "指认真凶 / 投票结案"}</h1>
          {room && (
            <p className="muted outcome-room-meta">
              房间 {room.id} · {room.worldState.currentLocation}
            </p>
          )}
        </header>

        {!room && (
          <section className="outcome-card">
            <p>请先在大厅加入或创建房间。</p>
            <Link to="/" className="outcome-btn outcome-btn-secondary">
              返回大厅
            </Link>
          </section>
        )}

        {showGameEnd && gameEndPending && !gameEnd && (
          <section className="outcome-card outcome-hero is-victory">
            <h2 className="outcome-hero-title">🏆 本局已收官</h2>
            <p className="muted">主持人正在整理胜利/失败结论与结局叙事，请稍候…</p>
          </section>
        )}

        {showGameEndDetails && gameEnd && (
          <section
            className={`outcome-card outcome-hero ${
              isAccusationEnd
                ? isSuccess
                  ? "is-accusation-success"
                  : "is-accusation-failure"
                : isSuccess
                  ? "is-victory"
                  : "is-defeat"
            }`}
          >
            <h2 className="outcome-hero-title">
              {isAccusationEnd ? (
                isSuccess ? (
                  <>✅ {gameEnd.accusationVerdict ?? "推理成功"}</>
                ) : (
                  <>❌ {gameEnd.accusationVerdict ?? "推理错误"}</>
                )
              ) : isSuccess ? (
                "🏆 本局胜利收官"
              ) : (
                "💀 本局失败收官"
              )}
            </h2>

            {gameEnd.accusedName && (
              <p className="outcome-lead">公投指认：{gameEnd.accusedName}</p>
            )}

            <div className="outcome-block">
              <h3>真相揭晓</h3>
              <p>{gameEnd.truthRevealed}</p>
            </div>

            <div className="outcome-block">
              <h3>本局必做完成情况</h3>
              <p className="outcome-pre">{gameEnd.sessionVerdict}</p>
            </div>

            <div className="outcome-block">
              <h3>本剧必做完成情况</h3>
              <p className="outcome-pre">{gameEnd.scenarioVerdict}</p>
            </div>

            <div className="outcome-block">
              <h3>结局</h3>
              <p>{gameEnd.epilogue}</p>
            </div>
          </section>
        )}

        {!showGameEnd && accusationResultActive && accusationResult && (
          <section
            className={`outcome-card outcome-hero ${
              accusationResult.correct ? "is-accusation-success" : "is-accusation-failure"
            }`}
          >
            <h2 className="outcome-hero-title">
              {accusationResult.correct ? "✅ 推理成功" : "❌ 推理错误"}
            </h2>
            <p className="outcome-lead">指认：{accusationResult.accusedName}</p>
            {Object.entries(accusationResult.tally).map(([label, count]) => (
              <p key={label}>
                {label}：{count} 票
              </p>
            ))}
            <p className="muted">真相：{accusationResult.truthRevealed}</p>
            <p className="muted">主持人正在撰写收官，请稍候…</p>
          </section>
        )}

        {!showGameEnd && accusationVoteActive && accusationVote && (
          <section className="outcome-card">
            <h2>指认真凶投票</h2>
            <p className="vote-question">{accusationVote.question}</p>
            <p className="muted">由 {accusationVote.initiatedBy} 发起 · 全体真人投票后多数票结案</p>

            <form onSubmit={onAccusationSubmit} className="stack outcome-form">
              {accusationVote.options.map((opt) => (
                <label key={opt.playerId} className="vote-option">
                  <input
                    type="radio"
                    name="accusation"
                    value={opt.playerId}
                    checked={accusationChoice === opt.playerId}
                    onChange={() => onAccusationChoiceChange(opt.playerId)}
                    disabled={!canVoteAccusation}
                  />
                  {opt.label}
                </label>
              ))}

              <button type="submit" disabled={!accusationChoice || !canVoteAccusation}>
                投票指认
              </button>
            </form>

            {accusationVoters.length > 0 && (
              <p className="muted">已投票：{accusationVoters.join("、")}</p>
            )}
          </section>
        )}

        {!showGameEnd &&
          !accusationVoteActive &&
          !accusationResultActive &&
          room?.status === "in_progress" && (
            <section className="outcome-card">
              <h2>提前结案</h2>
              <p className="muted">
                建议先按对局内「结案进度」完成必做并走自然结案。若全体已准备好，可发起投票指认真凶，猜对为推理成功，猜错为推理错误。
              </p>
              {canLaunchAccusation && (
                <button
                  type="button"
                  className="outcome-btn outcome-btn-primary"
                  onClick={() => void onStartAccusation()}
                  disabled={accusationLoading || !aiReady}
                >
                  {accusationLoading ? "发起中…" : "⚖️ 发起指认真凶投票"}
                </button>
              )}
              {!canLaunchAccusation && (
                <p className="muted">仅真人玩家可发起投票。</p>
              )}
            </section>
          )}

        {error && <p className="error-text outcome-error">{error}</p>}

        <footer className="outcome-actions">
          {showGameEnd && (
            <>
              <Link to="/reveal" className="outcome-btn outcome-btn-primary">
                查看故事谜底
              </Link>
              <Link to="/reviews" className="outcome-btn outcome-btn-secondary">
                查看全员行为点评
              </Link>
            </>
          )}
          {showGameEnd ? (
            <button type="button" className="outcome-btn outcome-btn-exit" onClick={onExitGame}>
              退出游戏，返回大厅
            </button>
          ) : (
            room?.status === "in_progress" && (
              <Link to="/" className="outcome-btn outcome-btn-secondary">
                返回对局
              </Link>
            )
          )}
        </footer>
      </div>
    </main>
  );
}
