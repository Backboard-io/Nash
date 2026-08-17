/**
 * TTS playback with two strategies.
 *
 *   - **Progressive (Strategy B)** — Chrome/Firefox: a single MediaSource
 *     backs a persistent HTMLAudioElement; ``tts_audio_chunk`` events are
 *     ``SourceBuffer.appendBuffer``'d as they arrive, so playback starts as
 *     soon as the first frames land. Lowest perceived latency, matches the
 *     Perplexity feel.
 *   - **Buffered (Strategy A)** — Safari and anywhere MediaSource doesn't
 *     accept the TTS codec: collect chunks into a Blob, play after
 *     ``tts_end``. Bulletproof but the user waits for the full payload
 *     before any audio plays. Total perceived latency for short responses
 *     is < 2 s with OpenAI tts-1, which is acceptable.
 *
 * The choice is made per-instance at runtime based on
 * ``MediaSource.isTypeSupported`` for the actual TTS MIME type Backboard
 * advertises in ``tts_stream_start``. The host useVoiceConversation hook
 * doesn't care which strategy is in use — the same API is exposed.
 *
 * To satisfy iOS Safari's user-gesture requirement for ``Audio.play()`` and
 * for ``AudioContext``, the player is constructed via ``createTtsPlayer``
 * **inside** the user gesture that opens the voice overlay. The Audio
 * element is created once and reused across turns; we don't construct a
 * new one per response.
 */

export type TtsPlayer = {
  /** Tell the player which mime type the upcoming chunks will be in. Called
   *  once per turn on ``tts_start`` so the player can pick progressive vs
   *  buffered strategy before the first chunk lands. Safe to call multiple
   *  times — only the first call per turn matters. */
  prepare: (mimeType: string) => void;
  /** Push a base64-encoded TTS chunk. May begin playback immediately
   *  (progressive) or be buffered (Strategy A). */
  pushChunk: (b64: string) => void;
  /** Signal end-of-stream and ensure full audio plays out. Resolves when
   *  the underlying audio element finishes. */
  finish: (mimeType: string) => Promise<void>;
  /** Clear per-turn state (chunks, MediaSource) WITHOUT destroying the
   *  shared HTMLAudioElement / AudioContext. Call this between turns so
   *  iOS Safari keeps honoring the original user gesture. */
  reset: () => void;
  /** Hard stop — destroys element + context. Call only on overlay close. */
  stop: () => void;
  /** Subscribe to RMS amplitude in [0,1] while audio plays. Returns an
   *  unsubscribe. */
  onLevel: (cb: (level: number) => void) => () => void;
  /** True while audio is actively playing. */
  isPlaying: () => boolean;
};

type MimeChoice = { mime: string; strategy: 'progressive' | 'buffered' };

const PROGRESSIVE_PROBES = [
  'audio/mpeg',
  'audio/mp4; codecs="mp4a.40.2"',
  'audio/webm; codecs="opus"',
];

function probeProgressive(mimeType: string): MimeChoice {
  if (
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported &&
    mimeType &&
    MediaSource.isTypeSupported(mimeType)
  ) {
    return { mime: mimeType, strategy: 'progressive' };
  }
  // If Backboard tells us a generic mime, try the common ones for which we
  // know browser MSE support is widely available.
  if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported) {
    for (const probe of PROGRESSIVE_PROBES) {
      if (MediaSource.isTypeSupported(probe)) {
        return { mime: probe, strategy: 'progressive' };
      }
    }
  }
  return { mime: mimeType || 'audio/mpeg', strategy: 'buffered' };
}

function base64ToUint8Array(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  } catch {
    return null;
  }
}

