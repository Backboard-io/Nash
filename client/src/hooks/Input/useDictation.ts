import { useCallback, useEffect, useRef, useState } from 'react';
import { startPcmCapture, type PcmCapture, type PcmCaptureError } from '~/audio/pcmCapture';
import { openRealtimeSession, type RealtimeSession } from '~/audio/realtimeSession';

export type DictationErrorCode = PcmCaptureError | 'connection-failed' | 'unknown';

export type DictationState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'recording'; level: number }
  | { status: 'finishing' }
  | { status: 'error'; code: DictationErrorCode };

type Options = {
  /**
   * Called with the cumulative dictated text (committed final segments +
   * the current in-progress partial) every time it changes. Each call
   * REPLACES the previous value — the caller combines it with whatever was
   * already in the input field.
   */
  onTranscript: (text: string) => void;
  /** STT language (ISO-639-1). Optional — server falls back to its default. */
  language?: string;
};

const DICTATION_PATH = '/api/voice/dictation';
// After `commit`, wait this long for the flushed transcript.final before
// closing. Resolves early the moment a final arrives. The live partial is
// already in the composer, so even if no final lands the user keeps their text.
const FINALIZE_GRACE_MS = 2000;

/**
 * Press-to-talk dictation streamed over the realtime WebSocket
 * (`/api/voice/dictation`). `start()` opens the mic and an STT-only relay;
 * partial transcripts stream into the composer live via `onTranscript`.
 * `stop()` flushes the tail and closes; `cancel()` discards.
 *
 * Capture starts the instant the mic is granted and buffers PCM until the
 * socket finishes its handshake, so the first words are never clipped while
 * the relay is still connecting.
 */
export default function useDictation({ onTranscript, language }: Options) {
  const [state, setState] = useState<DictationState>({ status: 'idle' });

  const sessionRef = useRef<RealtimeSession | null>(null);
  const captureRef = useRef<PcmCapture | null>(null);
  const committedRef = useRef('');
  const partialRef = useRef('');
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  // Resolver for stop()'s "wait for the flushed final" grace window.
  const finalizeWaiterRef = useRef<(() => void) | null>(null);

  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const emit = useCallback(() => {
    const committed = committedRef.current;
    const partial = partialRef.current;
    const joined = committed && partial ? `${committed} ${partial}` : committed + partial;
    onTranscriptRef.current(joined.trim());
  }, []);

  const teardown = useCallback(async () => {
    try {
      await captureRef.current?.stop();
    } catch {
      /* noop */
    }
    captureRef.current = null;
    try {
      sessionRef.current?.close();
    } catch {
      /* noop */
    }
    sessionRef.current = null;
  }, []);

  // Tear down on unmount so a mid-dictation navigation releases the mic + WS.
  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  const start = useCallback(async () => {
    if (startingRef.current || sessionRef.current || captureRef.current) return;
    startingRef.current = true;
    stoppingRef.current = false;
    committedRef.current = '';
    partialRef.current = '';
    setState({ status: 'connecting' });

    // Buffer PCM until the relay handshake completes, then flush + stream live.
    const pending: ArrayBuffer[] = [];
    let wsReady = false;

    // 1. Open the mic first — capture begins immediately so nothing is lost
    //    while the socket connects.
    let capture: PcmCapture;
    try {
      capture = await startPcmCapture({
        onChunk: (buf) => {
          const s = sessionRef.current;
          if (wsReady && s) {
            s.sendPcm(buf);
          } else {
            pending.push(buf);
          }
        },
        onLevel: (level) => {
          setState((prev) => (prev.status === 'recording' ? { status: 'recording', level } : prev));
        },
        onError: (code) => {
          startingRef.current = false;
          setState({ status: 'error', code });
          void teardown();
        },
      });
    } catch {
      // startPcmCapture already surfaced a specific code via onError.
      startingRef.current = false;
      return;
    }
    captureRef.current = capture;
    setState({ status: 'recording', level: 0 });

    // 2. Open the STT-only relay.
    let session: RealtimeSession;
    try {
      session = await openRealtimeSession({ path: DICTATION_PATH, language });
    } catch {
      startingRef.current = false;
      setState({ status: 'error', code: 'connection-failed' });
      void teardown();
      return;
    }
    // Mic acquisition may have failed/cancelled while the WS was opening.
    if (!captureRef.current) {
      try {
        session.close();
      } catch {
        /* noop */
      }
      startingRef.current = false;
      return;
    }
    sessionRef.current = session;

    // 3. Pump transcript events into the composer.
    void (async () => {
      try {
        for await (const ev of session.events()) {
          const text = typeof ev.text === 'string' ? ev.text : '';
          if (ev.type === 'transcript.partial') {
            partialRef.current = text;
            emit();
          } else if (ev.type === 'transcript.final') {
            if (text) {
              committedRef.current = committedRef.current
                ? `${committedRef.current} ${text}`
                : text;
            }
            partialRef.current = '';
            emit();
            // If stop() is waiting on the flushed tail, release it now.
            finalizeWaiterRef.current?.();
          } else if (ev.type === 'error' && !stoppingRef.current) {
            setState({ status: 'error', code: 'connection-failed' });
            void teardown();
          }
        }
      } catch {
        /* iterator ended on close */
      }
    })();

    // 4. Flush anything captured during the handshake, then go live.
    wsReady = true;
    for (const buf of pending) {
      session.sendPcm(buf);
    }
    pending.length = 0;
    startingRef.current = false;
  }, [emit, language, teardown]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    const capture = captureRef.current;
    if (!session && !capture) return;
    stoppingRef.current = true;
    setState({ status: 'finishing' });

    // Stop sending audio, then ask the server to flush the buffered tail.
    try {
      await capture?.stop();
    } catch {
      /* noop */
    }
    captureRef.current = null;
    try {
      session?.commit();
    } catch {
      /* noop */
    }

    // Wait for the flushed final (resolves early) or the grace cap.
    if (session) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          finalizeWaiterRef.current = null;
          resolve();
        };
        finalizeWaiterRef.current = finish;
        setTimeout(finish, FINALIZE_GRACE_MS);
      });
    }

    try {
      session?.close();
    } catch {
      /* noop */
    }
    sessionRef.current = null;
    setState({ status: 'idle' });
  }, []);

  const cancel = useCallback(() => {
    stoppingRef.current = true;
    finalizeWaiterRef.current?.();
    void teardown();
    committedRef.current = '';
    partialRef.current = '';
    setState({ status: 'idle' });
  }, [teardown]);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return { state, start, stop, cancel, reset };
}
