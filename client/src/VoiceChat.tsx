import { useCallback, useEffect, useRef, useState } from "react";
import type { VoicePeer, VoiceChunk } from "../../shared/types";

interface Props {
  roomId: string | null;
  playerId: string;
  playerName: string;
  disabled?: boolean;
}

export default function VoiceChat({ roomId, playerId, playerName, disabled }: Props) {
  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState<VoicePeer[]>([]);
  const [micError, setMicError] = useState(false);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [supported] = useState(() => !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder);

  const localStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkIndexRef = useRef(0);
  const audioQueueRef = useRef<VoiceChunk[]>([]);
  const playingRef = useRef(false);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // ─── Play audio chunk ───
  const playNextChunk = useCallback(() => {
    if (playingRef.current || audioQueueRef.current.length === 0) return;
    playingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;
    try {
      const byteStr = atob(chunk.data);
      const ab = new Uint8Array(byteStr.length);
      for (let i = 0; i < byteStr.length; i++) ab[i] = byteStr.charCodeAt(i);
      const blob = new Blob([ab], { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      const audio = remoteAudioRef.current || document.createElement("audio");
      remoteAudioRef.current = audio;
      audio.src = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        playingRef.current = false;
        playNextChunk();
      };
      audio.play().catch(() => {
        URL.revokeObjectURL(url);
        playingRef.current = false;
        playNextChunk();
      });
    } catch {
      playingRef.current = false;
      playNextChunk();
    }
  }, []);

  // ─── Poll for voice chunks from other players ───
  const pollChunks = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await fetch(`/api/rooms/${roomId}/voice/chunks?since=${chunkIndexRef.current}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.chunks && data.chunks.length > 0) {
        // Only play chunks from others
        const others = data.chunks.filter((c: VoiceChunk) => c.from !== playerId);
        if (others.length > 0) {
          audioQueueRef.current.push(...others);
          playNextChunk();
        }
        chunkIndexRef.current = data.nextIndex;
      }
    } catch {
      // ignore
    }
  }, [roomId, playerId, playNextChunk]);

  // ─── Poll for peers list ───
  const pollPeers = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await fetch(`/api/rooms/${roomId}/voice/peers`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.peers) {
        setPeers(data.peers.filter((p: VoicePeer) => p.playerId !== playerId));
      }
    } catch {
      // ignore
    }
  }, [roomId, playerId]);

  // ─── Send audio chunk to server ───
  const sendChunk = useCallback(async (base64Data: string) => {
    if (!roomId) return;
    try {
      await fetch(`/api/rooms/${roomId}/voice/chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: playerId,
          name: playerName,
          data: base64Data,
          ts: Date.now(),
        }),
      });
    } catch (err) {
      console.warn("[VoiceChat] send chunk failed:", err);
    }
  }, [roomId, playerId, playerName]);

  // ─── Start recording ───
  async function joinVoice() {
    if (!roomId) return;
    setMicError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      // Notify server
      const res = await fetch(`/api/rooms/${roomId}/voice/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, playerName }),
      });
      const data = await res.json();
      if (data.peers) {
        setPeers(data.peers.filter((p: VoicePeer) => p.playerId !== playerId));
      }

      // Sync chunk index
      try {
        const chunkRes = await fetch(`/api/rooms/${roomId}/voice/chunks?since=0`);
        const chunkData = await chunkRes.json();
        chunkIndexRef.current = chunkData.nextIndex || 0;
      } catch { /* ignore */ }

      // Setup MediaRecorder for push-to-talk
      setupRecorder(stream);
      setJoined(true);
    } catch {
      setMicError(true);
      setTimeout(() => setMicError(false), 3000);
    }
  }

  // ─── Setup media recorder ───
  function setupRecorder(stream: MediaStream) {
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = async (e) => {
      if (e.data.size === 0) return;
      try {
        const buffer = await e.data.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        await sendChunk(base64);
      } catch (err) {
        console.warn("[VoiceChat] encode chunk failed:", err);
      }
    };
  }

  // ─── Push-to-talk: start recording ───
  function startTalking() {
    if (muted || !mediaRecorderRef.current) return;
    const recorder = mediaRecorderRef.current;
    if (recorder.state === "recording") return;
    try {
      recorder.start(500); // emit chunks every 500ms
      setRecording(true);
    } catch { /* ignore */ }
  }

  // ─── Push-to-talk: stop recording ───
  function stopTalking() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    try {
      recorder.stop();
      setRecording(false);
    } catch { /* ignore */ }
  }

  // ─── Toggle continuous mute ───
  function toggleMute() {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
      setMuted(!muted);
      if (muted) stopTalking(); // unmuting: don't auto-start
    }
  }

  // ─── Leave voice channel ───
  async function leaveVoice() {
    if (!roomId) return;
    stopTalking();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    mediaRecorderRef.current = null;

    await fetch(`/api/rooms/${roomId}/voice/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });

    setJoined(false);
    setPeers([]);
    setRecording(false);
  }

  // ─── Polling when joined ───
  useEffect(() => {
    if (!joined) return;
    pollPeers();
    pollChunks();
    pollTimerRef.current = setInterval(() => {
      pollPeers();
      pollChunks();
    }, 1500);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [joined, pollPeers, pollChunks]);

  // ─── Cleanup on unmount ───
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current = null;
      }
    };
  }, []);

  if (!supported) {
    return (
      <div className="voice-chat">
        <span className="voice-indicator" style={{ color: "#888" }}>浏览器不支持语音</span>
      </div>
    );
  }

  return (
    <div className="voice-chat">
      {micError && (
        <span className="voice-indicator" style={{ color: "#a12626" }}>
          麦克风被拒绝，请在浏览器设置中允许
        </span>
      )}

      {!joined ? (
        <button
          type="button"
          className="voice-chat-btn"
          onClick={joinVoice}
          disabled={disabled}
          title="加入语音频道"
          aria-label="加入语音"
        >
          🎤 连麦
        </button>
      ) : (
        <div className="voice-joined-panel">
          <div className="voice-peers">
            {peers.length > 0 ? (
              <span className="voice-indicator">
                🟢 {peers.map((p) => p.playerName).join("、")} 在语音中
              </span>
            ) : (
              <span className="voice-indicator">语音频道中只有你</span>
            )}
          </div>

          <div className="voice-controls">
            {/* Push-to-talk button */}
            <button
              type="button"
              className={`voice-chat-btn ptt-btn ${recording ? "is-recording" : ""} ${muted ? "is-muted" : ""}`}
              onMouseDown={startTalking}
              onMouseUp={stopTalking}
              onMouseLeave={stopTalking}
              onTouchStart={(e) => { e.preventDefault(); startTalking(); }}
              onTouchEnd={stopTalking}
              disabled={muted}
              title={muted ? "已静音" : "按住说话"}
              aria-label="按住说话"
            >
              {muted ? "🔇" : recording ? "🎙️ 松开结束" : "🎤 按住说话"}
            </button>

            {/* Mute toggle */}
            <button
              type="button"
              className={`voice-chat-btn ${muted ? "is-muted" : ""}`}
              onClick={toggleMute}
              title={muted ? "取消静音" : "静音"}
              aria-label={muted ? "取消静音" : "静音"}
            >
              {muted ? "🔇" : "🔊"}
            </button>

            {/* Leave */}
            <button
              type="button"
              className="voice-chat-btn voice-leave-btn"
              onClick={leaveVoice}
              title="退出语音"
              aria-label="退出语音"
            >
              📴 断开
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