export function createTtsPlayer(): TtsPlayer {
  // One HTMLAudioElement lives for the lifetime of the player so iOS Safari
  // counts the original user gesture on every subsequent turn.
  const audioEl = new Audio();
  audioEl.preload = 'auto';
  audioEl.crossOrigin = 'anonymous';

  let audioCtx: AudioContext | null = null;
  let analyserSource: MediaElementAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let levelInterval: ReturnType<typeof setInterval> | null = null;
  let levelCallbacks: ((n: number) => void)[] = [];

  let bufferedChunks: Uint8Array[] = [];
  let mode: 'idle' | 'progressive' | 'buffered' = 'idle';
  let mimeHint = '';
  let stopped = false;

  // Progressive state
  let mediaSource: MediaSource | null = null;
  let sourceBuffer: SourceBuffer | null = null;
  let appendQueue: Uint8Array[] = [];
  let endOfStreamRequested = false;
  let progressivePlaybackStarted = false;
  let objectUrl: string | null = null;

  const emitLevel = (level: number) => {
    for (const cb of levelCallbacks) cb(level);
  };

  const ensureAnalyser = () => {
    if (analyser) return;
    try {
      audioCtx = audioCtx ?? new AudioContext();
      // iOS suspends new AudioContexts until a gesture resumes them; we
      // were constructed inside one so this should succeed.
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      analyserSource = audioCtx.createMediaElementSource(audioEl);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyserSource.connect(analyser);
      analyserSource.connect(audioCtx.destination);
      const buf = new Uint8Array(analyser.fftSize);
      levelInterval = setInterval(() => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        emitLevel(Math.min(1, rms * 3));
      }, 33);
    } catch {
      // Analyser is decorative — playback still works without it.
    }
  };

  const teardownAnalyser = () => {
    if (levelInterval) {
      clearInterval(levelInterval);
      levelInterval = null;
    }
    emitLevel(0);
  };

  const initProgressive = (mime: string) => {
    mode = 'progressive';
    mediaSource = new MediaSource();
    objectUrl = URL.createObjectURL(mediaSource);
    audioEl.src = objectUrl;
    mediaSource.addEventListener('sourceopen', () => {
      if (!mediaSource) return;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mime);
        sourceBuffer.addEventListener('updateend', flushAppendQueue);
        flushAppendQueue();
      } catch {
        // Codec mismatch at sourceopen time: bail to buffered fallback.
        mode = 'buffered';
      }
    });
  };

  const flushAppendQueue = () => {
    if (!sourceBuffer || sourceBuffer.updating || appendQueue.length === 0) {
      if (
        endOfStreamRequested &&
        mediaSource &&
        mediaSource.readyState === 'open' &&
        sourceBuffer &&
        !sourceBuffer.updating &&
        appendQueue.length === 0
      ) {
        try {
          mediaSource.endOfStream();
        } catch {
          /* noop */
        }
      }
      return;
    }
    const next = appendQueue.shift()!;
    try {
      // Materialize a plain ArrayBuffer copy. SourceBuffer.appendBuffer's
      // typing in older TS lib defs rejects Uint8Array<ArrayBufferLike>; an
      // ArrayBuffer is always accepted.
      const copy = new Uint8Array(next.byteLength);
      copy.set(next);
      sourceBuffer.appendBuffer(copy.buffer);
    } catch {
      // Append failed (codec mismatch or buffer full). Subsequent appends
      // would also fail; bail to the buffered fallback by clearing the
      // queue — finish() will play from bufferedChunks instead.
      appendQueue = [];
      mode = 'buffered';
    }
  };

  const startProgressivePlayback = () => {
    if (progressivePlaybackStarted) return;
    progressivePlaybackStarted = true;
    ensureAnalyser();
    audioEl.play().catch(() => {
      // Autoplay rejected — fall back. Strategy A will retry from
      // bufferedChunks if available. (We keep bufferedChunks populated
      // alongside the MSE appends for exactly this case.)
      mode = 'buffered';
    });
  };

  return {
    prepare(mimeType: string) {
      if (stopped) return;
      if (mode !== 'idle') return; // first call wins
      if (mimeType) mimeHint = mimeType;
    },
    pushChunk(b64: string) {
      if (stopped) return;
      const u8 = base64ToUint8Array(b64);
      if (!u8) return;
      // Always retain the bytes — they back the Strategy A fallback if
      // progressive playback fails for any reason.
      bufferedChunks.push(u8);

      if (mode === 'idle') {
        const choice = probeProgressive(mimeHint);
        if (choice.strategy === 'progressive') {
          initProgressive(choice.mime);
        } else {
          mode = 'buffered';
        }
      }

      if (mode === 'progressive') {
        appendQueue.push(u8);
        flushAppendQueue();
        // Kick off playback once we have a couple of chunks queued so the
        // browser has enough data to actually start decoding.
        if (!progressivePlaybackStarted && bufferedChunks.length >= 2) {
          startProgressivePlayback();
        }
      }
    },

    async finish(mimeType: string) {
      if (stopped) return;
      mimeHint = mimeType || mimeHint || 'audio/mpeg';

      if (mode === 'progressive') {
        endOfStreamRequested = true;
        flushAppendQueue();
        // If we haven't actually started playback yet (very short response),
        // do so now.
        if (!progressivePlaybackStarted) startProgressivePlayback();
        return new Promise<void>((resolve) => {
          const done = () => {
            teardownAnalyser();
            resolve();
          };
          audioEl.addEventListener('ended', done, { once: true });
          audioEl.addEventListener('error', done, { once: true });
        });
      }

      // Buffered fallback.
      if (bufferedChunks.length === 0) return;
      const blob = new Blob(bufferedChunks as BlobPart[], { type: mimeHint });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      audioEl.src = objectUrl;
      ensureAnalyser();
      try {
        await audioEl.play();
      } catch {
        teardownAnalyser();
        return;
      }
      return new Promise<void>((resolve) => {
        const done = () => {
          teardownAnalyser();
          resolve();
        };
        audioEl.addEventListener('ended', done, { once: true });
        audioEl.addEventListener('error', done, { once: true });
      });
    },

    reset() {
      // Per-turn cleanup. Pause playback, release the MediaSource and any
      // object URL, drop buffered chunks — but DO NOT close the
      // AudioContext or replace the HTMLAudioElement. Reusing the same
      // <audio> across turns is what keeps iOS Safari honoring the
      // original user-gesture authorization on every subsequent turn.
      try {
        audioEl.pause();
      } catch {
        /* noop */
      }
      try {
        if (mediaSource && mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
        }
      } catch {
        /* noop */
      }
      mediaSource = null;
      sourceBuffer = null;
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* noop */
        }
        objectUrl = null;
      }
      try {
        // Detach the previous src so the next finish()/play() starts fresh.
        audioEl.removeAttribute('src');
        audioEl.load();
      } catch {
        /* noop */
      }
      teardownAnalyser();
      bufferedChunks = [];
      appendQueue = [];
      mode = 'idle';
      progressivePlaybackStarted = false;
      endOfStreamRequested = false;
    },

    stop() {
      stopped = true;
      try {
        audioEl.pause();
      } catch {
        /* noop */
      }
      try {
        if (mediaSource && mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
        }
      } catch {
        /* noop */
      }
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* noop */
        }
        objectUrl = null;
      }
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
      analyser = null;
      analyserSource = null;
      teardownAnalyser();
      bufferedChunks = [];
      appendQueue = [];
      mode = 'idle';
      progressivePlaybackStarted = false;
      endOfStreamRequested = false;
    },

    onLevel(cb) {
      levelCallbacks.push(cb);
      return () => {
        levelCallbacks = levelCallbacks.filter((c) => c !== cb);
      };
    },

    isPlaying() {
      return !audioEl.paused && !audioEl.ended;
    },
  };
}
