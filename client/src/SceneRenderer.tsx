import { ReactNode, useState } from "react";
import { InteractiveObject, Room, Scenario, StoryMessage } from "../../shared/types";

const sceneBackdropMap: Partial<Record<Scenario["id"], string>> = {
  "midnight-train": new URL("../../image/ChatGPT Image 2026年5月23日 14_17_27 (1).png", import.meta.url).href,
  "office-dungeon": new URL("../../image/d6584dab-e2e7-49ab-a5b6-a1141afe205c.png", import.meta.url).href,
  "noble-banquet": new URL("../../image/2a8a9631-b205-41fa-a339-654e65eb2821.png", import.meta.url).href
};

const sceneDetailMap: Partial<Record<Scenario["id"], Partial<Record<string, string>>>> = {
  "midnight-train": {
    conductor: new URL("../../image/Snipaste_2026-05-23_14-35-31.png", import.meta.url).href,
    body: new URL("../../image/dc76d1cb-3f10-4425-b740-77c518edcabd.png", import.meta.url).href,
    "shadow-figure": new URL("../../image/1c9a80d8-de3e-4dc3-9820-8c2f31228624.png", import.meta.url).href
  },
  "office-dungeon": {
    "meeting-room": new URL("../../image/43178a45-1d7f-4e35-b720-8fbf2c6be8a5.png", import.meta.url).href,
    pantry: new URL("../../image/c29c4822-cbc3-4171-b421-8bf1386ea24b.png", import.meta.url).href,
    "boss-desk": new URL("../../image/45a368af-02b4-44f9-8988-da0f767d01dd.png", import.meta.url).href
  },
  "noble-banquet": {
    chandelier: new URL("../../image/4d63d793-24a6-46ec-98ce-d5731fb9e6e2.png", import.meta.url).href,
    stage: new URL("../../image/b53af1b4-5be0-4313-8d70-cd952b8ebde5.png", import.meta.url).href,
    "duke-seat": new URL("../../image/5ee83649-f18d-42b6-8308-f68948c3b830.png", import.meta.url).href,
    "balcony-trail": new URL("../../image/27bc414a-c235-489b-8d31-1d414e266be8.png", import.meta.url).href
  }
};

function renderSceneIllustration(scenarioId?: Scenario["id"], hasBackdrop?: boolean): ReactNode {
  if (scenarioId === "midnight-train") {
    if (hasBackdrop) {
      return <div className="backdrop-shimmer" aria-hidden="true" />;
    }
    return (
      <>
        <div className="scene-rain" aria-hidden="true" />
        <div className="scene-rain scene-rain-back" aria-hidden="true" />
        <div className="train-ceiling" aria-hidden="true" />
        <div className="train-lamp" aria-hidden="true" />
        <div className="train-lamp-glow" aria-hidden="true" />
        <div className="train-window window-a" aria-hidden="true" />
        <div className="train-window window-b" aria-hidden="true" />
        <div className="train-window window-c" aria-hidden="true" />
        <div className="train-seat seat-left" aria-hidden="true" />
        <div className="train-seat seat-right" aria-hidden="true" />
        <div className="train-seat seat-back" aria-hidden="true" />
        <div className="train-aisle" aria-hidden="true" />
        <div className="body-shadow" aria-hidden="true" />
        <div className="body-outline" aria-hidden="true" />
        <div className="npc-silhouette npc-conductor" aria-hidden="true" />
        <div className="luggage-case" aria-hidden="true" />
      </>
    );
  }

  if (scenarioId === "office-dungeon") {
    if (hasBackdrop) {
      return <div className="backdrop-shimmer" aria-hidden="true" />;
    }
    return (
      <>
        <div className="office-grid-light" aria-hidden="true" />
        <div className="office-monitor monitor-a" aria-hidden="true" />
        <div className="office-monitor monitor-b" aria-hidden="true" />
        <div className="office-monitor monitor-c" aria-hidden="true" />
        <div className="office-desk desk-a" aria-hidden="true" />
        <div className="office-desk desk-b" aria-hidden="true" />
        <div className="office-glass-room" aria-hidden="true" />
        <div className="office-alert" aria-hidden="true" />
        <div className="office-coffee-spill" aria-hidden="true" />
        <div className="npc-silhouette npc-manager" aria-hidden="true" />
        <div className="sticky-note note-a" aria-hidden="true" />
        <div className="sticky-note note-b" aria-hidden="true" />
      </>
    );
  }

  if (scenarioId === "noble-banquet") {
    if (hasBackdrop) {
      return <div className="backdrop-shimmer" aria-hidden="true" />;
    }
    return (
      <>
        <div className="banquet-curtain curtain-left" aria-hidden="true" />
        <div className="banquet-curtain curtain-right" aria-hidden="true" />
        <div className="banquet-chandelier" aria-hidden="true" />
        <div className="banquet-light" aria-hidden="true" />
        <div className="banquet-table" aria-hidden="true" />
        <div className="banquet-moonlight" aria-hidden="true" />
        <div className="npc-silhouette npc-duke" aria-hidden="true" />
        <div className="npc-silhouette npc-guest" aria-hidden="true" />
        <div className="banquet-sparkle sparkle-a" aria-hidden="true" />
        <div className="banquet-sparkle sparkle-b" aria-hidden="true" />
      </>
    );
  }

  return <div className="scene-placeholder-art" aria-hidden="true" />;
}

