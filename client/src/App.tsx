import { FormEvent, ReactNode, useEffect, useState } from "react";
import { InteractiveObject, Room, Scenario } from "../../shared/types";
import { createRoom, fetchRoom, fetchScenarios, joinRoom, startRoom, submitTurn } from "./api";

const sceneBackdropMap: Partial<Record<Scenario["id"], string>> = {
  "midnight-train": new URL("../../image/ChatGPT Image 2026年5月23日 14_17_27 (1).png", import.meta.url).href
};

const sceneDetailMap: Partial<Record<Scenario["id"], Partial<Record<string, string>>>> = {
  "midnight-train": {
    conductor: new URL("../../image/Snipaste_2026-05-23_14-35-31.png", import.meta.url).href,
    body: new URL("../../image/dc76d1cb-3f10-4425-b740-77c518edcabd.png", import.meta.url).href,
    "shadow-figure": new URL("../../image/1c9a80d8-de3e-4dc3-9820-8c2f31228624.png", import.meta.url).href
  }
};

function renderSceneIllustration(scenarioId?: Scenario["id"], hasBackdrop?: boolean): ReactNode {
  if (scenarioId === "midnight-train") {
    if (hasBackdrop) {
      return <div className="backdrop-shimmer" aria-hidden="true" />;
    }

    return (
      <>
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
      </>
    );
  }

  if (scenarioId === "office-dungeon") {
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

function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [hostName, setHostName] = useState("Elsa");
  const [joinName, setJoinName] = useState("桑耳");
  const [roomCode, setRoomCode] = useState("");
  const [selectedScenario, setSelectedScenario] = useState<Scenario["id"]>("midnight-train");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [focusedSceneObjectId, setFocusedSceneObjectId] = useState("");

  useEffect(() => {
    fetchScenarios()
      .then((data) => {
        setScenarios(data);
        if (data[0]) {
          setSelectedScenario(data[0].id);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!room?.id) {
      return;
    }

    const timer = window.setInterval(() => {
      fetchRoom(room.id)
        .then(setRoom)
        .catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [room?.id]);

  useEffect(() => {
    if (!room?.worldState.interactiveObjects.length) {
      return;
    }

    const hasSelected = room.worldState.interactiveObjects.some((item) => item.id === selectedObjectId);
    if (!hasSelected) {
      setSelectedObjectId(room.worldState.interactiveObjects[0].id);
    }
  }, [room?.worldState.interactiveObjects, selectedObjectId]);

  useEffect(() => {
    setFocusedSceneObjectId("");
  }, [room?.scenarioId, selectedScenario]);

  async function handleCreateRoom(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const session = await createRoom({
        hostName,
        scenarioId: selectedScenario
      });
      setRoom(session.room);
      setPlayerId(session.playerId);
      setRoomCode(session.room.id);
      setFocusedSceneObjectId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const session = await joinRoom(roomCode, {
        playerName: joinName
      });
      setRoom(session.room);
      setPlayerId(session.playerId);
      setFocusedSceneObjectId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    if (!room) {
      return;
    }

    try {
      setLoading(true);
      const nextRoom = await startRoom(room.id);
      setRoom({ ...nextRoom });
    } catch (err) {
      setError(err instanceof Error ? err.message : "开始失败");
    } finally {
      setLoading(false);
    }
  }

  async function runAction(nextAction: string) {
    if (!room || !playerId || !nextAction.trim()) {
      return;
    }

    try {
      setLoading(true);
      const nextRoom = await submitTurn(room.id, {
        playerId,
        content: nextAction.trim()
      });
      setRoom({ ...nextRoom });
      setAction("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitTurn(event: FormEvent) {
    event.preventDefault();
    await runAction(action);
  }

  function hotspotLabel(item: InteractiveObject) {
    if (item.accent === "danger") {
      return "危险";
    }

    if (item.accent === "mystery") {
      return "线索";
    }

    return "互动";
  }

  function handleSelectObject(item: InteractiveObject) {
    setSelectedObjectId(item.id);
    const detailImage = sceneDetailMap[activeScenarioId]?.[item.id];
    if (detailImage) {
      setFocusedSceneObjectId(item.id);
    }
  }

  const me = room?.players.find((player) => player.id === playerId);
  const selectedObject =
    room?.worldState.interactiveObjects.find((item) => item.id === selectedObjectId) ?? null;
  const activeScenarioId = room?.scenarioId ?? selectedScenario;
  const sceneBackdrop = sceneBackdropMap[activeScenarioId];
  const focusedImage = focusedSceneObjectId ? sceneDetailMap[activeScenarioId]?.[focusedSceneObjectId] : undefined;
  const sceneStyle =
    focusedImage
      ? {
          backgroundImage: `linear-gradient(180deg, rgba(9, 12, 16, 0.08), rgba(9, 12, 16, 0.18)), url("${focusedImage}")`,
          backgroundPosition:
            activeScenarioId === "midnight-train" && focusedSceneObjectId === "conductor"
              ? "center 18%"
              : "center",
          backgroundSize:
            activeScenarioId === "midnight-train" && focusedSceneObjectId === "conductor"
              ? "cover"
              : "cover",
          backgroundRepeat: "no-repeat"
        }
      : sceneBackdrop
        ? {
            backgroundImage: `linear-gradient(180deg, rgba(9, 12, 16, 0.14), rgba(9, 12, 16, 0.28)), url("${sceneBackdrop}")`,
            backgroundPosition: "center",
            backgroundSize: "cover"
          }
        : undefined;

  const focusedObject =
    room?.worldState.interactiveObjects.find((item) => item.id === focusedSceneObjectId) ?? null;

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">AI Improvised Adventure</p>
        <h1>AI 地下城</h1>
        <p className="hero-copy">
          现在点主场景里的乘务员、尸体或窗外黑影后，画面会直接切到对应特写图，再从特写里回到整节车厢。
        </p>
      </section>

      <section className="grid">
        <aside className="panel controls">
          <h2>房间操作</h2>

          <form onSubmit={handleCreateRoom} className="stack">
            <label>
              你的名字
              <input value={hostName} onChange={(event) => setHostName(event.target.value)} />
            </label>

            <label>
              剧本模式
              <select
                value={selectedScenario}
                onChange={(event) => setSelectedScenario(event.target.value as Scenario["id"])}
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.title} · {scenario.tone}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" disabled={loading}>
              创建房间
            </button>
          </form>

          <form onSubmit={handleJoinRoom} className="stack join-form">
            <label>
              房间号
              <input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} />
            </label>

            <label>
              加入玩家名
              <input value={joinName} onChange={(event) => setJoinName(event.target.value)} />
            </label>

            <button type="submit" disabled={loading || !roomCode}>
              加入房间
            </button>
          </form>

          {room && (
            <div className="status-card">
              <p>房间号：{room.id}</p>
              <p>状态：{room.status}</p>
              <p>场景：{scenarios.find((item) => item.id === room.scenarioId)?.title ?? room.scenarioId}</p>
              <p>当前地点：{room.worldState.currentLocation}</p>
              <p>紧张度：{room.worldState.tension} / 10</p>
              <p>回合数：{room.worldState.round}</p>
              {room.status === "lobby" && (
                <button onClick={handleStart} disabled={loading}>
                  开始游戏
                </button>
              )}
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
        </aside>

        <section className="panel story-panel">
          <div className="panel-header">
            <h2>故事舞台</h2>
            <span>先点人，再切特写，再回来继续推剧情</span>
          </div>

          <section className="scene-panel">
            <div className="scene-copy">
              <div>
                <p className="eyebrow">Scene Focus</p>
                <h3>{room?.worldState.sceneTitle ?? "互动场景"}</h3>
              </div>
              <p>{room?.worldState.sceneDescription ?? "开场后，这里会显示当前场景与可交互物件。"}</p>
            </div>

            <div
              className={`scene-board scene-${activeScenarioId} ${sceneBackdrop ? "has-backdrop" : ""} ${
                focusedImage ? "is-focused-view" : ""
              }`}
              style={sceneStyle}
            >
              {renderSceneIllustration(activeScenarioId, Boolean(sceneBackdrop || focusedImage))}
              <div className="scene-vignette" aria-hidden="true" />

              {focusedImage && focusedObject ? (
                <div className="scene-focus-header">
                  <div>
                    <p className="eyebrow">Close View</p>
                    <strong>{focusedObject.name}</strong>
                  </div>
                  <button
                    type="button"
                    className="scene-back-button"
                    onClick={() => setFocusedSceneObjectId("")}
                  >
                    返回车厢
                  </button>
                </div>
              ) : null}

              {!focusedImage &&
                room?.worldState.interactiveObjects.map((item) => (
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
                    <span className="hotspot-hit" aria-hidden="true" />
                    <span className="hotspot-caption">
                      <strong>{item.name}</strong>
                      <small>{hotspotLabel(item)}</small>
                    </span>
                  </button>
                ))}
            </div>

            <div className="scene-footer">
              <div className="object-detail">
                {selectedObject ? (
                  <>
                    <p className="eyebrow">Selected</p>
                    <h4>{selectedObject.name}</h4>
                    <p>{selectedObject.description}</p>
                    <p className="object-status">状态：{selectedObject.status}</p>
                  </>
                ) : (
                  <>
                    <p className="eyebrow">Selected</p>
                    <h4>点击一个场景人物</h4>
                    <p>点击后会优先切到这张人物或线索的特写图，再决定下一步操作。</p>
                  </>
                )}
              </div>

              <div className="quick-actions">
                <p className="eyebrow">Quick Actions</p>
                <div className="quick-action-list">
                  {(selectedObject?.actions ?? ["观察四周", "试探队友", "整理线索"]).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="ghost-button"
                      onClick={() => runAction(preset)}
                      disabled={room?.status !== "in_progress" || loading}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="message-list">
            {room?.messages.map((message) => (
              <article key={message.id} className={`message message-${message.type}`}>
                <p className="message-speaker">{message.speaker}</p>
                <p>{message.content}</p>
              </article>
            ))}

            {!room && (
              <div className="empty-state">
                <p>先创建或加入一个房间。</p>
                <p>这版重点是把“点场景人物、看特写、继续互动”这条链路做顺。</p>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmitTurn} className="action-bar">
            <input
              placeholder="输入你的行动，例如：我搜查尸体 / 我盘问乘务员 / 我观察窗外黑影"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              disabled={room?.status !== "in_progress"}
            />
            <button type="submit" disabled={loading || room?.status !== "in_progress"}>
              执行
            </button>
          </form>
        </section>

        <aside className="panel roster-panel">
          <h2>玩家与身份</h2>

          {room?.worldState.clues.length ? (
            <div className="clue-card">
              <p className="eyebrow">Clues</p>
              {room.worldState.clues.map((clue) => (
                <p key={clue}>{clue}</p>
              ))}
            </div>
          ) : null}

          {room?.players.map((player) => (
            <article key={player.id} className={`player-card ${player.id === playerId ? "is-me" : ""}`}>
              <p className="player-name">
                {player.name}
                {player.isHost ? " · 房主" : ""}
              </p>
              <p>{player.roleCard?.role ?? "等待分配身份"}</p>
              <p>{player.roleCard?.personality ?? "待开始"}</p>
              <p>{player.roleCard?.backstory ?? "开始游戏后可见背景。"}</p>
              <p>{player.roleCard?.secretGoal ?? "开始游戏后可见隐藏目标。"}</p>
            </article>
          ))}

          {!room && <p className="muted">玩家加入后会显示在这里。</p>}

          {me && (
            <div className="me-card">
              <p className="eyebrow">Your POV</p>
              <h3>{me.name}</h3>
              <p>{me.roleCard?.role ?? "还未获得角色卡"}</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

export default App;
