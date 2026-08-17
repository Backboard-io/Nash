/**
 * Browser audio capture for Nash voice features.
 *
 * Wraps getUserMedia + MediaRecorder with a small lifecycle (start → stop →
 * blob) and an optional level-monitoring callback for the UI to drive
 * waveform / orb animations. Designed to be friendly with React via
 * `useDictation` and the Phase 2 voice-conversation hook.
 *
 * Browser notes:
 *  - getUserMedia requires HTTPS or localhost; the calling code is
 *    responsible for surfacing permission-denied UX.
 *  - Safari is fussy about codecs; we prefer audio/webm (Chrome/Firefox) and
 *    fall back to audio/mp4 (Safari) — both are accepted by Backboard.
 *  - AudioContext must be created during a user gesture on iOS; consumers
 *    should call `startRecording` from a click handler.
 */

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export type RecorderError =
  | 'unsupported'
  | 'permission-denied'
  | 'no-device'
  | 'os-blocked'
  | 'aborted'
  | 'unknown';

export type Recorder = {
  stop: () => Promise<{ blob: Blob; mimeType: string; durationMs: number }>;
  cancel: () => void;
  /** RMS-ish input level in [0,1], updated ~30Hz while recording. */
  onLevel?: (level: number) => void;
};

export type StartRecordingOptions = {
  /** Optional callback invoked with input level [0,1] for waveform UIs. */
  onLevel?: (level: number) => void;
};

/**
 * Start recording from the default microphone. Returns a Recorder object
 * once getUserMedia has resolved AND the MediaRecorder has begun. The
 * caller decides when to `stop()` (which yields the audio blob) or
 * `cancel()` (which discards it).
 */
export async function startRecording(opts: StartRecordingOptions = {}): Promise<Recorder> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw makeError('unsupported');
  }

  const mimeType = pickMimeType();
  if (!mimeType) {
    throw makeError('unsupported');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const e = err as DOMException;
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
      throw makeError('permission-denied');
    }
    if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
      throw makeError('no-device');
    }
    if (e?.name === 'NotReadableError') {
      // Mic in use by another app / OS-level lock.
      throw makeError('os-blocked');
    }
    throw makeError('unknown');
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch {
    // Very rare: codec briefly unsupported between isTypeSupported and
    // construction (e.g. on driver change). Release the mic and bail.
    stream.getTracks().forEach((t) => t.stop());
    throw makeError('unsupported');
  }
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // Level monitoring (best effort — skip if AudioContext unavailable).
  let levelInterval: ReturnType<typeof setInterval> | undefined;
  let audioCtx: AudioContext | undefined;
  if (opts.onLevel && typeof AudioContext !== 'undefined') {
    try {
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      levelInterval = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        // Peak-normalized RMS — friendlier to UI than raw RMS.
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const scaled = Math.min(1, rms * 3);
        opts.onLevel?.(scaled);
      }, 33);
    } catch {
      // Level monitoring is decorative; ignore failure.
    }
  }

  const startedAt = performance.now();
  recorder.start();

  const cleanup = () => {
    if (levelInterval) clearInterval(levelInterval);
    audioCtx?.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop());
  };

  let resolved = false;
  let resolveStop: (v: { blob: Blob; mimeType: string; durationMs: number }) => void;
  let rejectStop: (e: Error) => void;
  const stoppedPromise = new Promise<{ blob: Blob; mimeType: string; durationMs: number }>(
    (resolve, reject) => {
      resolveStop = resolve;
      rejectStop = reject;
    },
  );

  recorder.onstop = () => {
    if (resolved) return;
    resolved = true;
    cleanup();
    const blob = new Blob(chunks, { type: mimeType });
    resolveStop({ blob, mimeType, durationMs: performance.now() - startedAt });
  };
  recorder.onerror = () => {
    if (resolved) return;
    resolved = true;
    cleanup();
    rejectStop(makeError('unknown'));
  };

  return {
    stop: async () => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else if (!resolved) {
        // Recorder already inactive (never started, or stopped externally).
        // Resolve with whatever chunks we have so callers don't hang.
        resolved = true;
        cleanup();
        const blob = new Blob(chunks, { type: mimeType });
        resolveStop({ blob, mimeType, durationMs: performance.now() - startedAt });
      }
      return stoppedPromise;
    },
    cancel: () => {
      if (resolved) return;
      resolved = true;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* noop */
      }
      cleanup();
      rejectStop(makeError('aborted'));
    },
  };
}

function makeError(code: RecorderError): Error & { code: RecorderError } {
  const e = new Error(`recorder:${code}`) as Error & { code: RecorderError };
  e.code = code;
  return e;
}

export function recorderErrorCode(err: unknown): RecorderError | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code: RecorderError }).code;
  }
  return undefined;
}
