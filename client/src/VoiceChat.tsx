import { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";

interface Props {
  socket: Socket | null;
  roomId: string | null;
  playerName: string;
  disabled?: boolean;
}

export default function VoiceChat({ socket, roomId, playerName, disabled }: Props) {
  const [talking, setTalking] = useState(false);
  const [remoteTalkers, setRemoteTalkers] = useState<Set<string>>(new Set());
  const [supported, setSupported] = useState(true);
  const [micError, setMicError] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // check support
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
    }
  }, []);

  // listen for remote voice events
  const audioCtxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);

  const playNext = useCallback(() => {
    if (playingRef.current || queueRef.current.length === 0) return;

    const chunk = queueRef.current.shift()!;
    playingRef.current = true;

    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;

    ctx.decodeAudioData(chunk.slice(0), (buffer) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        playingRef.current = false;
        playNext();
      };
      source.start();
    }, () => {
      playingRef.current = false;
      playNext();
    });
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on("voice:start", (name: string) => {
      setRemoteTalkers((prev) => new Set(prev).add(name));
    });

    socket.on("voice:data", (chunk: ArrayBuffer) => {
      queueRef.current.push(chunk);
      playNext();
    });

    socket.on("voice:end", (name: string) => {
      setRemoteTalkers((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    });

    return () => {
      socket.off("voice:start");
      socket.off("voice:data");
      socket.off("voice:end");
    };
  }, [socket, playNext]);

  async function startTalking() {
    if (!socket || !roomId) return;
    setMicError(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          event.data.arrayBuffer().then((buf) => {
            socket.emit("voice:data", roomId, buf);
          });
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        socket.emit("voice:end", roomId, playerName);
      };

      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        socket.emit("voice:end", roomId, playerName);
        setTalking(false);
      };

      recorder.start(200);
      recorderRef.current = recorder;
      socket.emit("voice:start", roomId, playerName);
      setTalking(true);
    } catch {
      setMicError(true);
      setTimeout(() => setMicError(false), 3000);
    }
  }

  function stopTalking() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setTalking(false);
  }

  if (!supported) return null;

  const talkerList = [...remoteTalkers];

  return (
    <div className="voice-chat">
      {talkerList.length > 0 && (
        <span className="voice-indicator">
          {talkerList.join("、")} 正在说话...
        </span>
      )}

      {micError && (
        <span className="voice-indicator" style={{ color: "#a12626" }}>
          麦克风被拒绝，请在浏览器设置中允许
        </span>
      )}

      <button
        type="button"
        className={`voice-chat-btn ${talking ? "is-talking" : ""}`}
        onMouseDown={() => startTalking()}
        onMouseUp={() => stopTalking()}
        onMouseLeave={() => talking && stopTalking()}
        onTouchStart={() => startTalking()}
        onTouchEnd={() => stopTalking()}
        disabled={disabled}
        title="按住说话"
        aria-label="语音通话"
      >
        {talking ? "📢" : "🔇"}
      </button>
    </div>
  );
}
