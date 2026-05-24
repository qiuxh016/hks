import { FullMysteryReveal, GameEndReport, Room } from "../../../shared/types";
import { isMysteryRevealGenerating, parseRevealSections } from "../revealNavigation";

export interface GameRevealPageProps {
  room: Room | null;
  reveal: FullMysteryReveal | null;
  gameEnd: GameEndReport | null;
  onBack: () => void;
}

function getOpeningBriefExcerpt(room: Room) {
  const briefMessage = room.messages.find(
    (message) =>
      message.variant === "brief" &&
      (message.speaker === "AI主持人" || message.speaker.includes("主持人"))
  );

  if (briefMessage?.content.trim()) {
    return briefMessage.content.trim();
  }

  const mission = room.worldState.missionBrief;
  if (!mission) {
    return "";
  }

  return [
    mission.storyDirection,
    mission.coreTruth ? `核心矛盾：${mission.coreTruth}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export default function GameRevealPage({ room, reveal, onBack }: GameRevealPageProps) {
  const isGenerating = isMysteryRevealGenerating(room);
  const isReady = Boolean(reveal?.status === "ready" && reveal.content.trim());
  const sections = isReady ? parseRevealSections(reveal!.content) : [];
  const openingExcerpt = room ? getOpeningBriefExcerpt(room) : "";

  return (
    <main className="reveal-page">
      <div className="reveal-page-inner">
        <header className="reveal-header">
          <p className="eyebrow">本局复盘</p>
          <h1>故事谜底</h1>
          <p className="muted reveal-subtitle">
            根据本局开场简报与剧情设定生成的完整真相说明。
          </p>
        </header>

        {!room && (
          <section className="reveal-card">
            <p>暂无对局信息。</p>
            <button type="button" className="outcome-btn outcome-btn-secondary" onClick={onBack}>
              返回上一页
            </button>
          </section>
        )}

        {room && openingExcerpt && (
          <section className="reveal-card reveal-opening">
            <h2>本局开场</h2>
            <div className="reveal-section-body">{openingExcerpt}</div>
          </section>
        )}

        {room && isGenerating && (
          <section className="reveal-card reveal-loading" aria-busy="true">
            <div className="reviews-spinner" aria-hidden="true" />
            <p className="reviews-loading-title">故事谜底生成中…</p>
            <p className="muted">正在根据开场简报整理完整谜底，请稍候。</p>
          </section>
        )}

        {room && isReady && (
          <article className="reveal-card reveal-body">
            <h2 className="reveal-body-title">完整故事谜底</h2>
            {sections.map((section) => (
              <section key={section.title} className="reveal-section">
                <h3>{section.title}</h3>
                <div className="reveal-section-body">{section.body}</div>
              </section>
            ))}
          </article>
        )}

        <footer className="reveal-actions">
          <button type="button" className="outcome-btn outcome-btn-secondary reveal-back-btn" onClick={onBack}>
            返回上一页
          </button>
        </footer>
      </div>
    </main>
  );
}
