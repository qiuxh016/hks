import { useRef, useState } from "react";

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionError extends Event {
  error: string;
  message?: string;
}

interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionError) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

const SpeechRecognition: { new(): ISpeechRecognition } | undefined =
  ((window as unknown as Record<string, unknown>).SpeechRecognition as { new(): ISpeechRecognition } | undefined) ??
  ((window as unknown as Record<string, unknown>).webkitSpeechRecognition as { new(): ISpeechRecognition } | undefined);

interface Props {
  onResult: (text: string) => void;
  onInterim?: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceInput({ onResult, onInterim, disabled }: Props) {
  const [listening, setListening] = useState(false);
  const supportedRef = useRef(!!SpeechRecognition);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const accumulatedRef = useRef("");
  const holdingRef = useRef(false);

  function start() {
    if (!SpeechRecognition) return;

    recognitionRef.current?.abort?.();
    accumulatedRef.current = "";
    holdingRef.current = true;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "zh-CN";

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          accumulatedRef.current += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      const liveText = accumulatedRef.current + interim;
      onInterim?.(liveText);
    };

    rec.onerror = (event: SpeechRecognitionError) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      holdingRef.current = false;
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
      if (holdingRef.current) {
        try { rec.start(); } catch { holdingRef.current = false; }
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      // mic not available
    }
  }

  function stop() {
    holdingRef.current = false;
    recognitionRef.current?.stop();
    const text = accumulatedRef.current.trim();
    if (text) {
      onResult(text);
    }
  }

  if (!supportedRef.current) return null;

  return (
    <button
      type="button"
      className={`voice-input-btn ${listening ? "is-recording" : ""}`}
      onMouseDown={() => start()}
      onMouseUp={() => stop()}
      onMouseLeave={() => listening && stop()}
      onTouchStart={() => start()}
      onTouchEnd={() => stop()}
      disabled={disabled}
      title="按住说话，松开识别"
      aria-label="语音输入"
    >
      {listening ? "●" : "🎤"}
    </button>
  );
}
