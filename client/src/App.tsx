import { FormEvent, useEffect, useRef, useState } from "react";
import {
  createRoom,
  fetchHealth,
  fetchRoom,
  fetchScenarios,
  joinRoom,
  startRoom,
  submitTurn
} from "./api";
import { AI_HOST_SPEAKER, Room, Scenario } from "../../shared/types";

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
  const [aiMode, setAiMode] = useState<string>("checking");
  const [thinking, setThinking] = useState(false);
  const [starting, setStarting] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);

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
      setStarting(true);
      setError("");
      const nextRoom = await startRoom(room.id);
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
    if (!room || !playerId || !action.trim()) {
      return;
    }

    const content = action.trim();

    try {
      setLoading(true);
      setThinking(true);
      setError("");

      const nextRoom = await submitTurn(room.id, {
        playerId,
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

  const me = room?.players.find((player) => player.id === playerId);

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
            AI主持人已就绪：会记住你的每次操作；约每 90 秒或你停手片刻后，可能跳出来调侃你的骚操作。
          </p>
        )}
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
            <span>自由输入比按钮更重要</span>
          </div>

          <div className="message-list" ref={messageListRef}>
            {room?.messages.map((message) => (
              <article
                key={message.id}
                className={`message message-${message.type} ${
                  message.variant === "tease" ? "message-tease" : ""
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
              placeholder="输入你的行动，例如：我偷走地图 / 我观察谁最紧张"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              disabled={room?.status !== "in_progress"}
            />
            <button
              type="submit"
              disabled={
                loading || thinking || starting || room?.status !== "in_progress" || aiMode !== "ai-ready"
              }
            >
              {thinking ? "AI 回复中…" : "执行"}
            </button>
          </form>
        </section>

        <aside className="panel roster-panel">
          <h2>玩家与身份</h2>

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

