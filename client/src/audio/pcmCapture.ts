/**
 * Live microphone PCM capture for Backboard realtime voice.
 *
 * Wraps getUserMedia + AudioContext + an AudioWorklet that downsamples
 * the mic stream to 16 kHz mono Int16 PCM (little-endian) — the exact
 * format Backboard's `scribe_v2_realtime` STT expects. Each ~100 ms chunk
 * is delivered to the consumer as an ArrayBuffer ready to ship as a
 * binary WebSocket frame.
 *
 * The worklet processor lives at /audio-worklet-pcm.js (served statically
 * by Flask from client/dist). It runs off the main thread so capture
 * stays glitch-free even when React is busy.
 */

export type PcmCaptureOptions = {
  /** Optional RMS level callback for UI animations (orb, waveform). */
  onLevel?: (level: number) => void;
  /** Called for each PCM chunk. ArrayBuffer is the *transferred* buffer
   *  from the worklet — do NOT mutate it after passing somewhere else. */
  onChunk: (chunk: ArrayBuffer) => void;
  /** Called once if mic permission / device acquisition fails. */
  onError?: (code: PcmCaptureError, err: unknown) => void;
};

export type PcmCaptureError =
  | 'unsupported'
  | 'permission-denied'
  | 'no-device'
  | 'os-blocked'
  | 'worklet-load-failed'
  | 'unknown';

export type PcmCapture = {
  /** True while audio is flowing. Set to false to mute (chunks stop
   *  being delivered but the underlying tracks stay live so unmute is
   *  instant). */
  setMuted: (muted: boolean) => void;
  /** Tear down everything: stop tracks, close AudioContext, drop refs. */
  stop: () => Promise<void>;
};

const WORKLET_URL = '/audio-worklet-pcm.js';

/**
 * Acquire the mic, retrying once on NotReadableError. That error means the OS
 * reports the device as momentarily unreadable — most often because a
 * just-closed voice session (or a quick reopen) hasn't released the device yet.
 * A short wait + single retry clears that transient race; a genuinely busy
 * device (another app/tab holding the mic) still surfaces the error.
 */
async function acquireMicStream(
  constraints: MediaStreamConstraints,
  retries = 1,
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if ((err as DOMException | undefined)?.name === 'NotReadableError' && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return acquireMicStream(constraints, retries - 1);
    }
    throw err;
  }
}

export async function startPcmCapture(opts: PcmCaptureOptions): Promise<PcmCapture> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    const err = new Error('pcm-capture:unsupported');
    opts.onError?.('unsupported', err);
    throw err;
  }

  let stream: MediaStream;
  try {
    stream = await acquireMicStream({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const e = err as DOMException | undefined;
    const code: PcmCaptureError =
      e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'permission-denied'
      : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? 'no-device'
      : e?.name === 'NotReadableError' ? 'os-blocked'
      : 'unknown';
    opts.onError?.(code, err);
    throw err;
  }

  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    opts.onError?.('unsupported', err);
    throw err;
  }

  try {
    await ctx.audioWorklet.addModule(WORKLET_URL);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    try { await ctx.close(); } catch { /* noop */ }
    opts.onError?.('worklet-load-failed', err);
    throw err;
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-downsampler', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { sourceRate: ctx.sampleRate },
  });

  let muted = false;
  node.port.onmessage = (ev) => {
    if (muted) return;
    const buf = ev.data as ArrayBuffer;
    opts.onChunk(buf);
  };

  source.connect(node);
  // The worklet doesn't need to feed output, but Chrome stops running
  // unconnected worklets eagerly — wire it to a muted gain so it keeps
  // ticking without producing audible output.
  const silentSink = ctx.createGain();
  silentSink.gain.value = 0;
  node.connect(silentSink);
  silentSink.connect(ctx.destination);

  // Optional level monitoring for UI (orb pulse). Runs at ~30 Hz off a
  // separate analyser so the worklet's main job stays uninterrupted.
  let levelInterval: ReturnType<typeof setInterval> | undefined;
  if (opts.onLevel) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    levelInterval = setInterval(() => {
      if (muted) {
        opts.onLevel?.(0);
        return;
      }
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      opts.onLevel?.(Math.min(1, rms * 3));
    }, 33);
  }

  return {
    setMuted(next: boolean) {
      muted = next;
    },
    async stop() {
      if (levelInterval) clearInterval(levelInterval);
      try { node.port.onmessage = null; } catch { /* noop */ }
      try { node.disconnect(); } catch { /* noop */ }
      try { source.disconnect(); } catch { /* noop */ }
      try { silentSink.disconnect(); } catch { /* noop */ }
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      try { await ctx.close(); } catch { /* noop */ }
    },
  };
}
