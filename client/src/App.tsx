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
  toggleReady,
  updateRoomSettings
} from "./api";
import {
  AI_HOST_SPEAKER,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  Message,
  Room,
  RoomMode,
  Scenario,
  getCurrentTurnPlayer,
  getTurnPhaseLabel
} from "../../shared/types";
import { BgmPlayer } from "./components/BgmPlayer";
import { TypewriterText } from "./components/TypewriterText";
import { clearPlayerSession, loadPlayerSession, resolvePlayerId, savePlayerSession } from "./session";
import { ChatMessage, useSocket, VoteState } from "./useSocket";
import SceneRenderer from "./SceneRenderer";
import VoiceChat from "./VoiceChat";
import VoiceInput from "./VoiceInput";

const BOT_AVATARS = ["🤖", "🦾", "🎲", "⚙️"];

function getSpeakerAvatar(message: Message, room: Room | null): string {
  if (message.variant === "tease") return "😈";
  if (message.type === "ai") return "🎭";
  if (message.type === "player" && message.playerId && room) {
    const player = room.players.find(p => p.id === message.playerId);
    if (player?.kind === "bot") {
      const botIndex = room.players.filter(p => p.kind === "bot").indexOf(player);
      return BOT_AVATARS[botIndex] ?? "🤖";
    }
    return "👤";
  }
  return "👤";
}

