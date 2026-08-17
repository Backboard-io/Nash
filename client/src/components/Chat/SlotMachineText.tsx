import { useEffect, useRef, useState } from 'react';

const PHRASES = [
  'Every AI for Everyone.',
  'Your court. Every model.',
  'Play the full lineup.',
  'All nets. No limits.',
  'From tip-off to closing.',
];

const DISPLAY_MS = 3200;
const EXIT_MS = 280;
const ENTER_MS = 350;

type Phase = 'visible' | 'exiting' | 'entering';

export default function SlotMachineText({ className }: { className?: string }) {
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<Phase>('visible');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function schedule() {
      timerRef.current = setTimeout(() => {
        setPhase('exiting');

        timerRef.current = setTimeout(() => {
          setCurrent((prev) => (prev + 1) % PHRASES.length);
          setPhase('entering');

          timerRef.current = setTimeout(() => {
            setPhase('visible');
            schedule();
          }, ENTER_MS);
        }, EXIT_MS);
      }, DISPLAY_MS);
    }

    schedule();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const transform =
    phase === 'exiting'
      ? 'translate3d(0,-50%,0)'
      : phase === 'entering'
        ? 'translate3d(0,0,0)'
        : 'translate3d(0,0,0)';

  const startTransform = phase === 'entering' ? 'translate3d(0,50%,0)' : undefined;

  const opacity = phase === 'exiting' ? 0 : 1;

  const transition =
    phase === 'exiting'
      ? `transform ${EXIT_MS}ms cubic-bezier(0.33,1,0.68,1), opacity ${EXIT_MS}ms ease-out`
      : phase === 'entering'
        ? `transform ${ENTER_MS}ms cubic-bezier(0.33,1,0.68,1), opacity ${ENTER_MS}ms ease-out`
        : 'none';

  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        verticalAlign: 'bottom',
        position: 'relative',
        height: '1.4em',
      }}
    >
      {PHRASES.map((phrase) => (
        <span key={phrase} aria-hidden="true" style={{ visibility: 'hidden', whiteSpace: 'nowrap', display: 'block', height: 0, lineHeight: '1.4em' }}>
          {phrase}
        </span>
      ))}
      <span
        key={current}
        style={{
          display: 'block',
          position: 'absolute',
          left: 0,
          top: 0,
          transform: startTransform ?? transform,
          opacity,
          transition,
          whiteSpace: 'nowrap',
          lineHeight: '1.4em',
          animation:
            phase === 'entering'
              ? `slotEnter ${ENTER_MS}ms cubic-bezier(0.33,1,0.68,1) forwards`
              : undefined,
        }}
      >
        {PHRASES[current]}
      </span>
      <style>{`
        @keyframes slotEnter {
          from { transform: translate3d(0,50%,0); opacity: 0; }
          to   { transform: translate3d(0,0,0);   opacity: 1; }
        }
      `}</style>
    </span>
  );
}
