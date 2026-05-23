import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
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
import { ChatMessage, useSocket, VoteState } from "./useSocket";
import SceneRenderer from "./SceneRenderer";
import VoiceChat from "./VoiceChat";
import VoiceInput from "./VoiceInput";

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

  // invite + QR
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [networkBase, setNetworkBase] = useState("");
  const voiceBaseRef = useRef("");
  const [fromInvite, setFromInvite] = useState(false);

  // scene objects
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [focusedSceneObjectId, setFocusedSceneObjectId] = useState("");

  // voting state
  const [vote, setVote] = useState<VoteState | null>(null);
  const [voteChoice, setVoteChoice] = useState("");
  const [voteResult, setVoteResult] = useState<{ tally: Record<string, number>; winner: string } | null>(null);
  const [voters, setVoters] = useState<string[]>([]);

  // chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState<"story" | "chat">("story");
  const [unreadCount, setUnreadCount] = useState(0);
  const chatListRef = useRef<HTMLDivElement>(null);
  const chatTabActiveRef = useRef(false);

  // auto-scroll chat
  useEffect(() => {
    chatTabActiveRef.current = activeTab === "chat";
    if (activeTab === "chat" && chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
    }
  }, [chatMessages.length, activeTab]);

  // auto-select first interactive object
  useEffect(() => {
    const objects = room?.worldState.interactiveObjects;
    if (!objects?.length) return;
    const hasSelected = objects.some((item) => item.id === selectedObjectId);
    if (!hasSelected) {
      setSelectedObjectId(objects[0].id);
    }
  }, [room?.worldState.interactiveObjects, selectedObjectId]);

  // clear focus view on scenario change
  useEffect(() => {
    setFocusedSceneObjectId("");
  }, [room?.scenarioId]);

  // session restore
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

  // parse invite URL parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomCode(roomParam);
      setFromInvite(true);
    }
  }, []);

  // load scenarios
  useEffect(() => {
    fetchScenarios()
      .then((data) => {
        setScenarios(data);
        if (data.length > 0 && !data.find((s) => s.id === selectedScenario)) {
          setSelectedScenario(data[0].id);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  // health check + network base
  useEffect(() => {
    fetchHealth()
      .then((health) => setAiMode(health.mode))
      .catch(() => setAiMode("unknown"));

    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        if (h.localIP) {
          const port = window.location.port || "5173";
          setNetworkBase(`https://${h.localIP}:${port}`);
        }
      })
      .catch(() => setNetworkBase(window.location.origin));
  }, []);

  // polling for room state (fallback when socket is not connected)
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

  // scroll to latest message
  useEffect(() => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [room?.messages.length, thinking, starting]);

  // socket callbacks
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

  const onChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages((prev) => [...prev, msg]);
    if (!chatTabActiveRef.current) {
      setUnreadCount((prev) => prev + 1);
    }
  }, []);

  const onError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  const { submitVote, sendChatMessage, socket } = useSocket({
    roomId: room?.id ?? null,
    onRoomState,
    onVoteStart,
    onVoteUpdate,
    onVoteResult,
    onChatMessage,
    onError
  });

  // derived state
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
  const amHost = room?.hostPlayerId === activePlayerId;

  const inviteUrl = room
    ? `${networkBase || window.location.origin}?room=${room.id}`
    : "";

  function handleCopyInvite() {
    if (!room) return;

    const text = inviteUrl;

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

  async function runAction(nextAction: string) {
    if (!room || !activePlayerId || !nextAction.trim()) return;

    try {
      setLoading(true);
      setThinking(true);
      setError("");

      const nextRoom = await submitTurn(room.id, {
        playerId: activePlayerId,
        content: nextAction.trim()
      });
      setRoom({ ...nextRoom });
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setLoading(false);
      setThinking(false);
    }
  }

  async function handleSubmitTurn(event: FormEvent) {
    event.preventDefault();
    if (!room || !activePlayerId || !action.trim()) {
      return;
    }

    await runAction(action.trim());
    setAction("");
  }

  function handleChatSubmit(event: FormEvent) {
    event.preventDefault();
    if (!room || !chatInput.trim() || !me) return;
    sendChatMessage(room.id, me.name, chatInput.trim());
    setChatInput("");
  }

  function insertEmoji(emoji: string) {
    setChatInput((prev) => prev + emoji);
  }

  function handleVoteSubmit(event: FormEvent) {
    event.preventDefault();
    if (!room || !voteChoice) return;
    submitVote(room.id, activePlayerId, voteChoice);
  }

  const quickEmojis = ["😀","😂","🤣","😍","🤔","😎","👍","👎","🎉","❤️","🔥","💀","👀","🎲","🐉","⚔️","🛡️","🗡️","🏰","🌙","✨","💬"];

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

          {!room && !fromInvite && (
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
                  {scenarios.length === 0 && (
                    <option value="midnight-train">加载中…</option>
                  )}
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
                  value={maxPlayers}
                  onChange={(event) => setMaxPlayers(Number(event.target.value))}
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
          )}

          {room && room.id === roomCode ? (
            <p className="muted join-hint">你已在当前房间中，无需再次加入。可直接开始游戏。</p>
          ) : (
            <form onSubmit={handleJoinRoom} className="stack join-form">
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
              <p>状态：{room.status === "lobby" ? "等待中" : room.status === "in_progress" ? "进行中" : "已结束"}</p>
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
                <>
                  <label style={{ marginTop: 14, display: "block" }}>
                    房间人数（含 AI 补位）
                    <select
                      value={room.maxPlayers}
                      onChange={(event) => void handleMaxPlayersChange(Number(event.target.value))}
                      disabled={!amHost}
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

                  <button onClick={handleStart} disabled={loading || starting || aiMode !== "ai-ready"}>
                    {starting ? "AI 撰写开场…" : "开始游戏"}
                  </button>
                </>
              )}

              {room.status === "lobby" && (
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
              )}
            </div>
          )}

          {/* Voice Chat */}
          {room && me && (
            <VoiceChat
              socket={socket}
              roomId={room.id}
              playerName={me.name}
            />
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

          {error && !room && <p className="error-text">{error}</p>}
        </aside>

        <section className="panel story-panel">
          <div className="panel-header">
            <div className="tab-bar">
              <button
                type="button"
                className={`tab-btn ${activeTab === "story" ? "is-active" : ""}`}
                onClick={() => setActiveTab("story")}
              >
                故事流
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === "chat" ? "is-active" : ""}`}
                onClick={() => { setActiveTab("chat"); setUnreadCount(0); }}
              >
                交流区
                {unreadCount > 0 && (
                  <span className="chat-badge">{unreadCount}</span>
                )}
              </button>
            </div>
            <span>{activeTab === "story" ? (isMyTurn ? "轮到你了，请输入行动" : "等待其他成员行动") : "自由聊天，不影响剧情"}</span>
          </div>

          {activeTab === "story" && (
            <>
              {room?.status === "in_progress" && (
                <SceneRenderer
                  room={room}
                  selectedObjectId={selectedObjectId}
                  focusedSceneObjectId={focusedSceneObjectId}
                  onSelectObject={setSelectedObjectId}
                  onFocusObject={setFocusedSceneObjectId}
                  onClearFocus={() => setFocusedSceneObjectId("")}
                  onRunAction={runAction}
                  loading={loading}
                />
              )}

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

              {error && activeTab === "story" && <p className="error-text story-error">{error}</p>}

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
                <VoiceInput
                  onResult={(text) => {
                    voiceBaseRef.current = "";
                    setAction((prev) => prev ? `${prev} ${text}` : text);
                  }}
                  onInterim={(text) => {
                    setAction((prev) => {
                      if (!voiceBaseRef.current) voiceBaseRef.current = prev;
                      const base = voiceBaseRef.current;
                      return base ? `${base} ${text}` : text;
                    });
                  }}
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
            </>
          )}

          {activeTab === "chat" && (
            <>
              <div className="message-list chat-list" ref={chatListRef}>
                {chatMessages.length === 0 && (
                  <div className="empty-state" style={{ minHeight: 120 }}>
                    <p>还没有聊天消息。</p>
                    <p>在这里和其他玩家自由交流、讨论策略！</p>
                  </div>
                )}
                {chatMessages.map((msg) => (
                  <article key={msg.id} className={`chat-bubble ${msg.playerName === me?.name ? "is-self" : ""}`}>
                    <p className="chat-sender">{msg.playerName}</p>
                    <p className="chat-text">{msg.content}</p>
                  </article>
                ))}
              </div>

              <div className="emoji-bar">
                {quickEmojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="emoji-btn"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <form onSubmit={handleChatSubmit} className="action-bar">
                <input
                  placeholder="输入聊天消息..."
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  disabled={!room}
                />
                <button type="submit" disabled={!room || !chatInput.trim()}>
                  发送
                </button>
              </form>
            </>
          )}
        </section>

        <aside className="panel roster-panel">
          <h2>玩家与身份</h2>

          {room?.worldState.clues && room.worldState.clues.length > 0 && (
            <div className="clue-card">
              <p className="eyebrow">Clues</p>
              {room.worldState.clues.map((clue) => (
                <p key={clue}>{clue}</p>
              ))}
            </div>
          )}

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
