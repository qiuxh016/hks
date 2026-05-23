import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createRoom,
  fetchHealth,
  fetchRoom,
  fetchScenarios,
  joinRoom,
  startRoom,
  submitTurn,
  updateRoomSettings
} from "./api";
import {
  AI_HOST_SPEAKER,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  Room,
  Scenario,
  getCurrentTurnPlayer,
  getTurnPhaseLabel
} from "../../shared/types";
import { BgmPlayer } from "./components/BgmPlayer";
import { loadPlayerSession, resolvePlayerId, savePlayerSession } from "./session";

function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [hostName, setHostName] = useState("Elsa");
  const [joinName, setJoinName] = useState("桑耳");
  const [roomCode, setRoomCode] = useState("");
  const [selectedScenario, setSelectedScenario] = useState("midnight-train");
  const [maxPlayers, setMaxPlayers] = useState(3);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiMode, setAiMode] = useState<string>("checking");
  const [thinking, setThinking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [myPlayerName, setMyPlayerName] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const session = loadPlayerSession();
    if (!session) {
      return;
    }

    if (!playerId) {
      setPlayerId(session.playerId);
    }

    if (!myPlayerName) {
      setMyPlayerName(session.playerName);
    }

    if (!roomCode) {
      setRoomCode(session.roomId);
    }

    if (!room) {
      fetchRoom(session.roomId)
        .then(setRoom)
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!room?.id || !playerId || !myPlayerName) {
      return;
    }

    savePlayerSession({
      roomId: room.id,
      playerId,
      playerName: myPlayerName
    });
  }, [room?.id, playerId, myPlayerName]);

  useEffect(() => {
    fetchHealth()
      .then((health) => setAiMode(health.mode))
      .catch(() => setAiMode("unknown"));
  }, []);

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
    if (!room?.id || loading || thinking || starting) {
      return;
    }

    const timer = window.setInterval(() => {
      fetchRoom(room.id)
        .then(setRoom)
        .catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [room?.id, loading, thinking, starting]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [room?.messages.length, thinking, starting]);

  async function handleCreateRoom(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const session = await createRoom({
        hostName,
        scenarioId: selectedScenario as Scenario["id"],
        maxPlayers
      });
      setRoom(session.room);
      setPlayerId(session.playerId);
      setMyPlayerName(hostName.trim());
      setRoomCode(session.room.id);
      setMaxPlayers(session.room.maxPlayers);
      savePlayerSession({
        roomId: session.room.id,
        playerId: session.playerId,
        playerName: hostName.trim()
      });
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
      setMyPlayerName(joinName.trim());
      setMaxPlayers(session.room.maxPlayers);
      savePlayerSession({
        roomId: session.room.id,
        playerId: session.playerId,
        playerName: joinName.trim()
      });
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
      setStarting(true);
      setError("");
      const nextRoom = await startRoom(room.id);
      const activeId = resolvePlayerId(nextRoom, playerId, myPlayerName || hostName);
      if (activeId) {
        setPlayerId(activeId);
      }
      setRoom({ ...nextRoom });
    } catch (err) {
      setError(err instanceof Error ? err.message : "开始失败");
    } finally {
      setLoading(false);
      setStarting(false);
    }
  }

  async function handleSubmitTurn(event: FormEvent) {
    event.preventDefault();
    if (!room || !activePlayerId || !action.trim()) {
      return;
    }

    const content = action.trim();

    try {
      setLoading(true);
      setThinking(true);
      setError("");

      const nextRoom = await submitTurn(room.id, {
        playerId: activePlayerId,
        content
      });
      setRoom({ ...nextRoom });
      setAction("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setLoading(false);
      setThinking(false);
    }
  }

  const activePlayerId = useMemo(() => {
    if (!room) {
      return playerId;
    }

    return resolvePlayerId(room, playerId, myPlayerName || hostName || joinName);
  }, [room, playerId, myPlayerName, hostName, joinName]);

  const me = room?.players.find((player) => player.id === activePlayerId);
  const currentTurnPlayer = room ? getCurrentTurnPlayer(room) : undefined;
  const isMyTurn = Boolean(
    room?.turnPhase === "human" &&
      currentTurnPlayer?.kind === "human" &&
      me?.kind === "human" &&
      currentTurnPlayer.id === activePlayerId
  );
  const humanCount = room?.players.filter((player) => player.kind === "human").length ?? 0;

  async function handleMaxPlayersChange(value: number) {
    if (!room || !activePlayerId || room.hostPlayerId !== activePlayerId) {
      setMaxPlayers(value);
      return;
    }

    setMaxPlayers(value);

    if (room.status !== "lobby") {
      return;
    }

    try {
      const nextRoom = await updateRoomSettings(room.id, {
        hostPlayerId: activePlayerId,
        maxPlayers: value
      });
      setRoom(nextRoom);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新人数失败");
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Hackathon Frame</p>
        <h1>AI 地下城</h1>
        <p className="hero-copy">
          先把多人房间、聊天式冒险和 AI 主持人接起来，再慢慢把剧本、语音和实时联机做强。
        </p>
        {aiMode === "no-api-key" && (
          <p className="error-text api-banner">
            未检测到 DeepSeek API Key。请在项目根目录创建 `.env` 并设置 `DEEPSEEK_API_KEY`，然后重启 `npm run dev`。
          </p>
        )}
        {aiMode === "ai-ready" && (
          <p className="api-ready">
            每轮真人先依次输入指令，再由 DeepSeek 驱动的 AI 机器人依次行动。
          </p>
        )}
        <BgmPlayer />
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

            <label>
              房间人数（含 AI 补位）
              <select
                value={room?.maxPlayers ?? maxPlayers}
                onChange={(event) => void handleMaxPlayersChange(Number(event.target.value))}
                disabled={Boolean(room && (room.hostPlayerId !== activePlayerId || room.status !== "lobby"))}
              >
                {Array.from({ length: MAX_ROOM_PLAYERS - MIN_ROOM_PLAYERS + 1 }, (_, index) => {
                  const value = index + MIN_ROOM_PLAYERS;
                  return (
                    <option key={value} value={value}>
                      {value} 人局
                    </option>
                  );
                })}
              </select>
            </label>

            <button type="submit" disabled={loading}>
              创建房间
            </button>
          </form>

          {room && room.id === roomCode ? (
            <p className="muted join-hint">你已在当前房间中，无需再次加入。可直接开始游戏。</p>
          ) : (
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
          )}

          {room && (
            <div className="status-card">
              <p>房间号：{room.id}</p>
              <p>状态：{room.status}</p>
              <p>
                人数：{humanCount} 真人 / {room.maxPlayers} 人局
                {room.players.filter((player) => player.kind === "bot").length > 0 &&
                  `（${room.players.filter((player) => player.kind === "bot").length} AI 机器人）`}
              </p>
              <p>场景：{scenarios.find((item) => item.id === room.scenarioId)?.title ?? room.scenarioId}</p>
              {room.status === "in_progress" && (
                <>
                  <p className="turn-indicator">
                    本轮阶段：{getTurnPhaseLabel(room.turnPhase)}
                    {room.isProcessingTurn ? " · 处理中…" : ""}
                  </p>
                  <p className="turn-indicator">
                    当前行动：{currentTurnPlayer?.name ?? "—"}
                  </p>
                </>
              )}
              <p>当前地点：{room.worldState.currentLocation}</p>
              <p>紧张度：{room.worldState.tension} / 10</p>
              <p>回合数：{room.worldState.round}</p>
              {room.status === "in_progress" && room.worldState.quests.length > 0 && (
                <div className="quest-list">
                  <p className="quest-title">本局目标</p>
                  <ul>
                    {room.worldState.quests.map((quest) => (
                      <li key={quest}>{quest}</li>
                    ))}
                  </ul>
                </div>
              )}
              {room.status === "lobby" && (
                <button onClick={handleStart} disabled={loading || starting || aiMode !== "ai-ready"}>
                  {starting ? "AI 撰写开场…" : "开始游戏"}
                </button>
              )}
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
        </aside>

        <section className="panel story-panel">
          <div className="panel-header">
            <h2>故事流</h2>
            <span>{isMyTurn ? "轮到你了，请输入行动" : "等待其他成员行动"}</span>
          </div>

          <div className="message-list" ref={messageListRef}>
            {room?.messages.map((message) => (
              <article
                key={message.id}
                className={`message message-${message.type} ${
                  message.variant === "tease"
                    ? "message-tease"
                    : message.variant === "brief"
                      ? "message-brief"
                      : ""
                }`}
              >
                <p className="message-speaker">{message.speaker}</p>
                <p>{message.content}</p>
              </article>
            ))}

            {(thinking || starting) && (
              <article className="message message-ai message-pending">
                <p className="message-speaker">{AI_HOST_SPEAKER}</p>
                <p>{starting ? "正在撰写开场剧情，请稍候…" : "正在根据你的行动推演剧情，请稍候…"}</p>
              </article>
            )}

            {!room && (
              <div className="empty-state">
                <p>先创建或加入一个房间。</p>
                <p>这版重点是把多人剧本流程跑通，不先卷复杂战斗系统。</p>
              </div>
            )}
          </div>

          {error && <p className="error-text story-error">{error}</p>}

          <form onSubmit={handleSubmitTurn} className="action-bar">
            <input
              placeholder={
                isMyTurn
                  ? "输入你的行动，例如：我偷走地图 / 我观察谁最紧张"
                  : room?.isProcessingTurn
                    ? "AI 机器人或主持人处理中…"
                    : `等待 ${currentTurnPlayer?.name ?? "其他玩家"} 行动`
              }
              value={action}
              onChange={(event) => setAction(event.target.value)}
              disabled={room?.status !== "in_progress" || !isMyTurn || room.isProcessingTurn}
            />
            <button
              type="submit"
              disabled={
                loading ||
                thinking ||
                starting ||
                room?.status !== "in_progress" ||
                !isMyTurn ||
                room?.isProcessingTurn ||
                aiMode !== "ai-ready"
              }
            >
              {thinking ? "AI 回复中…" : isMyTurn ? "执行" : "等待回合"}
            </button>
          </form>
        </section>

        <aside className="panel roster-panel">
          <h2>玩家与身份</h2>

          {room?.players.map((player) => (
            <article
              key={player.id}
              className={`player-card ${player.id === activePlayerId ? "is-me" : ""} ${
                player.kind === "bot" ? "is-bot" : ""
              } ${currentTurnPlayer?.id === player.id ? "is-active-turn" : ""}`}
            >
              <p className="player-name">
                {player.name}
                {player.isHost ? " · 房主" : ""}
                {player.kind === "bot" ? " · AI" : ""}
                {currentTurnPlayer?.id === player.id ? " · 行动中" : ""}
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

