import { FormEvent, useCallback, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { createRoom, fetchScenarios, joinRoom, startRoom, submitTurn, toggleReady as apiToggleReady } from "./api";
import { useSocket, VoteState } from "./useSocket";
import { Room, RoomMode, Scenario } from "../../shared/types";

function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [hostName, setHostName] = useState("Elsa");
  const [joinName, setJoinName] = useState("桑耳");
  const [roomCode, setRoomCode] = useState("");
  const [selectedScenario, setSelectedScenario] = useState("midnight-train");
  const [gameMode, setGameMode] = useState<RoomMode>("multi");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [networkBase, setNetworkBase] = useState("");
  const [fromInvite, setFromInvite] = useState(false);

  // voting state
  const [vote, setVote] = useState<VoteState | null>(null);
  const [voteChoice, setVoteChoice] = useState("");
  const [voteResult, setVoteResult] = useState<{ tally: Record<string, number>; winner: string } | null>(null);
  const [voters, setVoters] = useState<string[]>([]);

  const onRoomState = useCallback((next: Room) => {
    setRoom(next);
  }, []);

  const onVoteStart = useCallback((v: VoteState) => {
    setVote(v);
    setVoteChoice("");
    setVoteResult(null);
    setVoters([]);
  }, []);

  const onVoteUpdate = useCallback((info: { voterName: string; voted: boolean }) => {
    setVoters((prev) => [...prev, info.voterName]);
  }, []);

  const onVoteResult = useCallback((r: { tally: Record<string, number>; winner: string }) => {
    setVoteResult(r);
    setVote(null);
  }, []);

  const onError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  const { submitVote } = useSocket({
    roomId: room?.id ?? null,
    onRoomState,
    onVoteStart,
    onVoteUpdate,
    onVoteResult,
    onError
  });

  useEffect(() => {
    fetchScenarios()
      .then((data) => {
        setScenarios(data);
        if (data[0]) {
          setSelectedScenario(data[0].id);
        }
      })
      .catch((err: Error) => setError(err.message));

    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        setNetworkBase(`http://${h.localIP}:5173`);
      })
      .catch(() => setNetworkBase(window.location.origin));

    // auto-fill room code from invite link / QR scan
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomCode(roomParam);
      setFromInvite(true);
    }
  }, []);

  const inviteUrl = room
    ? `${networkBase || window.location.origin}?room=${room.id}`
    : "";

  function handleCopyInvite() {
    if (!room) return;

    const text = inviteUrl;

    // try modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2000);
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text: string) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // last resort: show the URL so user can manually copy
      prompt("复制以下链接：", text);
    }
    document.body.removeChild(ta);
  }

  async function handleCreateRoom(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const session = await createRoom({
        hostName,
        scenarioId: selectedScenario as Scenario["id"],
        mode: gameMode
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
    if (!room) return;

    try {
      setLoading(true);
      const nextRoom = await startRoom(room.id, playerId);
      setRoom({ ...nextRoom });
    } catch (err) {
      setError(err instanceof Error ? err.message : "开始失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleReady() {
    if (!room) return;
    try {
      const nextRoom = await apiToggleReady(room.id, playerId);
      setRoom({ ...nextRoom });
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleSubmitTurn(event: FormEvent) {
    event.preventDefault();
    if (!room || !playerId || !action.trim()) return;

    try {
      setLoading(true);
      const nextRoom = await submitTurn(room.id, {
        playerId,
        content: action.trim()
      });
      setRoom({ ...nextRoom });
      setAction("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setLoading(false);
    }
  }

  function handleVoteSubmit(event: FormEvent) {
    event.preventDefault();
    if (!room || !voteChoice) return;
    submitVote(room.id, playerId, voteChoice);
  }

  const me = room?.players.find((player) => player.id === playerId);
  const amHost = room?.hostPlayerId === playerId;
  const allReady = room?.players.every((p) => p.ready) ?? false;

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Hackathon Frame</p>
        <h1>AI 地下城</h1>
        <p className="hero-copy">
          多人房间、聊天式冒险和 AI 主持人——实时联机版。
        </p>
      </section>

      <section className="grid">
        <aside className="panel controls">
          <h2>房间操作</h2>

          {/* create form: only for direct visitors, not invite-link visitors */}
          {!room && !fromInvite && (
            <form onSubmit={handleCreateRoom} className="stack">
              <label>
                你的名字
                <input value={hostName} onChange={(event) => setHostName(event.target.value)} />
              </label>

              <label>
                游戏模式
                <div className="mode-toggle">
                  <button
                    type="button"
                    className={`mode-btn ${gameMode === "single" ? "is-active" : ""}`}
                    onClick={() => setGameMode("single")}
                  >
                    单人冒险
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${gameMode === "multi" ? "is-active" : ""}`}
                    onClick={() => setGameMode("multi")}
                  >
                    多人房间
                  </button>
                </div>
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
          )}

          {/* join form: always visible when not in a room */}
          {!room && (
            <form onSubmit={handleJoinRoom} className={`stack ${!fromInvite ? "join-form" : ""}`}>
              {fromInvite && (
                <p className="invite-hint" style={{ margin: 0, color: "var(--accent-2)", fontWeight: 700, fontSize: "0.9rem" }}>
                  你收到了一个房间邀请
                </p>
              )}
              <label>
                房间号
                <input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} />
              </label>

              <label>
                你的名字
                <input value={joinName} onChange={(event) => setJoinName(event.target.value)} />
              </label>

              <button type="submit" disabled={loading || !roomCode}>
                加入房间
              </button>
            </form>
          )}

          {room && (
            <div className="status-card">
              <p>房间号：<strong>{room.id}</strong></p>
              <p>模式：{room.mode === "single" ? "单人冒险" : "多人房间"}</p>
              <p>状态：{room.status === "lobby" ? "等待中" : room.status === "in_progress" ? "进行中" : "已结束"}</p>
              <p>场景：{scenarios.find((item) => item.id === room.scenarioId)?.title ?? room.scenarioId}</p>
              <p>当前地点：{room.worldState.currentLocation}</p>
              <p>紧张度：{room.worldState.tension} / 10</p>
              <p>回合数：{room.worldState.round}</p>

              {room.status === "lobby" && room.mode === "multi" && (
                <>
                  <div className="ready-list">
                    {room.players.map((p) => (
                      <div key={p.id} className={`ready-row ${p.ready ? "is-ready" : ""}`}>
                        <span className="ready-dot">{p.ready ? "✓" : "○"}</span>
                        <span>{p.name}</span>
                        {p.isHost && <span className="ready-tag">房主</span>}
                      </div>
                    ))}
                  </div>

                  {amHost ? (
                    <button onClick={handleStart} disabled={loading || !allReady}>
                      {allReady ? "开始游戏" : "等待全员准备"}
                    </button>
                  ) : (
                    <button
                      onClick={handleToggleReady}
                      disabled={loading}
                      style={{ background: me?.ready ? "linear-gradient(120deg, #555, #333)" : undefined }}
                    >
                      {me?.ready ? "取消准备" : "我准备好了"}
                    </button>
                  )}

                  <div className="invite-section">
                    <button onClick={handleCopyInvite} className="btn-invite">
                      {inviteCopied ? "已复制！" : "复制邀请链接"}
                    </button>
                    <button
                      onClick={() => setShowQR(!showQR)}
                      className="btn-invite"
                      style={{ marginTop: 8, background: "linear-gradient(120deg, #555, #333)" }}
                    >
                      {showQR ? "收起二维码" : "显示二维码"}
                    </button>
                    {showQR && (
                      <div className="qr-wrap">
                        <QRCode value={inviteUrl} size={140} />
                        <p className="muted" style={{ fontSize: "0.7rem", marginTop: 6 }}>
                          扫描二维码加入房间
                        </p>
                      </div>
                    )}
                    {room.players.length > 0 && (
                      <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                        等待中：{room.players.map((p) => p.name).join("、")}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Voting UI */}
          {vote && room && (
            <div className="panel vote-panel">
              <h3>投票</h3>
              <p className="vote-question">{vote.question}</p>

              <form onSubmit={handleVoteSubmit} className="stack">
                {vote.options.map((opt) => (
                  <label key={opt} className="vote-option">
                    <input
                      type="radio"
                      name="vote"
                      value={opt}
                      checked={voteChoice === opt}
                      onChange={(event) => setVoteChoice(event.target.value)}
                    />
                    {opt}
                  </label>
                ))}

                <button type="submit" disabled={!voteChoice}>
                  投票
                </button>
              </form>

              {voters.length > 0 && (
                <p className="muted" style={{ marginTop: "0.5rem" }}>
                  已投票：{voters.join("、")}
                </p>
              )}
            </div>
          )}

          {voteResult && (
            <div className="panel vote-result-panel">
              <h3>投票结束</h3>
              {Object.entries(voteResult.tally).map(([opt, count]) => (
                <p key={opt}>
                  {opt}：{count} 票
                  {opt === voteResult.winner ? "  ← 焦点" : ""}
                </p>
              ))}
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
        </aside>

        <section className="panel story-panel">
          <div className="panel-header">
            <h2>故事流</h2>
            <span>自由输入比按钮更重要</span>
          </div>

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
                <p>这版重点是把多人剧本流程跑通，不先卷复杂战斗系统。</p>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmitTurn} className="action-bar">
            <input
              placeholder="输入你的行动，例如：我偷走地图 / 我观察谁最紧张"
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
