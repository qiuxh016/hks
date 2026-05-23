import { useEffect, useRef, useState } from "react";

const STORAGE_ENABLED = "bgm-enabled";
const STORAGE_VOLUME = "bgm-volume";
const DEFAULT_SRC = import.meta.env.VITE_BGM_URL || "/bgm/main.mp3";

function readVolume() {
  const raw = localStorage.getItem(STORAGE_VOLUME);
  const value = raw ? Number(raw) : 0.35;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.35;
}

export function BgmPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(readVolume);
  const [error, setError] = useState("");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = volume;
    audio.loop = true;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setError(`找不到 BGM（${DEFAULT_SRC}），请确认根目录有 main.mp3 并复制到 client/public/bgm/main.mp3`);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    if (localStorage.getItem(STORAGE_ENABLED) === "1") {
      void audio.play().catch(() => {
        setPlaying(false);
      });
    }

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = volume;
    localStorage.setItem(STORAGE_VOLUME, String(volume));
  }, [volume]);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    setError("");

    if (playing) {
      audio.pause();
      localStorage.setItem(STORAGE_ENABLED, "0");
      return;
    }

    try {
      await audio.play();
      localStorage.setItem(STORAGE_ENABLED, "1");
    } catch {
      setError("浏览器需要你先点击「播放 BGM」才能播放音乐。");
    }
  }

  return (
    <div className="bgm-player">
      <audio ref={audioRef} src={DEFAULT_SRC} preload="auto" />

      <div className="bgm-controls">
        <button type="button" className="bgm-toggle" onClick={() => void togglePlay()}>
          {playing ? "暂停 BGM" : "播放 BGM"}
        </button>

        <label className="bgm-volume">
          <span>音量</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
      </div>

      {error && <p className="bgm-error">{error}</p>}
      {!error && <p className="bgm-hint">背景音乐：项目根目录 main.mp3</p>}
    </div>
  );
}
