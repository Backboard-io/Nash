/**
 * Narration controller — drives the per-message "Read aloud" action.
 *
 * A single module-level singleton so that "only one narration at a time"
 * is trivially correct: starting a new narration (or toggling the active one)
 * stops whatever was playing. It owns the imperative bits — a {@link TtsPlayer}
 * and an EventSource — and exposes a tiny store API (`subscribe`/`getSnapshot`)
 * for React via `useSyncExternalStore`.
 *
 * Flow mirrors the Voice Mode REST path (useVoiceConversation.ts):
 *   POST /api/voice/narrate {text, tts_voice} -> {streamId}
 *   EventSource /api/voice/narrate/stream/<id> -> tts_start / tts_chunk / tts_end
 *   -> player.prepare / pushChunk / finish
 *
 * The player MUST be constructed inside the click gesture (iOS Safari requires
 * Audio()/AudioContext creation within a user gesture), so `narrate()` calls
 * `createTtsPlayer()` synchronously before any `await`.
 */
import { createTtsPlayer, type TtsPlayer } from './ttsPlayer';

export type NarrationStatus = 'idle' | 'loading' | 'playing';

export type NarrationSnapshot = {
  activeMessageId: string | null;
  status: NarrationStatus;
};

const NARRATE_URL = '/api/voice/narrate';
const NARRATE_STREAM_URL = (id: string) => `/api/voice/narrate/stream/${id}`;

function getSessionKey(): string | null {
  try {
    return sessionStorage.getItem('nash_session_key');
  } catch {
    return null;
  }
}

let player: TtsPlayer | null = null;
let es: EventSource | null = null;
let activeMessageId: string | null = null;
let status: NarrationStatus = 'idle';
// Bumped on every narrate()/stop(). Async continuations from a superseded call
// compare their captured token against this and bail if they no longer match,
// so a fast click-another-message can't have a stale stream resurrect itself.
let runToken = 0;

let snapshot: NarrationSnapshot = { activeMessageId: null, status: 'idle' };
const subscribers = new Set<() => void>();

function emit(): void {
  // New object reference so useSyncExternalStore detects the change.
  snapshot = { activeMessageId, status };
  for (const cb of subscribers) {
    cb();
  }
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): NarrationSnapshot {
  return snapshot;
}

/** Close the stream and destroy the player without notifying — callers emit. */
function teardown(): void {
  if (es) {
    es.close();
    es = null;
  }
  if (player) {
    player.stop();
    player = null;
  }
  activeMessageId = null;
  status = 'idle';
}

function stop(): void {
  if (status === 'idle' && !es && !player) {
    return;
  }
  runToken++; // invalidate any in-flight async work
  teardown();
  emit();
}

async function narrate(
  messageId: string,
  text: string,
  conversationId?: string,
  voice?: string,
): Promise<void> {
  // Toggle off if this exact message is already the active one.
  if (activeMessageId === messageId && status !== 'idle') {
    stop();
    return;
  }

  // Replace whatever is playing/loading (one narration at a time).
  teardown();

  // Construct the player synchronously, inside the click gesture.
  player = createTtsPlayer();
  const activePlayer = player;
  activeMessageId = messageId;
  status = 'loading';
  const token = ++runToken;
  emit();

  const body: Record<string, string> = { text };
  if (conversationId) {
    body.conversationId = conversationId;
  }
  if (voice) {
    body.tts_voice = voice;
  }

  const sessionKey = getSessionKey();
  let startResp: Response;
  try {
    startResp = await fetch(NARRATE_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionKey ? { 'X-Session-Key': sessionKey } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    if (token === runToken) {
      teardown();
      emit();
    }
    return;
  }
  if (token !== runToken) {
    return; // superseded while awaiting the POST
  }
  if (!startResp.ok) {
    teardown();
    emit();
    return;
  }

  let startBody: { streamId?: string };
  try {
    startBody = (await startResp.json()) as { streamId?: string };
  } catch {
    if (token === runToken) {
      teardown();
      emit();
    }
    return;
  }
  if (token !== runToken) {
    return;
  }
  if (!startBody.streamId) {
    teardown();
    emit();
    return;
  }

  // EventSource can't set headers — it relies on the httpOnly session cookie,
  // same as /api/voice/converse/stream.
  const source = new EventSource(NARRATE_STREAM_URL(startBody.streamId));
  es = source;
  let gotChunk = false;

  const finalize = (): void => {
    if (token === runToken) {
      teardown();
      emit();
    }
  };

  source.onmessage = async (ev) => {
    if (token !== runToken) {
      return;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    const t = data.type as string | undefined;
    if (t === 'tts_start') {
      status = 'playing';
      emit();
      activePlayer.prepare((data.mimeType as string | undefined) ?? '');
    } else if (t === 'tts_chunk') {
      if (typeof data.data === 'string') {
        gotChunk = true;
        activePlayer.pushChunk(data.data);
      }
    } else if (t === 'tts_end') {
      const mime = (data.mimeType as string | undefined) ?? 'audio/mpeg';
      // Close before awaiting so the server's subsequent connection close
      // doesn't trip onerror's reconnect path.
      source.close();
      if (es === source) {
        es = null;
      }
      try {
        await activePlayer.finish(mime);
      } finally {
        finalize();
      }
    } else if (t === 'error') {
      source.close();
      finalize();
    }
  };

  source.onerror = () => {
    // Normal end already closed the source (es === null) — ignore. A genuine
    // mid-stream drop with audio already buffered should still play out.
    if (es !== source || token !== runToken) {
      return;
    }
    source.close();
    es = null;
    if (gotChunk) {
      activePlayer.finish('audio/mpeg').finally(finalize);
    } else {
      finalize();
    }
  };
}

export const narrationController = {
  narrate,
  stop,
  subscribe,
  getSnapshot,
};
