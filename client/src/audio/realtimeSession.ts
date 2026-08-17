/**
 * Browser-side WebSocket wrapper for Nash's realtime voice relay.
 *
 * Mirrors the surface of Backboard's SDK `VoiceSession` but speaks to
 * Flask at `/api/voice/realtime`, which relays to Backboard. The browser
 * never sees Backboard's API key — Flask is in the middle.
 *
 * Wire format:
 *   - Binary frames upstream  = raw PCM 16-bit / 16 kHz / mono / LE.
 *   - Text frames upstream    = JSON control messages, e.g. `{type: "commit"}`.
 *   - Text frames downstream  = JSON events (transcript.partial, content_streaming, tts_audio_chunk, ...).
 */

export type RealtimeEvent = {
  type: string;
  [key: string]: unknown;
};

export type RealtimeSession = {
  /** Send a raw PCM chunk (16 kHz mono Int16 LE) as a binary frame. */
  sendPcm: (chunk: ArrayBuffer) => void;
  /** Manual commit — only meaningful when the server config sets
   *  `commit_strategy="manual"`. Otherwise server-side VAD commits. */
  commit: () => void;
  /** Generic control-message escape hatch. */
  sendControl: (payload: Record<string, unknown>) => void;
  /** Async iterator over server events. Terminates on close. */
  events: () => AsyncGenerator<RealtimeEvent, void, unknown>;
  /** True from `session.begin` until `close()` (or connection death). */
  readonly isOpen: boolean;
  /** The `session.begin` payload from the server. Exposed so callers can
   *  read `conversation_id`, `thread_id`, etc. without intercepting events. */
  readonly beginEvent: RealtimeEvent;
  /** Tear down: closes the underlying WS. Idempotent. */
  close: () => void;
};

export type RealtimeOpenOptions = {
  /** Existing Nash conversationId to pin the turn to. Empty for new convo. */
  conversationId?: string;
  /** STT language (ISO-639-1). Optional — server defaults to `en`. */
  language?: string;
  /** TTS voice id. Optional — server defaults to alloy. */
  ttsVoice?: string;
  /** WS path to open. Defaults to the conversation relay; dictation passes
   *  `/api/voice/dictation` for the STT-only (no LLM / no TTS) flow. */
  path?: string;
  /** Override the base URL (mostly for testing). Defaults to same-origin. */
  baseUrl?: string;
  /** Open-handshake timeout. */
  openTimeoutMs?: number;
};

const DEFAULT_OPEN_TIMEOUT_MS = 15000;

/** Open the WS, wait for `session.begin`, and return a live session. */
export async function openRealtimeSession(opts: RealtimeOpenOptions = {}): Promise<RealtimeSession> {
  const base = opts.baseUrl
    ?? (typeof window !== 'undefined'
        ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
        : '');
  const params = new URLSearchParams();
  if (opts.conversationId) params.set('conversationId', opts.conversationId);
  if (opts.language) params.set('language', opts.language);
  if (opts.ttsVoice) params.set('ttsVoice', opts.ttsVoice);
  const qs = params.toString();
  const path = opts.path ?? '/api/voice/realtime';
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;

  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  // Buffered events + pending awaiters for the async-iterator pattern.
  const queue: RealtimeEvent[] = [];
  const waiters: Array<(value: IteratorResult<RealtimeEvent>) => void> = [];
  let closed = false;
  let isOpen = false;

  const pushEvent = (ev: RealtimeEvent) => {
    const next = waiters.shift();
    if (next) next({ value: ev, done: false });
    else queue.push(ev);
  };
  const finishIterators = () => {
    closed = true;
    while (waiters.length) {
      const w = waiters.shift()!;
      w({ value: undefined as unknown as RealtimeEvent, done: true });
    }
  };

  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    try {
      const parsed = JSON.parse(e.data) as RealtimeEvent;
      // session.begin is the open-handshake event; consumed in the
      // open() promise below, NOT delivered to the events() iterator.
      if (parsed.type === 'session.begin' && !isOpen) {
        isOpen = true;
        return;
      }
      pushEvent(parsed);
    } catch {
      /* swallow malformed frames; server should only emit JSON text */
    }
  };
  ws.onclose = () => {
    isOpen = false;
    finishIterators();
  };
  ws.onerror = () => {
    isOpen = false;
    finishIterators();
  };

  // Wait for session.begin (or an immediate error close). Capture its
  // payload so consumers can read conversation_id etc. without having to
  // intercept events themselves.
  let beginEvent: RealtimeEvent = { type: 'session.begin' };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      reject(new Error('realtime: open timeout'));
    }, opts.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);

    const onOpenMessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      try {
        const parsed = JSON.parse(e.data) as RealtimeEvent;
        if (parsed.type === 'session.begin') {
          clearTimeout(timer);
          ws.removeEventListener('message', onOpenMessage);
          isOpen = true;
          beginEvent = parsed;
          resolve();
        } else if (parsed.type === 'error') {
          clearTimeout(timer);
          ws.removeEventListener('message', onOpenMessage);
          try { ws.close(); } catch { /* noop */ }
          reject(new Error(String(parsed.message || parsed.code || 'realtime error')));
        }
      } catch {
        /* keep waiting */
      }
    };
    ws.addEventListener('message', onOpenMessage);
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      if (!isOpen) reject(new Error('realtime: closed before session.begin'));
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      if (!isOpen) reject(new Error('realtime: WS error before session.begin'));
    });
  });

  return {
    sendPcm(chunk: ArrayBuffer) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(chunk);
    },
    commit() {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'commit' }));
    },
    sendControl(payload: Record<string, unknown>) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(payload));
    },
    events() {
      // Async generator that pulls from the queue or awaits the next push.
      // On close we resolve pending awaiters with `null` and the generator
      // exits cleanly — no sentinel event leaks to the consumer.
      return (async function* () {
        while (!closed || queue.length > 0) {
          if (queue.length > 0) {
            yield queue.shift()!;
            continue;
          }
          if (closed) return;
          const next = await new Promise<RealtimeEvent | null>((resolve) => {
            waiters.push((res) => {
              resolve(res.done ? null : res.value);
            });
          });
          if (next === null) return;
          yield next;
        }
      })();
    },
    get isOpen() {
      return isOpen;
    },
    get beginEvent() {
      return beginEvent;
    },
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try { ws.send(JSON.stringify({ type: 'close' })); } catch { /* noop */ }
        try { ws.close(); } catch { /* noop */ }
      }
      isOpen = false;
      finishIterators();
    },
  };
}
