import { memo, useEffect, useRef } from 'react';
import { cn } from '~/utils';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

type Props = {
  state: OrbState;
  /** Live amplitude in [0,1] driving the size pulse. */
  level: number;
  /** Tap handler — used to interrupt the assistant while it speaks. */
  onClick?: () => void;
  className?: string;
};

/**
 * Animated voice orb. Renders on a canvas so the pulse stays smooth even
 * when React state is changing rapidly. Four visual states:
 *  - idle:      static sphere, no motion (animates only while active).
 *  - listening: pulse scales with mic input level (real-time).
 *  - thinking:  shimmer / rotation, no amplitude tie.
 *  - speaking:  pulse scales with TTS output level.
 */
function Orb({ state, level, onClick, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  const stateRef = useRef<{ state: OrbState; level: number }>({ state, level });
  const startedAt = useRef(performance.now());

  // Mirror reactive props into a ref so the requestAnimationFrame loop reads
  // the latest values without re-subscribing.
  useEffect(() => {
    stateRef.current = { state, level };
  }, [state, level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Track a stopped flag so the rAF loop self-terminates after cleanup.
    // Without this, a frame that's already scheduled when cleanup runs will
    // schedule a successor — the loop keeps running indefinitely against
    // a detached canvas.
    let stopped = false;

    const draw = () => {
      if (stopped) return;
      const { state: s, level: l } = stateRef.current;
      const now = performance.now() - startedAt.current;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = Math.min(w, h) * 0.32;

      ctx.clearRect(0, 0, w, h);

      // Pulse — animate only while listening or streaming (thinking/speaking).
      // Idle holds a static sphere so a resting orb shows no motion.
      let pulse = 0;
      if (s === 'listening') pulse = 0.06 + Math.min(0.35, l * 0.6);
      else if (s === 'thinking') pulse = 0.04 + 0.06 * Math.sin(now / 240);
      else if (s === 'speaking') pulse = 0.08 + Math.min(0.4, l * 0.7);

      const r = baseRadius * (1 + pulse);

      // Background bloom — soft radial glow. Outer radius is clamped to the
      // nearest canvas edge and drawn as a circle so the gradient reaches
      // full transparency before any edge. (The old version filled the whole
      // rect with a gradient that still had ~13% alpha at the edge midpoints,
      // which read as a faint square around the orb.)
      const bloomOuter = Math.min(cx, cy);
      const bloom = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, bloomOuter);
      bloom.addColorStop(0, colorFor(s, 0.4));
      bloom.addColorStop(0.7, colorFor(s, 0.1));
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(cx, cy, bloomOuter, 0, Math.PI * 2);
      ctx.fill();

      // --- Glossy 3D sphere ----------------------------------------------
      // Single key light, upper-left of center. Everything keys off it.
      const lx = cx - r * 0.4;
      const ly = cy - r * 0.45;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      // Body: bright lit crown near the light, darkening to a shadowed
      // terminator on the far (lower-right) edge to give the form volume.
      const body = ctx.createRadialGradient(lx, ly, r * 0.05, cx, cy, r * 1.15);
      body.addColorStop(0, colorFor(s, 1));
      body.addColorStop(0.5, colorFor(s, 0.82));
      body.addColorStop(0.85, colorFor(s, 0.42));
      body.addColorStop(1, colorForDark(s, 0.92));
      ctx.fillStyle = body;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      // Terminator shadow — deepen the lower-right so the sphere reads round.
      const term = ctx.createRadialGradient(
        cx + r * 0.55, cy + r * 0.6, r * 0.1,
        cx + r * 0.2, cy + r * 0.25, r * 1.3,
      );
      term.addColorStop(0, 'rgba(0,0,0,0.5)');
      term.addColorStop(0.55, 'rgba(0,0,0,0.14)');
      term.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = term;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      ctx.restore();

      // Specular highlight — a tight glossy hotspot near the light point.
      const spec = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 0.6);
      spec.addColorStop(0, 'rgba(255,255,255,0.85)');
      spec.addColorStop(0.35, 'rgba(255,255,255,0.2)');
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Rotating shimmer arc for thinking state.
      if (s === 'thinking') {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((now / 800) % (Math.PI * 2));
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r + 6, 0, Math.PI * 0.7);
        ctx.stroke();
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabelFor(state)}
      className={cn(
        'group relative inline-flex items-center justify-center rounded-full',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        onClick ? 'cursor-pointer' : 'cursor-default',
        className,
      )}
    >
      <canvas ref={canvasRef} className="block h-72 w-72 select-none" aria-hidden="true" />
    </button>
  );
}

function colorFor(state: OrbState, alpha: number): string {
  // Black-only orb: each state gets a distinct shade of grey for its lit
  // crown. The white specular highlight + dark terminator keep the 3D form,
  // and motion (level pulse / shimmer) is the primary state cue.
  let v: number;
  if (state === 'listening') v = 120; // lightest — actively hearing the user
  else if (state === 'speaking') v = 95; // mid — actively responding
  else if (state === 'thinking') v = 75; // darker — working
  else v = 55; // idle — darkest, at rest
  return `rgba(${v}, ${v}, ${v}, ${alpha})`;
}

function colorForDark(state: OrbState, alpha: number): string {
  // Near-black terminator, tracking each state's shade so the sphere's
  // shadow stays cohesive with its lit crown.
  let v: number;
  if (state === 'listening') v = 18;
  else if (state === 'speaking') v = 14;
  else if (state === 'thinking') v = 10;
  else v = 8;
  return `rgba(${v}, ${v}, ${v}, ${alpha})`;
}

function ariaLabelFor(state: OrbState): string {
  switch (state) {
    case 'listening':
      return 'Listening — speak now';
    case 'thinking':
      return 'Thinking';
    case 'speaking':
      return 'Speaking';
    default:
      return 'Voice orb';
  }
}

export default memo(Orb);
