import { useEffect, useRef, useState } from "react";

export function TypewriterText({
  text,
  speed = 28,
  onComplete,
}: {
  text: string;
  speed?: number;
  onComplete?: () => void;
}) {
  const [charCount, setCharCount] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
    if (skipped) {
      setCharCount(text.length);
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }

    setCharCount(0);
    let i = 0;
    timerRef.current = setInterval(() => {
      i++;
      setCharCount(i);
      if (i >= text.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete?.();
        }
      }
    }, speed);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [text, speed, skipped]);

  const displayed = skipped ? text : text.slice(0, charCount);
  const isTyping = charCount < text.length && !skipped;

  return (
    <span
      className={`typewriter-text${isTyping ? " is-typing" : ""}`}
      onClick={() => !skipped && setSkipped(true)}
      title={isTyping ? "点击跳过打字动画" : undefined}
    >
      {displayed}
      {isTyping && <span className="typewriter-cursor">|</span>}
    </span>
  );
}
