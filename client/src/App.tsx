import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import QRCode from "react-qr-code";
import {
  createRoom,
  fetchHealth,
  fetchRoom,
  fetchScenarios,
  joinRoom,
  selectRole,
  startAccusationVote,
  startRoom,
  submitTurn,
  toggleReady,
  updateRoomSettings
} from "./api";
import {
  AI_HOST_SPEAKER,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  Room,
  RoomMode,
  Scenario,
  ChatPost,
  getCurrentTurnPlayer,
  getTurnPhaseLabel
} from "../../shared/types";
import { BgmPlayer } from "./components/BgmPlayer";
import ChatComposer, { OutgoingChatPost } from "./components/ChatComposer";
import ChatPostCard from "./components/ChatPostCard";
import {
  clearActiveGameplaySession,
  clearGameplaySessionCache,
  clearPlayerSession,
  loadPlayerSession,
  resolvePlayerId,
  saveActiveGameplaySession,
  savePlayerSession
} from "./session";
import {
  AccusationResultPayload,
  AccusationVoteState,
  ChatMessage,
  useSocket,
  VoteState
} from "./useSocket";
import SceneRenderer from "./SceneRenderer";
import VoiceChat from "./VoiceChat";
import PlayerAgentAssistant from "./components/PlayerAgentAssistant";
import VoiceInput from "./VoiceInput";
import { TypewriterText } from "./components/TypewriterText";
import GameOutcomePage from "./pages/GameOutcomePage";
import {
  gameEndMatchesCurrentRun,
  resolveActiveBehaviorReviews,
  resolveActiveGameEnd,
  shouldNavigateToOutcomePage,
  shouldNavigateToReviewsPage
} from "./outcomeNavigation";
import GameReviewsPage from "./pages/GameReviewsPage";
import GameRevealPage from "./pages/GameRevealPage";
import { resolveActiveMysteryReveal } from "./revealNavigation";

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationPathRef = useRef(location.pathname);
  locationPathRef.current = location.pathname;

  const goToOutcomePage = useCallback(() => {
    if (locationPathRef.current !== "/outcome") {
      navigate("/outcome", { replace: true });
    }
  }, [navigate]);

  const goToReviewsPage = useCallback(() => {
    if (locationPathRef.current !== "/reviews") {
      navigate("/reviews", { replace: true });
    }
  }, [navigate]);

  /** 用户已进入结案子页面时，不再强制跳回点评页 */
  const isOnPostGameSubPage = useCallback(() => {
    const path = locationPathRef.current;
    return path === "/reveal" || path === "/outcome";
  }, []);
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
  const [revealedCount, setRevealedCount] = useState(0);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(new Set());
  const [myPlayerName, setMyPlayerName] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);

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
  const [voteResult, setVoteResult] = useState<{ tally: Record<string, number>; winner: string } | null>(null);
  const [voters, setVoters] = useState<string[]>([]);
  const [accusationVote, setAccusationVote] = useState<AccusationVoteState | null>(null);
  const [accusationChoice, setAccusationChoice] = useState("");
  const [accusationVoters, setAccusationVoters] = useState<string[]>([]);
  const [accusationResult, setAccusationResult] = useState<AccusationResultPayload | null>(null);
  const [accusationLoading, setAccusationLoading] = useState(false);

  // chat
  const [chatPosts, setChatPosts] = useState<ChatMessage[]>([]);
  const [activeTab, setActiveTab] = useState<"story" | "chat">("story");
  const [infoModal, setInfoModal] = useState<"必做" | "线索" | "日志" | "规则" | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatListRef = useRef<HTMLDivElement>(null);
  const chatTabActiveRef = useRef(false);

  // auto-scroll chat
  useEffect(() => {
    chatTabActiveRef.current = activeTab === "chat";
    if (activeTab === "chat" && chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
    }
  }, [chatPosts.length, activeTab]);

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

  // 动态切换全局背景图
  useEffect(() => {
    const bgMap: Record<string, string> = {
      "midnight-train": "/bg.png",
      "office-dungeon": "/bg-office.png",
      "noble-banquet": "/bg-banquet.png",
    };
    if (room?.scenarioId && bgMap[room.scenarioId]) {
      document.body.style.backgroundImage = `url('${bgMap[room.scenarioId]}')`;
      document.body.style.backgroundSize = "cover";
      document.body.style.backgroundPosition = "center center";
      document.body.style.backgroundRepeat = "no-repeat";
      document.body.style.backgroundAttachment = "fixed";
      document.body.style.backgroundColor = "transparent";
    } else {
      // 大厅/无房间时显示默认背景图
      document.body.style.backgroundImage = `url('/bg-default.png')`;
      document.body.style.backgroundSize = "cover";
      document.body.style.backgroundPosition = "center center";
      document.body.style.backgroundRepeat = "no-repeat";
      document.body.style.backgroundAttachment = "fixed";
      document.body.style.backgroundColor = "transparent";
    }
  }, [room?.scenarioId, room]);

  function resetAccusationAndVoteState() {
    setAccusationVote(null);
    setAccusationChoice("");
    setAccusationVoters([]);
    setAccusationResult(null);
    setAccusationLoading(false);
    setVote(null);
    setVoteChoice("");
    setVoteResult(null);
    setVoters([]);
  }

  roomRef.current = room;

  const prevGameInstanceIdRef = useRef<string | undefined>();

  useEffect(() => {
    if (
      prevGameInstanceIdRef.current &&
      room?.gameInstanceId &&
      prevGameInstanceIdRef.current !== room.gameInstanceId
    ) {
      resetAccusationAndVoteState();
    }

    prevGameInstanceIdRef.current = room?.gameInstanceId || undefined;
  }, [room?.gameInstanceId]);

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
        .then((fetched) => {
          if (fetched.status === "ended") {
            clearPlayerSession();
            clearActiveGameplaySession();
            clearGameplaySessionCache();
            return;
          }

          setRoom(fetched);
        })
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!room?.id || !playerId || !myPlayerName) {
      return;
    }

    if (room.status === "ended") {
      clearPlayerSession();
      clearActiveGameplaySession();
      return;
    }

    savePlayerSession({
      roomId: room.id,
      playerId,
      playerName: myPlayerName
    });

    if (room.status === "in_progress" && room.gameInstanceId) {
      saveActiveGameplaySession(room.id, room.gameInstanceId);
    }
  }, [room?.id, room?.status, room?.gameInstanceId, playerId, myPlayerName]);

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
        .then((fetched) => {
          setRoom(fetched);
          if (fetched.status === "ended" && !isOnPostGameSubPage()) {
            goToReviewsPage();
          }
        })
        .catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [room?.id, loading, thinking, starting, goToReviewsPage, isOnPostGameSubPage]);

  // 点评页 / 谜底页：更频繁拉取房间状态
  useEffect(() => {
    if (!room?.id || (location.pathname !== "/reviews" && location.pathname !== "/reveal")) {
      return;
    }

    const refresh = () => {
      fetchRoom(room.id)
        .then(setRoom)
        .catch(() => undefined);
    };

    refresh();
    const timer = window.setInterval(refresh, 1200);
    return () => window.clearInterval(timer);
  }, [room?.id, location.pathname]);

  // scroll to latest message
  useEffect(() => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [room?.messages.length, revealedCount, thinking, starting]);

  // socket callbacks
  const onRoomState = useCallback(
    (next: Room) => {
      setRoom(next);
      if (next.status === "ended") {
        setAccusationVote(null);
        setAccusationVoters([]);
        setAccusationChoice("");
        if (!isOnPostGameSubPage()) {
          goToReviewsPage();
        }
      }
      // 同步 chatPosts（解决 socket 不可靠导致看不到他人消息的问题）
      if (next.chatPosts && next.chatPosts.length > 0) {
        setChatPosts((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const newPosts = next.chatPosts.filter((p) => !existingIds.has(p.id));
          if (newPosts.length > 0) {
            return [...prev, ...newPosts];
          }
          return prev;
        });
      }
      // 如果房间状态中包含 activeAccusation，同步到本地投票状态
      if (next.worldState.activeAccusation && next.status === "in_progress") {
        const active = next.worldState.activeAccusation;
        setAccusationVote(active);
        setAccusationVoters(active.voterNames ?? []);
        setAccusationResult(null);
      } else if (!next.worldState.activeAccusation && next.status === "in_progress") {
        // 投票已结束或不存在
        setAccusationVote(null);
      }
    },
    [goToReviewsPage, isOnPostGameSubPage]
  );

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

  const onAccusationStart = useCallback((payload: AccusationVoteState) => {
    const current = roomRef.current;
    if (!current?.gameInstanceId || payload.gameInstanceId !== current.gameInstanceId) {
      return;
    }

    setAccusationVote(payload);
    setAccusationChoice("");
    setAccusationVoters([]);
    setAccusationResult(null);
    goToOutcomePage();
  }, [goToOutcomePage]);

  const onAccusationUpdate = useCallback((info: { voterName: string; voted: boolean }) => {
    setAccusationVoters((prev) => [...prev, info.voterName]);
  }, []);

  const onAccusationResult = useCallback((result: AccusationResultPayload) => {
    const current = roomRef.current;
    if (!current?.gameInstanceId || result.gameInstanceId !== current.gameInstanceId) {
      return;
    }

    setAccusationResult(result);
    setAccusationVote(null);
    goToOutcomePage();
  }, [goToOutcomePage]);

  const onChatPost = useCallback((post: ChatMessage) => {
    setChatPosts((prev) => {
      if (prev.some((item) => item.id === post.id)) {
        return prev;
      }
      return [...prev, post];
    });
    if (!chatTabActiveRef.current) {
      setUnreadCount((prev) => prev + 1);
    }
  }, []);

  const onError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  const { submitVote, submitAccusation, sendChatPost, socket } = useSocket({
    roomId: room?.id ?? null,
    onRoomState,
    onVoteStart,
    onVoteUpdate,
    onVoteResult,
    onAccusationStart,
    onAccusationUpdate,
    onAccusationResult,
    onChatPost,
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

  const storyMessages = useMemo(() => {
    if (!room?.messages) return [];
    return room.messages.filter((msg) => msg.type !== "system");
  }, [room?.messages]);

  const systemMessages = useMemo(() => {
    if (!room?.messages) return [];
    return room.messages.filter((msg) => msg.type === "system");
  }, [room?.messages]);

  /* 自动滚动 AI 主持人消息到底部 */
  useEffect(() => {
    const el = document.getElementById("narrator-scroll");
    if (!el) return;
    // 如果用户不在底部附近（正在看历史），不强制滚动
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [storyMessages]);

  const currentTurnPlayer = room ? getCurrentTurnPlayer(room) : undefined;
  const isMyTurn = Boolean(
    room?.turnPhase === "human" &&
      currentTurnPlayer?.kind === "human" &&
      me?.kind === "human" &&
      currentTurnPlayer.id === activePlayerId
  );
  const humanCount = room?.players.filter((player) => player.kind === "human").length ?? 0;
  const amHost = room?.hostPlayerId === activePlayerId;
  const allHumansHaveRole = room
    ? room.players.filter((p) => p.kind === "human").every((p) => p.roleSlotId)
    : false;
  /** 所有真人已选角即可由房主开局（选角后自动视为已准备） */
  const canHostStartGame = allHumansHaveRole;

  function claimerForSlot(slotId: string) {
    if (!room) {
      return undefined;
    }
    const slot = room.roleSlots.find((item) => item.id === slotId);
    if (!slot?.claimedByPlayerId) {
      return undefined;
    }
    return room.players.find((player) => player.id === slot.claimedByPlayerId);
  }

  const lobbyBotCount = room?.players.filter((player) => player.kind === "bot").length ?? 0;
  const rolesFilledByAi =
    allHumansHaveRole && lobbyBotCount > 0 && room?.status === "lobby";

  const accusationVoteActive =
    Boolean(
      accusationVote &&
        room?.gameInstanceId &&
        accusationVote.gameInstanceId === room.gameInstanceId
    );

  const accusationResultActive =
    Boolean(
      accusationResult &&
        room?.gameInstanceId &&
        accusationResult.gameInstanceId === room.gameInstanceId
    );

  const gameEndMatchesRun = room ? gameEndMatchesCurrentRun(room) : true;
  const activeGameEnd = room ? resolveActiveGameEnd(room) : null;
  const activeBehaviorReviews = room ? resolveActiveBehaviorReviews(room) : null;
  const activeMysteryReveal = room ? resolveActiveMysteryReveal(room) : null;

  const shouldOpenReviewsPage = shouldNavigateToReviewsPage(room);
  const shouldOpenOutcomePage = shouldNavigateToOutcomePage(room, {
    accusationVoteActive: Boolean(accusationVoteActive),
    accusationResultActive: Boolean(accusationResultActive)
  });

  useEffect(() => {
    if (isOnPostGameSubPage()) {
      return;
    }

    if (shouldOpenReviewsPage) {
      goToReviewsPage();
      return;
    }

    if (shouldOpenOutcomePage) {
      goToOutcomePage();
    }
  }, [
    shouldOpenReviewsPage,
    shouldOpenOutcomePage,
    goToReviewsPage,
    goToOutcomePage,
    isOnPostGameSubPage
  ]);

  // 定时轮询房间状态（socket 不可靠时的兜底）
  useEffect(() => {
    if (!room?.id || room.status !== "in_progress") return;
    const interval = setInterval(async () => {
      try {
        const updated = await fetchRoom(room.id);
        onRoomState(updated);
      } catch {
        // 忽略轮询错误
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [room?.id, room?.status, onRoomState]);

  async function handleSelectRole(roleSlotId: string) {
    if (!room || !activePlayerId) {
      return;
    }

    const nextId = me?.roleSlotId === roleSlotId ? null : roleSlotId;
    setLoading(true);
    setError("");

    try {
      const updated = await selectRole(room.id, {
        playerId: activePlayerId,
        roleSlotId: nextId
      });
      setRoom(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择角色失败");
    } finally {
      setLoading(false);
    }
  }

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
      setChatPosts(session.room.chatPosts || []);
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
      setChatPosts(session.room.chatPosts || []);
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
    clearActiveGameplaySession();
    clearGameplaySessionCache();
    resetAccusationAndVoteState();
    setRoom(null);
    setChatPosts([]);
    setPlayerId("");
    setMyPlayerName("");
    setRoomCode("");
    setError("");
    setFromInvite(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    navigate("/", { replace: true });
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
      if (nextRoom.status === "ended" && !isOnPostGameSubPage()) {
        goToReviewsPage();
      }
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

  async function handlePublishChat(post: OutgoingChatPost) {
    if (!room) {
      setError("请先创建或加入房间后再发帖");
      return;
    }
    if (!me) {
      setError("无法识别你的玩家身份，请重新加入房间");
      return;
    }
    setError("");

    const payload = {
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      playerName: me.name,
      type: post.type,
      content: post.content,
      mediaDataUrl: post.mediaDataUrl,
    };

    // 立即把消息加到本地 chatPosts，确保界面即时显示
    const localMsg: ChatPost = {
      ...payload,
      createdAt: new Date().toISOString(),
    };
    setChatPosts(prev => [...prev, localMsg]);

    // 通过 HTTP 发送确保消息送达服务端
    try {
      const resp = await fetch(`/api/rooms/${room.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setError(err.error || "发送失败");
      }
    } catch (e) {
      setError("网络错误，发送失败");
    }
  }

  const canChatPost = Boolean(room && me);
  const chatComposerHint = !room
    ? roomCode
      ? "正在加载房间…"
      : "请先在左侧创建或加入房间，才能发帖"
    : !me
      ? "无法识别玩家身份，请重新加入房间"
      : "图片点「图片」；语音按住「语音」至少 1 秒再松开；文字点「发文字」";

  function handleVoteSubmit(event: FormEvent) {
    event.preventDefault();
    if (!room || !voteChoice) return;
    submitVote(room.id, activePlayerId, voteChoice);
  }

  async function handleStartAccusation() {
    if (!room || !activePlayerId || me?.kind !== "human") {
      return;
    }

    if (!window.confirm("发起「指认真凶」投票？全体真人投票后多数票直接结案（猜对=推理成功，猜错=推理错误）。")) {
      return;
    }

    setAccusationLoading(true);
    setError("");

    try {
      const result = await startAccusationVote(room.id, { playerId: activePlayerId });
      // 如果服务器返回了 voteState，直接设置本地状态（socket 不可用时也能工作）
      if (result.voteState) {
        setAccusationVote(result.voteState as AccusationVoteState);
        setAccusationChoice("");
        setAccusationVoters([]);
        setAccusationResult(null);
      }
      navigate("/outcome");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发起指认真凶失败");
    } finally {
      setAccusationLoading(false);
    }
  }

  async function handleAccusationSubmit(event: FormEvent) {
    event.preventDefault();
    if (!room || !accusationChoice) {
      return;
    }

    setError("");

    // 优先使用 HTTP，socket 作为补充
    try {
      const resp = await fetch(`/api/rooms/${room.id}/accusation-submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: activePlayerId, accusedPlayerId: accusationChoice })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setError(err.error || "投票提交失败");
      } else {
        // 投票成功，更新本地已投票者列表
        const data = await resp.json();
        if (data.voterName) {
          setAccusationVoters(prev => prev.includes(data.voterName) ? prev : [...prev, data.voterName]);
        }
      }
    } catch (e) {
      setError("网络错误，投票提交失败");
    }

    // 同时通过 socket 发送（如果连接的话）
    submitAccusation(room.id, activePlayerId, accusationChoice);
  }

  const quickEmojis = ["😀","😂","🤣","😍","🤔","😎","👍","👎","🎉","❤️","🔥","💀","👀","🎲","🐉","⚔️","🛡️","🗡️","🏰","🌙","✨","💬"];

  if (location.pathname === "/reviews") {
    return (
      <GameReviewsPage
        room={room}
        reviews={activeBehaviorReviews}
        gameEnd={activeGameEnd}
        activePlayerId={activePlayerId}
        onExitGame={handleExitGame}
      />
    );
  }

  if (location.pathname === "/reveal") {
    return (
      <GameRevealPage
        room={room}
        reveal={activeMysteryReveal}
        gameEnd={activeGameEnd}
        onBack={() => navigate("/reviews")}
      />
    );
  }

  if (location.pathname === "/outcome") {
    return (
      <GameOutcomePage
        room={room}
        gameEnd={activeGameEnd}
        gameEndPending={Boolean(room?.status === "ended" && !activeGameEnd)}
        gameEndMatchesCurrentRun={gameEndMatchesRun}
        accusationVote={accusationVote}
        accusationVoteActive={Boolean(accusationVoteActive)}
        accusationChoice={accusationChoice}
        accusationVoters={accusationVoters}
        accusationResult={accusationResult}
        accusationResultActive={Boolean(accusationResultActive)}
        accusationLoading={accusationLoading}
        canVoteAccusation={me?.kind === "human"}
        canLaunchAccusation={me?.kind === "human"}
        aiReady={aiMode === "ai-ready"}
        error={error}
        onAccusationChoiceChange={setAccusationChoice}
        onAccusationSubmit={handleAccusationSubmit}
        onStartAccusation={handleStartAccusation}
        onExitGame={handleExitGame}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Hackathon Frame</p>
        <div className="hero-title-row">
          <h1>AI 地下城</h1>
          <button className="rules-btn" onClick={() => setInfoModal("规则")}>规则说明</button>
        </div>
        {aiMode === "no-api-key" && (
          <p className="error-text api-banner">
            未检测到 DeepSeek API Key。请在项目根目录创建 `.env` 并设置 `DEEPSEEK_API_KEY`，然后重启 `npm run dev`。
          </p>
        )}
        <BgmPlayer />
      </section>

      <section className={`grid${leftCollapsed && rightCollapsed ? " both-collapsed" : leftCollapsed ? " left-collapsed" : rightCollapsed ? " right-collapsed" : ""}`}>
        <aside className={`panel controls${leftCollapsed ? " collapsed" : ""}`}>
          {leftCollapsed ? (
            <span className="panel-expand-tab" onClick={() => setLeftCollapsed(false)}>
              ◀ 房间操作
            </span>
          ) : (
            <>
          <div className="panel-controls-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>房间操作</h2>
            <button className="panel-toggle" onClick={() => setLeftCollapsed(true)} title="折叠面板">
              ▶
            </button>
          </div>

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

              {error && <p className="error-text" style={{ marginTop: 4 }}>{error}</p>}

              <button type="submit" disabled={loading}>
                {gameMode === "single" ? "开始冒险" : "创建房间"}
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

              {error && <p className="error-text" style={{ marginTop: 4 }}>{error}</p>}

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


              {room.status === "ended" && (
                <div className="outcome-sidebar-prompt">
                  <p className="quest-title">本局已结束</p>
                  <Link to="/reviews" className="outcome-sidebar-link">
                    查看全员行为点评 →
                  </Link>
                  <Link to="/reveal" className="outcome-sidebar-link" style={{ marginTop: 8 }}>
                    查看故事谜底 →
                  </Link>
                </div>
              )}

              {room.status === "in_progress" && me?.kind === "human" && (
                <div className="outcome-sidebar-prompt">
                  <Link to="/outcome" className="outcome-sidebar-link">
                    ⚖️ 指认真凶 / 投票结案 →
                  </Link>
                  <p className="muted accusation-launch-hint">
                    在独立结案页发起投票或参与指认，不影响本页对局操作。
                  </p>
                </div>
              )}

              {room.status === "lobby" && room.roleSlots.length > 0 && (
                <div className="role-picker">
                  <p className="quest-title">选择角色（{room.maxPlayers} 人局）</p>
                    <p className="muted role-picker-hint">
                    共 {room.roleSlots.length} 个角色：真人先选，当<strong>所有真人</strong>都选好后，剩余角色会由 AI 补位，房主即可开始游戏。
                  </p>
                  {rolesFilledByAi && (
                    <p className="lobby-ai-banner">
                      🤖 已有 {lobbyBotCount} 个角色由 AI 补位。房主现在可以点「开始游戏」。
                    </p>
                  )}
                  {!allHumansHaveRole && humanCount > 0 && (
                    <p className="muted" style={{ marginBottom: 10 }}>
                      等待所有真人选角（{room.players.filter((p) => p.kind === "human" && p.roleSlotId).length}/
                      {humanCount}）
                    </p>
                  )}
                  <div className="role-picker-grid">
                    {room.roleSlots.map((slot) => {
                      const claimer = claimerForSlot(slot.id);
                      const isMine = me?.roleSlotId === slot.id;
                      const isBot = claimer?.kind === "bot";
                      const isOtherHuman = claimer?.kind === "human" && !isMine;
                      const isDisabled = loading || isOtherHuman || isBot;

                      return (
                        <button
                          key={slot.id}
                          type="button"
                          className={`role-slot-card ${isMine ? "is-mine" : ""} ${
                            isOtherHuman || isBot ? "is-taken" : ""
                          } ${isBot ? "is-bot" : ""}`}
                          disabled={isDisabled}
                          onClick={() => void handleSelectRole(slot.id)}
                        >
                          <p className="role-slot-name">{slot.role}</p>
                          <p className="role-slot-backstory">{slot.backstory}</p>
                          {isMine && (
                            <p className="role-slot-secret">隐藏目标：{slot.secretGoal}</p>
                          )}
                          <p className="role-slot-status">
                            {isMine
                              ? "已选择 · 再点取消"
                              : isBot
                                ? `🤖 ${claimer.name} 扮演`
                                : isOtherHuman
                                  ? `已被 ${claimer.name} 选择`
                                  : "点击选择此角色"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
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

                  {amHost && !allHumansHaveRole && (
                    <p className="muted" style={{ marginTop: 8, color: "#f0a040" }}>
                      请先选择你的角色…
                    </p>
                  )}
                  {amHost && allHumansHaveRole && rolesFilledByAi && (
                    <p className="muted" style={{ marginTop: 8, color: "#6a9a6a" }}>
                      所有真人已选角，剩余角色由 AI 补位，可以开始游戏。
                    </p>
                  )}
                  {amHost && !allHumansHaveRole && (
                    <p className="muted" style={{ marginTop: 8, color: "#f0a040" }}>
                      等待所有真人选角（每人点选上方角色卡）…
                    </p>
                  )}
                  {amHost && (
                    <button
                      onClick={handleStart}
                      disabled={
                        loading ||
                        starting ||
                        aiMode !== "ai-ready" ||
                        !canHostStartGame
                      }
                    >
                      {starting
                        ? "AI 撰写开场…"
                        : canHostStartGame
                          ? "开始游戏"
                          : "等待全员选角"}
                    </button>
                  )}
                  {!amHost && !me?.roleSlotId && (
                    <p className="muted" style={{ marginTop: 8, color: "#f0a040" }}>
                      请先在上方选择角色
                    </p>
                  )}
                  {!amHost && me?.roleSlotId && (
                    <p className="muted" style={{ marginTop: 8, color: "#6a9a6a" }}>
                      {me.ready ? "已选角并就绪，等待房主开始游戏" : "已选角，等待房主开始"}
                    </p>
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

          {/* Voice Chat */}
          {room && me && (
            <VoiceChat
              roomId={room.id}
              playerId={me.id}
              playerName={me.name}
            />
          )}

          {/* 玩家与身份 */}


          {room?.players.map((player) => {
            const isExpanded = expandedPlayers.has(player.id);
            const roleName =
              player.roleCard?.role ??
              (player.roleSlotId
                ? room.roleSlots.find((slot) => slot.id === player.roleSlotId)?.role
                : "未选角");

            return (
            <article
              key={player.id}
              className={`player-card ${player.id === activePlayerId ? "is-me" : ""} ${
                player.kind === "bot" ? "is-bot" : ""
              } ${currentTurnPlayer?.id === player.id ? "is-active-turn" : ""} ${
                isExpanded ? "is-expanded" : ""
              }`}
              onClick={() => {
                setExpandedPlayers((prev) => {
                  const next = new Set(prev);
                  if (next.has(player.id)) next.delete(player.id);
                  else next.add(player.id);
                  return next;
                });
              }}
            >
              <p className="player-name">
                {player.name}
                {player.isHost ? " · 房主" : ""}
                {player.kind === "bot" ? " · AI" : ""}
                {currentTurnPlayer?.id === player.id ? " · 行动中" : ""}
                <span className="player-expand-arrow">{isExpanded ? " ▾" : " ▸"}</span>
              </p>
              <p>{roleName}</p>
              {isExpanded && (
                <>
                  <p className="player-detail">
                    <span className="player-detail-label">性格：</span>
                    {player.roleCard?.personality ?? (player.roleSlotId ? "已选角，待开局" : "待选角")}
                  </p>
                  <p className="player-detail">
                    <span className="player-detail-label">背景：</span>
                    {player.roleCard?.backstory ??
                      room.roleSlots.find((slot) => slot.id === player.roleSlotId)?.backstory ??
                      "大厅选角后可见背景。"}
                  </p>
                  <p className="player-detail">
                    <span className="player-detail-label">隐藏目标：</span>
                    {player.id === activePlayerId && player.roleSlotId
                      ? room.roleSlots.find((slot) => slot.id === player.roleSlotId)?.secretGoal
                      : player.roleCard?.secretGoal ?? "开局后可见隐藏目标。"}
                  </p>
                </>
              )}
            </article>
            );
          })}

          {!room && <p className="muted">玩家加入后会显示在这里。</p>}

          {me && (
            <div className="me-card">
              <p className="eyebrow">Your POV</p>
              <h3>{me.name}</h3>
              <p>{me.roleCard?.role ?? "还未获得角色卡"}</p>
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

          {accusationVoteActive && accusationVote && room && (
            <div className="outcome-sidebar-prompt">
              <p className="quest-title">指认投票进行中</p>
              <Link to="/outcome" className="outcome-sidebar-link">
                前往结案页投票 →
              </Link>
            </div>
          )}

          {error && !room && <p className="error-text">{error}</p>}
            </>
          )}
        </aside>

        {/* ── 中央场景区 ── */}
        <section className={`panel story-panel scene-only${room?.status !== "in_progress" ? " panel-transparent" : ""}`}>
          {room?.status === "in_progress" && (
            <div className="scene-header-bar">
              <span className="scene-header-title">
                {scenarios.find((item) => item.id === room.scenarioId)?.title ?? room.scenarioId}
              </span>
              <div className="scene-info-btns">
                {(["必做", "线索", "日志"] as const).map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="scene-info-btn"
                    onClick={() => setInfoModal(label)}
                  >
                    {label === "必做" ? "本局必做" : label === "线索" ? "线索推理" : "故事背景"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {room?.status === "in_progress" && (
            <div className="scene-wrapper">
              <SceneRenderer
                room={room}
                selectedObjectId={selectedObjectId}
                focusedSceneObjectId={focusedSceneObjectId}
                onSelectObject={setSelectedObjectId}
                onFocusObject={setFocusedSceneObjectId}
                onClearFocus={() => setFocusedSceneObjectId("")}
                onRunAction={runAction}
                loading={loading}
                narratorMessages={storyMessages.filter((m) => m.type === "ai" && m.speaker === "AI主持人")}
              />
            </div>
          )}
          {room?.status !== "in_progress" && !room && (
            <div className="empty-state">
              <p>先创建或加入一个房间。</p>
            </div>
          )}
          {room?.status === "lobby" && (
            <div className="empty-state">
              <p>等待房主开局…</p>
            </div>
          )}
        </section>

        {/* ── 右侧推理交互区 ── */}
        <aside className={`panel interaction-panel${rightCollapsed ? " collapsed" : ""}`}>
          {rightCollapsed ? (
            <span className="panel-expand-tab" onClick={() => setRightCollapsed(false)}>
              推理交互区 ▶
            </span>
          ) : (
            <>
          <div className="panel-controls-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>推理交互区</h2>
            <button className="panel-toggle" onClick={() => setRightCollapsed(true)} title="折叠面板">
              ◀
            </button>
          </div>

          <div className="panel-header" style={{ flexShrink: 0 }}>
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
            <span>{activeTab === "story" ? (isMyTurn ? "轮到你了" : "等待行动") : "自由聊天"}</span>
          </div>

          {activeTab === "story" && (
            <>
              <div className="story-scroll-area" ref={messageListRef}>
                <div className="message-list">
                  {storyMessages.filter(msg => !(msg.type === "ai" && msg.speaker === AI_HOST_SPEAKER)).map((message) => (
                    <article
                      key={message.id}
                      className={`message message-${message.type} ${
                        message.variant === "tease"
                          ? "message-tease"
                          : message.variant === "brief"
                            ? "message-brief"
                            : message.variant === "ending"
                              ? "message-ending"
                              : ""
                      }`}
                    >
                      <p className="message-speaker">{message.speaker}</p>
                      <p>
                        <TypewriterText
                          text={message.content}
                          onComplete={() => setRevealedCount((c) => c + 1)}
                        />
                      </p>
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
                    </div>
                  )}
                </div>
              </div>

              {error && activeTab === "story" && <p className="error-text story-error">{error}</p>}

              <div className="action-bar-wrap">
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
                      setAction((prev) => (prev ? `${prev} ${text}` : text));
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

                {room?.status === "in_progress" && me?.kind === "human" && (
                  <PlayerAgentAssistant
                    room={room}
                    playerId={activePlayerId}
                    me={me}
                    draftAction={action}
                    onApplySuggestion={(text) => setAction(text)}
                    disabled={aiMode !== "ai-ready" || loading || thinking}
                  />
                )}
              </div>
            </>
          )}

          {activeTab === "chat" && (
            <>
              {error && <p className="error-text story-error">{error}</p>}
              <div className="message-list chat-list" ref={chatListRef}>
                {chatPosts.length === 0 && (
                  <div className="empty-state" style={{ minHeight: 120 }}>
                    <p>还没有帖子。</p>
                    <p>在这里发帖交流：支持文字、图片和语音。</p>
                  </div>
                )}
                {chatPosts.map((post) => (
                  <ChatPostCard key={post.id} post={post} isSelf={post.playerName === me?.name} />
                ))}
              </div>

              <div className="chat-composer-dock">
                <ChatComposer
                  canPost={canChatPost}
                  hint={chatComposerHint}
                  quickEmojis={quickEmojis}
                  onPublish={handlePublishChat}
                  onError={setError}
                />
              </div>
            </>
          )}
            </>
          )}
        </aside>
      </section>

      {/* 信息弹窗 */}
      {(infoModal === "规则" || (infoModal && room)) && (
        <div className="info-modal-overlay" onClick={() => setInfoModal(null)}>
          <div className="info-modal" onClick={(e) => e.stopPropagation()}>
            <button className="info-modal-close" onClick={() => setInfoModal(null)}>×</button>
            <h3 className="info-modal-title">
              {infoModal === "必做" ? "本局必做" : infoModal === "线索" ? "线索推理" : infoModal === "日志" ? "故事背景" : "规则说明"}
            </h3>
            <div className="info-modal-body">
              {infoModal === "必做" && (
                <>
                  {room?.worldState.objectives && room?.worldState.objectives.filter((o: any) => o.scope === "session").length > 0 ? (
                    <ul className="modal-quest-list">
                      {room?.worldState.objectives
                        .filter((o: any) => o.scope === "session")
                        .map((o: any, i: number) => (
                          <li key={o.id || i} className={o.status === "completed" ? "quest-done" : "quest-pending"}>
                            <span className="quest-check">{o.status === "completed" ? "✅" : "⬜"}</span>
                            <span className="quest-text">{o.text}</span>
                            {o.evidence && <span className="quest-evidence">—— {o.evidence}</span>}
                          </li>
                        ))}
                    </ul>
                  ) : (room?.worldState.quests && room?.worldState.quests.length > 0) ? (
                    <ul className="modal-quest-list">
                      {room?.worldState.quests.map((q: string, i: number) => (
                        <li key={i} className="quest-pending">
                          <span className="quest-check">⬜</span>
                          <span className="quest-text">{q}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="modal-empty">暂无任务目标，游戏开始后将更新。</p>
                  )}
                </>
              )}
              {infoModal === "线索" && (
                <>
                  {(room?.worldState.investigationClues?.length ?? room?.worldState.clues?.length ?? 0) > 0 ? (
                    <ul className="modal-clue-list">
                      {(room?.worldState.investigationClues ?? room?.worldState.clues ?? []).map((clue: any, i: number) => (
                        <li key={i}>
                          <span className="clue-text">{typeof clue === "string" ? clue : clue.text}</span>
                          {typeof clue !== "string" && clue.source && <span className="clue-founder">—— {clue.source}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="modal-empty">暂无线索，调查后将在此显示。</p>
                  )}
                </>
              )}
              {infoModal === "日志" && (
                <>
                  {(() => {
                    const sc = scenarios.find((s: any) => s.id === room?.scenarioId);
                    return sc?.background ? (
                      <div className="modal-briefing" style={{whiteSpace:'pre-line',fontSize:'0.95rem',lineHeight:1.9}}>
                        {sc.background}
                      </div>
                    ) : (
                      <p className="modal-empty">暂无故事背景。</p>
                    );
                  })()}
                </>
              )}
              {infoModal === "规则" && (
                <div className="rules-content">
                  <h4>一、游戏概述</h4>
                  <p>AI 地下城是一款由 AI 主持人驱动的多人在线剧本杀游戏。玩家在虚拟场景中扮演不同角色，通过调查、对话和推理，找出隐藏在众人中的真凶。</p>

                  <h4>二、剧本选择</h4>
                  <ul>
                    <li><strong>午夜列车</strong>（悬疑推理）——被困在深夜列车上，每隔一段时间就会有人离奇死去</li>
                    <li><strong>社畜地下城</strong>（黑色幽默）——在荒诞公司求生，终极 boss 是从不露面的 CEO</li>
                    <li><strong>贵族晚宴</strong>（宫斗修罗场）——受邀参加贵族晚宴，每个人都带着见不得人的秘密</li>
                  </ul>

                  <h4>三、游戏流程</h4>
                  <ol>
                    <li><strong>创建/加入房间</strong>：房主选择剧本创建房间，其他玩家通过房间号或邀请链接加入</li>
                    <li><strong>选择角色</strong>：所有真人玩家进入房间后，从可用角色中选择自己的身份。所有真人选完角色后，剩余角色由 AI 机器人补位</li>
                    <li><strong>故事开场</strong>：AI 主持人根据剧本设定展开剧情，向所有玩家介绍背景和初始线索</li>
                    <li><strong>回合制行动</strong>：每轮真人玩家依次输入指令（调查、对话、搜证等），然后 AI 机器人依次行动</li>
                    <li><strong>指认真凶</strong>：任意时刻可发起投票指认，所有真人玩家投票，多数票决</li>
                  </ol>

                  <h4>四、本局必做</h4>
                  <p>每个剧本有一组"本局必做"任务，玩家可以在游戏中随时查看进度。当玩家完成某个必做任务时，清单会自动打勾标记。</p>

                  <h4>五、胜利条件</h4>
                  <p>当满足以下<strong>两个条件</strong>时，剧本杀胜利收官：</p>
                  <ol>
                    <li>所有"本局必做"任务全部完成（清单全部打勾）</li>
                    <li>玩家在与 AI 主持人对话时<strong>成功指出真凶</strong></li>
                  </ol>
                  <p>如果指认了错误的角色，AI 主持人会给出否定证据引导继续推理。</p>

                  <h4>六、交流与互动</h4>
                  <ul>
                    <li><strong>推理交互区</strong>：右侧面板的"交流"标签页可以发送文字消息，与房间内其他玩家实时交流</li>
                    <li><strong>故事流</strong>：右侧面板的"故事流"标签页展示 AI 主持人的叙事和剧情推进</li>
                    <li><strong>中间栏</strong>：AI 主持人发布的重要信息会叠加显示在场景图片上，可上下滚动查看</li>
                  </ul>

                  <h4>七、投票规则</h4>
                  <ul>
                    <li>任意真人玩家可以发起"指认真凶投票"</li>
                    <li>所有真人玩家需在倒计时内完成投票</li>
                    <li>多数票决定指认结果</li>
                    <li>指认正确 = 推理成功；指认错误 = 推理失败</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