function hotspotLabel(item: InteractiveObject) {
  if (item.accent === "danger") return "危险";
  if (item.accent === "mystery") return "线索";
  return "互动";
}

interface Props {
  room: Room;
  selectedObjectId: string;
  focusedSceneObjectId: string;
  onSelectObject: (id: string) => void;
  onFocusObject: (id: string) => void;
  onClearFocus: () => void;
  onRunAction: (action: string) => void;
  loading: boolean;
  narratorMessages?: StoryMessage[];
}

export default function SceneRenderer({
  room, selectedObjectId, focusedSceneObjectId,
  onSelectObject, onFocusObject, onClearFocus, onRunAction, loading, narratorMessages
}: Props) {
  const selectedObject =
    room.worldState.interactiveObjects.find((item) => item.id === selectedObjectId) ?? null;

  const scenarioId = room.scenarioId;
  const sceneBackdrop = sceneBackdropMap[scenarioId];

  // Detail image popup state
  const [detailPopup, setDetailPopup] = useState<{ image: string; name: string } | null>(null);

  const sceneStyle = sceneBackdrop
      ? {
          backgroundImage: `linear-gradient(180deg, rgba(9, 12, 16, 0.14), rgba(9, 12, 16, 0.28)), url("${sceneBackdrop}")`,
          backgroundPosition: "center",
          backgroundSize: "cover"
        } as React.CSSProperties
      : undefined;

  const hasBackdrop = Boolean(sceneBackdrop);

  function handleSelectObject(item: InteractiveObject) {
    onSelectObject(item.id);
    const detailImage = sceneDetailMap[scenarioId]?.[item.id];
    if (detailImage) {
      setDetailPopup({ image: detailImage, name: item.name });
    }
  }

  return (
    <section className="scene-panel">
      <div className="scene-copy">
        <div>
          <p className="eyebrow">Scene Focus</p>
          <h3>{room.worldState.sceneTitle ?? "互动场景"}</h3>
        </div>
        <p>{room.worldState.sceneDescription ?? "开场后，这里会显示当前场景与可交互物件。"}</p>
      </div>

      <div
        className={`scene-board scene-${scenarioId} ${hasBackdrop ? "has-backdrop" : ""}`}
        style={sceneStyle}
      >
        {renderSceneIllustration(scenarioId, hasBackdrop)}
        <div className="scene-vignette" aria-hidden="true" />

        {room.worldState.interactiveObjects.map((item) => (
            <button
              key={item.id}
              type="button"
              data-hotspot-id={item.id}
              className={`hotspot hotspot-${item.accent ?? "neutral"} ${
                selectedObjectId === item.id ? "is-selected" : ""
              }`}
              style={{ left: `${item.x}%`, top: `${item.y}%` }}
              onClick={() => handleSelectObject(item)}
            >
              {hasBackdrop ? (
                <>
                  <span className="hotspot-hit" aria-hidden="true" />
                  <span className="hotspot-caption">
                    <strong>{item.name}</strong>
                    <small>{hotspotLabel(item)}</small>
                  </span>
                </>
              ) : (
                <>
                  <span>{item.name}</span>
                  <small>{hotspotLabel(item)}</small>
                </>
              )}
            </button>
          ))}

        {narratorMessages && narratorMessages.length > 0 && (
          <div className="narrator-overlay" id="narrator-scroll">
            <div className="narrator-content">
            {narratorMessages.map((m, i) => (
              <div key={m.id || i} className="narrator-msg">
                <div className="narrator-label">AI 主持人</div>
                <div className="narrator-text">{m.content}</div>
              </div>
            ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail image popup */}
      {detailPopup && (
        <div className="detail-popup-overlay" onClick={() => setDetailPopup(null)}>
          <div className="detail-popup" onClick={(e) => e.stopPropagation()}>
            <div className="detail-popup-header">
              <strong>{detailPopup.name}</strong>
              <button type="button" className="detail-popup-close" onClick={() => setDetailPopup(null)}>✕</button>
            </div>
            <img src={detailPopup.image} alt={detailPopup.name} className="detail-popup-image" />
          </div>
        </div>
      )}
    </section>
  );
}
