import { useRef, useLayoutEffect } from 'react';

export default function CourtCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const variation = useRef({
    rotation: 70 + Math.random() * 20,
    offsetX: 0.3 + Math.random() * 0.4,
    offsetY: 1.2 + Math.random() * 0.6,
  });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    let animId: number;
    let startTime: number | null = null;

    function resize() {
      if (!canvas) {
        return;
      }
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    }

    function drawCourt(breath: number) {
      if (!canvas || !ctx) {
        return;
      }
      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      const alpha = 0.035 + breath * 0.02;
      const isDark = document.documentElement.classList.contains('dark');
      const lineColor = isDark ? `rgba(255,255,255,${alpha})` : `rgba(20,20,20,${alpha})`;

      ctx.save();

      const v = variation.current;
      ctx.translate(W * v.offsetX, H * v.offsetY);
      ctx.rotate((v.rotation * Math.PI) / 180);

      const unit = (W * 3.2) / 500;

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5 * window.devicePixelRatio;
      ctx.lineCap = 'round';

      // Lane
      const laneW = unit * 144;
      const laneH = unit * 228;
      ctx.beginPath();
      ctx.rect(-laneW / 2, -laneH, laneW, laneH);
      ctx.stroke();

      // Free throw circle
      const ftR = unit * 72;
      ctx.beginPath();
      ctx.arc(0, -laneH, ftR, 0, Math.PI, true);
      ctx.stroke();
      ctx.save();
      ctx.setLineDash([unit * 10, unit * 7]);
      ctx.beginPath();
      ctx.arc(0, -laneH, ftR, 0, Math.PI, false);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Restricted area arc
      ctx.beginPath();
      ctx.arc(0, -unit * 15, unit * 48, Math.PI, 0);
      ctx.stroke();

      // Three-point corner lines
      const cornerX = unit * 220;
      const cornerY = unit * 168;
      ctx.beginPath();
      ctx.moveTo(-cornerX, 0);
      ctx.lineTo(-cornerX, -cornerY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cornerX, 0);
      ctx.lineTo(cornerX, -cornerY);
      ctx.stroke();

      // Three-point arc
      const threeR = unit * 237.5;
      const basketY = -unit * 15;
      const ang = Math.atan2(basketY + cornerY, cornerX);
      ctx.beginPath();
      ctx.arc(0, basketY, threeR, Math.PI + ang, -ang, false);
      ctx.stroke();

      // Center circle
      ctx.beginPath();
      ctx.arc(0, -unit * 470, unit * 72, 0, Math.PI * 2);
      ctx.stroke();

      // Half-court line
      ctx.beginPath();
      ctx.moveTo(-unit * 250, -unit * 470);
      ctx.lineTo(unit * 250, -unit * 470);
      ctx.stroke();

      ctx.restore();
    }

    function animate(ts: number) {
      if (startTime === null) {
        startTime = ts;
      }
      const elapsed = (ts - startTime) / 1000;
      const breath = (Math.sin((elapsed * Math.PI * 2) / 8) + 1) / 2;
      drawCourt(breath);
      animId = requestAnimationFrame(animate);
    }

    resize();
    animId = requestAnimationFrame(animate);

    const ro = new ResizeObserver(() => {
      resize();
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
