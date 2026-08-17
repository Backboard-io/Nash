import { useRef, useState, useEffect } from 'react';

const REVEAL_INTERVAL_MS = 28;
const CHARS_PER_TICK = 18;
const CATCHUP_DIVISOR = 6;

/**
 * Smooths bursty SSE text by revealing characters at a steady pace.
 *
 * The interval survives past the end of streaming so the final burst
 * of text is still revealed progressively instead of snapping in.
 * It self-terminates once the reveal catches up to the final text.
 */
export default function useProgressiveText(text: string, isStreaming: boolean): string {
  const [displayLen, setDisplayLen] = useState(0);
  const targetRef = useRef(text);
  const displayLenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isStreamingRef = useRef(false);
  const revealingRef = useRef(false);

  targetRef.current = text;
  isStreamingRef.current = isStreaming;

  if (isStreaming && !revealingRef.current) {
    revealingRef.current = true;
  }

  useEffect(() => {
    if (!revealingRef.current) {
      displayLenRef.current = text.length;
      setDisplayLen(text.length);
      return;
    }

    if (timerRef.current != null) {
      return;
    }

    timerRef.current = setInterval(() => {
      const target = targetRef.current.length;
      const current = displayLenRef.current;

      if (current >= target) {
        if (!isStreamingRef.current) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          revealingRef.current = false;
        }
        return;
      }

      const gap = target - current;
      const step = Math.max(CHARS_PER_TICK, Math.ceil(gap / CATCHUP_DIVISOR));
      const next = Math.min(target, current + step);
      displayLenRef.current = next;
      setDisplayLen(next);
    }, REVEAL_INTERVAL_MS);
    // No cleanup here — the interval must survive past isStreaming transitions.
    // It self-terminates when the reveal catches up and streaming has ended.
    // Unmount cleanup is handled by the separate effect below.
  });

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  if (!revealingRef.current) {
    return text;
  }
  return text.slice(0, displayLen);
}