function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [hostName, setHostName] = useState("Elsa");
  const [joinName, setJoinName] = useState("桑耳");
  const [roomCode, setRoomCode] = useState("");
  const [selectedScenario, setSelectedScenario] = useState("midnight-train");
  const [gameMode, setGameMode] = useState<RoomMode>("multi");
  const [maxPlayers, setMaxPlayers] = useState(3);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiMode, setAiMode] = useState<string>("checking");
  const [thinking, setThinking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [myPlayerName, setMyPlayerName] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);
  const prevRoundRef = useRef(0);
  const prevLocationRef = useRef("");

  // invite + QR
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [networkBase, setNetworkBase] = useState(window.location.origin);
  const voiceBaseRef = useRef("");
  const [fromInvite, setFromInvite] = useState(false);

  // scene objects
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [focusedSceneObjectId, setFocusedSceneObjectId] = useState("");

  // voting state
  const [vote, setVote] = useState<VoteState | null>(null);
  const [voteChoice, setVoteChoice] = useState("");
  const [voteResult, setVoteResult] = useState<{ tally: Record<string, number>; winner: string | null } | null>(null);
  const [voters, setVoters] = useState<string[]>([]);

  // chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState<"story" | "chat">("story");
  const [unreadCount, setUnreadCount] = useState(0);
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(new Set());
  const [questsExpanded, setQuestsExpanded] = useState(true);
  const [sidebarLeftOpen, setSidebarLeftOpen] = useState(true);
  const [sidebarRightOpen, setSidebarRightOpen] = useState(true);
  const [fastForwarded, setFastForwarded] = useState(false);
  const [typewriterDone, setTypewriterDone] = useState(true);
  const [revealedCount, setRevealedCount] = useState(0);
  const revealedCountRef = useRef(0);
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

  // reset round/location tracker when room changes
  useEffect(() => {
    if (room) {
      prevRoundRef.current = room.worldState.round;
      prevLocationRef.current = room.worldState.currentLocation;
    }
  }, [room?.id]);

  // reset fast-forward when bot phase ends
  useEffect(() => {
    if (room?.turnPhase !== "bot") {
      setFastForwarded(false);
    }
  }, [room?.turnPhase]);

  // track typewriter: hide turn prompt until latest narration finishes typing
  useEffect(() => {
    if (thinking || starting) {
      setTypewriterDone(false);
    }
  }, [thinking, starting]);

  // session restore (skip if arriving via invite link)
  useEffect(() => {
    const inviteRoomId = new URLSearchParams(window.location.search).get("room");
    if (inviteRoomId) {
      return; // invite link takes priority over saved session
    }

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
          setNetworkBase(`https://${h.localIP}:${window.location.port}`);
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
  }, [room?.messages.length, revealedCount, thinking, starting]);

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

  const onVoteResult = useCallback((r: { tally: Record<string, number>; winner: string | null }) => {
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

  const { submitVote, sendChatMessage, fastForward, socket } = useSocket({
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
  const { storyMessages, systemMessages } = useMemo(() => {
    if (!room?.messages) return { storyMessages: [] as Message[], systemMessages: [] as Message[] };
    const story: Message[] = [];
    const sys: Message[] = [];
    for (const msg of room.messages) {
      if (msg.type === "system") sys.push(msg);
      else story.push(msg);
    }
    return { storyMessages: story, systemMessages: sys };
  }, [room?.messages]);

  // revealedCount: gate messages to appear one at a time with typewriter
  const prevRoomIdRef = useRef<string | null>(null);
  const prevStoryLenRef = useRef(0);

  useEffect(() => {
    const len = storyMessages.length;
    const prevLen = prevStoryLenRef.current;
    const roomChanged = room?.id !== prevRoomIdRef.current;
    prevStoryLenRef.current = len;
    if (room?.id) prevRoomIdRef.current = room.id;

    if (len === 0) {
      setRevealedCount(0);
      revealedCountRef.current = 0;
      return;
    }

    if (roomChanged || prevLen === 0 || fastForwarded) {
      setRevealedCount(len);
      revealedCountRef.current = len;
      if (fastForwarded) setTypewriterDone(true);
      return;
    }

    if (revealedCountRef.current >= prevLen) {
      setTypewriterDone(false);
    }
  }, [storyMessages.length, room?.id, fastForwarded]);

  useEffect(() => {
    revealedCountRef.current = revealedCount;
  }, [revealedCount]);

  useEffect(() => {
    if (revealedCount >= storyMessages.length && !thinking && !starting) {
      setTypewriterDone(true);
    }
  }, [revealedCount, storyMessages.length, thinking, starting]);

  const amHost = room?.hostPlayerId === activePlayerId;
  const allHumansReady = room
    ? room.players.filter((p) => p.kind === "human").every((p) => p.ready)
    : false;

  const inviteUrl = room
    ? `${networkBase}?room=${room.id}`
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
        mode: gameMode,
        maxPlayers: gameMode === "single" ? 1 : maxPlayers
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

      // auto-start for single player
      if (gameMode === "single") {
        try {
          setStarting(true);
          const nextRoom = await startRoom(session.room.id);
          const activeId = resolvePlayerId(nextRoom, session.playerId, hostName.trim());
          if (activeId) {
            setPlayerId(activeId);
          }
          setRoom({ ...nextRoom });
        } finally {
          setStarting(false);
        }
      }
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

  function handleExitGame() {
    clearPlayerSession();
    setRoom(null);
    setPlayerId("");
    setMyPlayerName("");
    setRoomCode("");
    setError("");
  }

  async function handleToggleReady() {
    if (!room) return;

    try {
      const updated = await toggleReady(room.id, activePlayerId);
      setRoom(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
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

  function togglePlayerExpand(playerId: string) {
    setExpandedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
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
        <h1>AI 地下城</h1>
        {aiMode === "no-api-key" && (
          <p className="error-text api-banner">
            未检测到 DeepSeek API Key，请在 `.env` 中设置 DEEPSEEK_API_KEY。
          </p>
        )}
      </section>

      <section
        className="grid"
        style={{
          gridTemplateColumns: `${sidebarLeftOpen ? "300px" : "36px"} minmax(0, 1fr) ${sidebarRightOpen ? "340px" : "36px"}`
        }}
      >
        <aside className={`panel controls${sidebarLeftOpen ? "" : " is-collapsed"}`}>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarLeftOpen(!sidebarLeftOpen)}
            title={sidebarLeftOpen ? "收起侧栏" : "展开侧栏"}
          >
            {sidebarLeftOpen ? "◀" : "▶"}
          </button>
          {sidebarLeftOpen && (
          <>
          <h2>房间操作</h2>

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

              {gameMode === "multi" && (
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
              )}

              <button type="submit" disabled={loading}>
                {gameMode === "single" ? "开始冒险" : "创建房间"}
              </button>
            </form>
          )}

          {!room && (
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
              <p>
                {humanCount} 真人 / {room.maxPlayers} 人局
                {room.players.filter((player) => player.kind === "bot").length > 0 &&
                  `（${room.players.filter((player) => player.kind === "bot").length} AI）`}
              </p>
              <p>{scenarios.find((item) => item.id === room.scenarioId)?.title ?? room.scenarioId}</p>
              {room.status === "in_progress" && (
                <>
                  <p className="turn-indicator">
                    {getTurnPhaseLabel(room.turnPhase)} · {currentTurnPlayer?.name ?? "—"}
                    {room.isProcessingTurn ? " · 处理中…" : ""}
                  </p>
                </>
              )}
              {room.status === "lobby" && room.mode === "multi" && (
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

                  {amHost && !allHumansReady && (
                    <p className="muted" style={{ marginTop: 8, color: "#f0a040" }}>
                      等待所有玩家准备…
                    </p>
                  )}
                  {amHost && (
                    <button
                      onClick={handleStart}
                      disabled={loading || starting || aiMode !== "ai-ready" || !allHumansReady}
                    >
                      {starting ? "AI 撰写开场…" : allHumansReady ? "开始游戏" : "等待玩家准备"}
                    </button>
                  )}
                  {!amHost && (
                    <button
                      onClick={() => void handleToggleReady()}
                      disabled={loading}
                      style={{
                        background: me?.ready
                          ? "linear-gradient(120deg, #3a5a3a, #2a4a2a)"
                          : "linear-gradient(120deg, #4a7a4a, #3a6a3a)"
                      }}
                    >
                      {me?.ready ? "已准备 ✓" : "准备"}
                    </button>
                  )}
                </>
              )}

              {room.status === "lobby" && room.mode === "multi" && (
                <div className="invite-section">
                  {amHost && (
                    <>
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
                    </>
                  )}
                  {room.players.length > 0 && (
                    <ul className="player-ready-list" style={{ fontSize: "0.8rem", marginTop: 8, listStyle: "none", padding: 0 }}>
                      {room.players.filter((p) => p.kind === "human").map((p) => (
                        <li key={p.id} style={{ padding: "2px 0" }}>
                          {p.ready ? "✅" : "⏳"} {p.name} {p.isHost ? "(房主)" : ""} {p.ready ? "已准备" : "未准备"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <button
                onClick={handleExitGame}
                style={{
                  marginTop: 16,
                  background: "linear-gradient(120deg, #6b2f2f, #4a1e1e)",
                  border: "1px solid #8b3a3a"
                }}
              >
                退出游戏
              </button>
            </div>
          )}

          {room?.status === "in_progress" && room.worldState.quests.length > 0 && (
            <div className={`quest-tracker${questsExpanded ? " is-expanded" : ""}`}>
              <button
                type="button"
                className="quest-toggle"
                onClick={() => setQuestsExpanded(!questsExpanded)}
              >
                <span className="quest-toggle-icon">📜</span>
                <span>任务目标</span>
                <span className="quest-count">{room.worldState.quests.length}</span>
                <span className="quest-chevron">{questsExpanded ? "▲" : "▼"}</span>
              </button>
              {questsExpanded && (
                <div className="quest-cards">
                  {room.worldState.quests.map((quest, i) => (
                    <div key={i} className="quest-card">
                      <span className="quest-num">{i + 1}</span>
                      <span className="quest-text">{quest}</span>
                    </div>
                  ))}
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
              {!voteResult.winner && (
                <p style={{ marginTop: 8, color: "var(--muted)", fontSize: "0.85rem" }}>
                  未形成明确焦点，故事继续推进。
                </p>
              )}
            </div>
          )}

          {error && !room && <p className="error-text">{error}</p>}
          </>
          )}
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

              <div className="story-scroll-area" ref={messageListRef}>
                <div className={`message-list${(room?.worldState.tension ?? 0) <= 4 ? '' : (room?.worldState.tension ?? 0) <= 7 ? ' tension-mid' : ' tension-high'}`}>
                {(() => {
                  const items: React.ReactNode[] = [];
                  storyMessages.forEach((message, idx) => {
                    if (idx > revealedCount) return;
                    const isRevealing = idx === revealedCount;

                    // round separator
                    if (room && room.worldState.round > 0 && room.worldState.round !== prevRoundRef.current) {
                      items.push(
                        <div key={`round-sep-${room.worldState.round}`} className="round-separator">
                          <span className="round-separator-line" />
                          <span className="round-separator-label">第 {room.worldState.round} 轮</span>
                          <span className="round-separator-line" />
                        </div>
                      );
                      prevRoundRef.current = room.worldState.round;
                    }
                    // location transition
                    if (room && room.worldState.currentLocation && room.worldState.currentLocation !== prevLocationRef.current && prevLocationRef.current !== "") {
                      items.push(
                        <div key={`loc-sep-${idx}`} className="location-separator">
                          <span className="location-separator-icon">📍</span>
                          <span>{room.worldState.currentLocation}</span>
                        </div>
                      );
                    }
                    if (room) {
                      prevLocationRef.current = room.worldState.currentLocation;
                    }

                    const isBot = message.type === "player" && message.playerId
                      && room?.players.find(p => p.id === message.playerId)?.kind === "bot";
                    const variantClass = [
                      message.variant === "tease" ? "chat-msg-tease" : "",
                      message.variant === "brief" ? "chat-msg-brief" : "",
                      isBot ? "chat-msg-bot" : ""
                    ].filter(Boolean).join(" ");

                    items.push(
                      <article
                        key={message.id}
                        className={`chat-msg chat-msg-${message.type} ${variantClass}${isRevealing ? " chat-msg-revealing" : ""}`}
                      >
                        <p className="chat-msg-speaker">
                          <span className="speaker-avatar">{getSpeakerAvatar(message, room)}</span>
                          {message.speaker}
                          {message.variant === "tease" ? " · 调侃" : ""}
                        </p>
                        <div className="chat-msg-bubble">
                          {isRevealing ? (
                            <TypewriterText
                              text={message.content}
                              onComplete={() => {
                                const next = revealedCountRef.current + 1;
                                setRevealedCount(next);
                                revealedCountRef.current = next;
                              }}
                            />
                          ) : (
                            <p className="chat-msg-text">{message.content}</p>
                          )}
                        </div>
                      </article>
                    );
                  });
                  return items;
                })()}

                {(thinking || starting) && revealedCount >= storyMessages.length && (
                  <article className="chat-msg chat-msg-ai chat-msg-pending">
                    <p className="chat-msg-speaker">{AI_HOST_SPEAKER}</p>
                    <div className="chat-msg-bubble">
                      <p className="chat-msg-text">
                        {starting ? "正在撰写开场剧情，请稍候…" : "正在根据你的行动推演剧情，请稍候…"}
                        <span className="thinking-dots">
                          <span>.</span><span>.</span><span>.</span>
                        </span>
                      </p>
                    </div>
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

              {room && room.turnPhase === "bot" && room.status === "in_progress" && (
                <div className="fast-forward-bar">
                  <span className="fast-forward-hint">
                    {fastForwarded
                      ? "已快进，正在生成剩余 AI 行动…"
                      : `AI 机器人依次行动中，${room.players.filter(p => p.kind === "bot").length} 位机器人正在发挥…`}
                  </span>
                  {!fastForwarded && (
                    <button
                      type="button"
                      className="fast-forward-btn"
                      onClick={() => {
                        setFastForwarded(true);
                        fastForward(room.id);
                        setRevealedCount(storyMessages.length);
                        revealedCountRef.current = storyMessages.length;
                        setTypewriterDone(true);
                      }}
                    >
                      快进全部
                    </button>
                  )}
                </div>
              )}
              </div>

              <form onSubmit={handleSubmitTurn} className={`action-bar${isMyTurn && !thinking && typewriterDone ? " action-bar-my-turn" : ""}`}>
                {isMyTurn && !thinking && typewriterDone && (
                  <p className="turn-prompt">轮到你了，输入你的行动</p>
                )}
                <input
                  placeholder={
                    isMyTurn
                      ? "例如：我偷走地图 / 我观察谁最紧张 / 我悄悄跟上那个黑影…"
                      : room?.isProcessingTurn
                        ? "AI 机器人或主持人处理中…"
                        : `等待 ${currentTurnPlayer?.name ?? "其他玩家"} 行动`
                  }
                  value={action}
                  onChange={(event) => setAction(event.target.value)}
                  disabled={room?.status !== "in_progress" || !isMyTurn || room.isProcessingTurn}
                  className={isMyTurn && !thinking && typewriterDone ? "input-my-turn" : ""}
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

              <form onSubmit={handleChatSubmit} className="action-bar chat-action-bar">
                <input
                  placeholder="输入聊天消息..."
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  disabled={!room}
                  className="chat-input"
                />
                <button type="submit" disabled={!room || !chatInput.trim()}>
                  发送
                </button>
              </form>
            </>
          )}
        </section>

        <aside className={`panel roster-panel${sidebarRightOpen ? "" : " is-collapsed"}`}>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarRightOpen(!sidebarRightOpen)}
            title={sidebarRightOpen ? "收起侧栏" : "展开侧栏"}
          >
            {sidebarRightOpen ? "▶" : "◀"}
          </button>
          {sidebarRightOpen && (
          <>
          <h2>玩家与身份</h2>

          {room && room.status === "in_progress" && room.worldState.memory?.storySummary && (() => {
            const summary = room.worldState.memory.storySummary;
            const lines = summary.split("\n").filter(Boolean);
            const parts: { label: string; icon: string; text: string }[] = [];
            for (const line of lines) {
              const match = line.match(/^(.+?)[：:]\s*(.+)$/);
              if (match) {
                const rawLabel = match[1].trim();
                if (rawLabel.includes("目标")) continue;
                const icon =
                  rawLabel.includes("走向") ? "🧭" :
                  rawLabel.includes("真相") ? "💎" : "📌";
                parts.push({ label: rawLabel, icon, text: match[2].trim() });
              } else {
                parts.push({ label: "", icon: "📌", text: line.trim() });
              }
            }
            return (
              <div className="story-direction-card">
                <p className="story-direction-header">📜 故事走向</p>
                <div className="story-direction-list">
                  {parts.map((p, i) => (
                    <div key={i} className="story-direction-item">
                      <span className="story-direction-icon">{p.icon}</span>
                      <div className="story-direction-body">
                        {p.label && <span className="story-direction-label">{p.label}</span>}
                        <span className="story-direction-text">{p.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {room && room.status === "in_progress" && (
            <div className="atmo-card">
              <p className="atmo-title">{room.worldState.sceneTitle || room.worldState.currentLocation}</p>
              <p className="atmo-location">{room.worldState.currentLocation}</p>

              <div className="atmo-tags">
                {room.scenarioId === "midnight-train" && (<span className="atmo-tag">列车</span>)}
                {room.scenarioId === "office-dungeon" && (<span className="atmo-tag">地下城</span>)}
                {room.scenarioId === "noble-banquet" && (<span className="atmo-tag">宫廷</span>)}
                {room.worldState.tension <= 3 && (<span className="atmo-tag is-mood">平静</span>)}
                {room.worldState.tension > 3 && room.worldState.tension <= 6 && (<span className="atmo-tag is-mood">紧张</span>)}
                {room.worldState.tension > 6 && (<span className="atmo-tag is-danger">危急</span>)}
                {room.worldState.round > 0 && (<span className="atmo-tag">第{room.worldState.round}轮</span>)}
              </div>

              <div className="atmo-section">
                <p className="atmo-label">紧张度</p>
                <div className="atmo-tension">
                  <div className="atmo-tension-bar">
                    <div
                      className="atmo-tension-fill"
                      style={{ width: `${(room.worldState.tension / 10) * 100}%` }}
                    />
                  </div>
                  <span className="atmo-tension-num">{room.worldState.tension}/10</span>
                </div>
              </div>

            </div>
          )}

          <div className="sidebar-bgm">
            <BgmPlayer />
          </div>

          {systemMessages.length > 0 && (
            <div className="syslog-card">
              <p className="eyebrow">系统日志</p>
              <div className="syslog-list">
                {systemMessages.slice(-6).reverse().map((msg) => (
                  <p key={msg.id} className="syslog-item">{msg.content}</p>
                ))}
              </div>
            </div>
          )}

          {room?.worldState.clues && room.worldState.clues.length > 0 && (
            <div className="clue-card">
              <p className="eyebrow">Clues</p>
              {room.worldState.clues.map((clue) => (
                <p key={clue}>{clue}</p>
              ))}
            </div>
          )}

          {room?.players.map((player) => {
            const isExpanded = expandedPlayers.has(player.id);
            return (
              <article
                key={player.id}
                className={`player-card ${player.id === activePlayerId ? "is-me" : ""} ${
                  player.kind === "bot" ? "is-bot" : ""
                } ${currentTurnPlayer?.id === player.id ? "is-active-turn" : ""} ${
                  isExpanded ? "is-expanded" : ""
                }`}
              >
                <p className="player-name" onClick={() => togglePlayerExpand(player.id)}>
                  <span className="player-expand-icon">{isExpanded ? "▼" : "▶"}</span>
                  {player.name}
                  {player.isHost ? " · 房主" : ""}
                  {player.kind === "bot" ? " · AI" : ""}
                  {currentTurnPlayer?.id === player.id ? " · 行动中" : ""}
                </p>
                <p className="player-role">{player.roleCard?.role ?? "等待分配身份"}</p>
                {isExpanded && (
                  <div className="player-detail">
                    <p>{player.roleCard?.personality ?? "待开始"}</p>
                    <p>{player.roleCard?.backstory ?? "开始游戏后可见背景。"}</p>
                    <p>{player.roleCard?.secretGoal ?? "开始游戏后可见隐藏目标。"}</p>
                  </div>
                )}
              </article>
            );
          })}

          {!room && <p className="muted">玩家加入后会显示在这里。</p>}
          </>
          )}
        </aside>
      </section>
    </main>
  );
}

export default App;
