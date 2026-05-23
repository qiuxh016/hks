import { FormEvent, ReactNode, useEffect, useState } from "react";
import { InteractiveObject, Room, Scenario } from "../../shared/types";
import { createRoom, fetchRoom, fetchScenarios, joinRoom, startRoom, submitTurn } from "./api";

function renderSceneIllustration(scenarioId?: Scenario["id"]): ReactNode {
  if (scenarioId === "midnight-train") {
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
  const [selectedScenario, setSelectedScenario] = useState("midnight-train");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState("");

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

  async function handleCreateRoom(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const session = await createRoom({
        hostName,
        scenarioId: selectedScenario as Scenario["id"]
      });
      setRoom(session.room);
      setPlayerId(session.playerId);
      setRoomCode(session.room.id);
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

  const me = room?.players.find((player) => player.id === playerId);
  const selectedObject =
    room?.worldState.interactiveObjects.find((item) => item.id === selectedObjectId) ?? null;

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">AI Improvised Adventure</p>
        <h1>AI 地下城</h1>
        <p className="hero-copy">
          这版先把多人房间、AI 主持人和动态 2D 舞台接起来。现在的场景不依赖图片，而是直接由代码绘制和驱动动画。
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
                onChange={(event) => setSelectedScenario(event.target.value)}
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
            <span>现在可以先点场景，再用自由输入接管剧情</span>
          </div>

          <section className="scene-panel">
            <div className="scene-copy">
              <div>
                <p className="eyebrow">Animated Stage</p>
                <h3>{room?.worldState.sceneTitle ?? "互动场景"}</h3>
              </div>
              <p>{room?.worldState.sceneDescription ?? "开场后，这里会显示当前场景与可交互物件。"}</p>
            </div>

            <div className={`scene-board scene-${room?.scenarioId ?? "empty"}`}>
              {renderSceneIllustration(room?.scenarioId)}
              <div className="scene-vignette" aria-hidden="true" />
              {room?.worldState.interactiveObjects.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`hotspot hotspot-${item.accent ?? "neutral"} ${
                    selectedObjectId === item.id ? "is-selected" : ""
                  }`}
                  style={{ left: `${item.x}%`, top: `${item.y}%` }}
                  onClick={() => setSelectedObjectId(item.id)}
                >
                  <span>{item.name}</span>
                  <small>{hotspotLabel(item)}</small>
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
                    <h4>点击一个场景热点</h4>
                    <p>选中后可以用快捷动作，也可以直接自由输入一段更离谱的操作。</p>
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
                <p>这版的重点是让评委第一眼就觉得它不是普通聊天窗口，而是一个有舞台感的 AI 场景。</p>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmitTurn} className="action-bar">
            <input
              placeholder="输入你的行动，例如：我砸开车窗 / 我偷看尸体手里的车票"
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
