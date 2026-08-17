/**
 * Energy-based voice activity detection.
 *
 * Computes RMS over a sliding window of mic input. When the level is above
 * ``startThreshold`` for ``minSpeechMs``, we flag "speaking". When it then
 * drops below ``stopThreshold`` for ``silenceMs``, we flag "stopped". The
 * UI uses these flags to auto-submit a turn during hands-free conversation,
 * while always exposing a manual tap-to-send / tap-to-cancel as the escape
 * hatch.
 *
 * Thresholds are deliberately on the conservative side so that a quiet
 * room doesn't auto-trip. Phase 3 can swap in a WASM silero-vad if energy
 * VAD turns out to be too flaky in real-world recording conditions.
 */

export type VadOptions = {
  /** Level above this counts as voice (default 0.10). [0,1] from RMS. */
  startThreshold?: number;
  /** Level below this counts as silence (default 0.05). */
  stopThreshold?: number;
  /** ms of continuous level > startThreshold before "speaking" fires. */
  minSpeechMs?: number;
  /** ms of continuous level < stopThreshold before "stopped" fires. */
  silenceMs?: number;
};

export type VadCallbacks = {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onLevel?: (level: number) => void;
};

export type VadController = {
  start: () => void;
  stop: () => void;
};

/**
 * Attach a VAD to an already-running MediaStream. Returns a controller; call
 * ``start()`` to begin monitoring and ``stop()`` to release the AudioContext.
 */
export function createEnergyVad(
  stream: MediaStream,
  callbacks: VadCallbacks,
  opts: VadOptions = {},
): VadController {
  // Defaults tuned for typical desktop room noise. Earlier values
  // (0.05 / 0.025) were too eager — keyboard taps, HVAC, breathing, etc.
  // would all trip the speech-start detector. Doubled both thresholds
  // (keeping the 2:1 start/stop hysteresis ratio) and bumped minSpeechMs
  // so transient noise spikes don't accumulate into a false-start.
  const startThreshold = opts.startThreshold ?? 0.10;
  const stopThreshold = opts.stopThreshold ?? 0.05;
  const minSpeechMs = opts.minSpeechMs ?? 350;
  const silenceMs = opts.silenceMs ?? 800;

  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  let speaking = false;
  let aboveSince = 0;
  let belowSince = 0;

  const start = () => {
    if (audioCtx) return;
    audioCtx = new AudioContext();
    source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    interval = setInterval(() => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 3);
      callbacks.onLevel?.(level);

      const now = performance.now();
      if (!speaking) {
        if (level > startThreshold) {
          if (aboveSince === 0) aboveSince = now;
          if (now - aboveSince >= minSpeechMs) {
            speaking = true;
            belowSince = 0;
            callbacks.onSpeechStart?.();
          }
        } else {
          aboveSince = 0;
        }
      } else {
        if (level < stopThreshold) {
          if (belowSince === 0) belowSince = now;
          if (now - belowSince >= silenceMs) {
            speaking = false;
            aboveSince = 0;
            callbacks.onSpeechEnd?.();
          }
        } else {
          belowSince = 0;
        }
      }
    }, 33);
  };

  const stop = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    try {
      source?.disconnect();
    } catch {
      /* noop */
    }
    try {
      analyser?.disconnect();
    } catch {
      /* noop */
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    source = null;
    analyser = null;
    speaking = false;
    aboveSince = 0;
    belowSince = 0;
  };

  return { start, stop };
}
