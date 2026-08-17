/**
 * Realtime voice-conversation hook (WebSocket path).
 *
 * Drives the same orb state machine as `useVoiceConversation` but over a
 * persistent WebSocket session relayed through Flask to Backboard. The
 * UX win vs. the REST path:
 *   - Live partial transcripts (orb subtitle updates as the user speaks)
 *   - Server-side VAD — no client-side energy thresholds to tune
 *   - Near-zero turn-switching latency (no upload round trip)
 *
 * Reused from the REST hook:
 *   - `VoiceState` type
 *   - `ttsPlayer` for chunked MP3 playback
 *   - Persistent audio element gesture authorization (iOS)
 *   - `activeRef` guard so post-close races don't re-open the mic
 *
 * Backboard TTS is the only audio source — there is no browser-synthesizer
 * fallback. If a turn produces text but no TTS audio, the hook surfaces an
 * error instead of reading the reply in a robotic OS voice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createTtsPlayer, type TtsPlayer } from '~/audio/ttsPlayer';
import { startPcmCapture, type PcmCapture } from '~/audio/pcmCapture';
import { openRealtimeSession, type RealtimeSession } from '~/audio/realtimeSession';
import { queueTitleGeneration } from '~/data-provider/SSE/queries';
import type { VoiceState } from './useVoiceConversation';

type Options = {
  conversationId?: string;
  language?: string;
  ttsVoice?: string;
  onConversationId?: (id: string) => void;
};

export default function useVoiceConversationRealtime({
  conversationId,
  language,
  ttsVoice,
  onConversationId,
}: Options) {
  const [state, setState] = useState<VoiceState>({ status: 'idle' });

  const captureRef = useRef<PcmCapture | null>(null);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const playerRef = useRef<TtsPlayer | null>(null);
  const activeRef = useRef(false);
  // Per-turn state. Reset each time the server emits input.paused so the
  // next turn starts with a clean slate.
  const turnTextsRef = useRef<{ user: string; partial: string; assistant: string }>({
    user: '', partial: '', assistant: '',
  });
  const ttsChunkReceivedRef = useRef(false);
  const activeConvoRef = useRef<string>(conversationId || '');
  // Set when the server mints a brand-new conversation id for this session
  // (voice opened from /c/new). Gates the one queueTitleGeneration() call
  // below — an existing conversation already has a real title and
  // shouldn't have it regenerated/overwritten.
  const isNewConvoRef = useRef(false);

  // Tear down everything when the host component unmounts.
  useEffect(() => {
    return () => {
      void cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = useCallback(async () => {
    activeRef.current = false;
    const sess = sessionRef.current;
    sessionRef.current = null;
    try { sess?.close(); } catch { /* noop */ }
    const cap = captureRef.current;
    captureRef.current = null;
    try { await cap?.stop(); } catch { /* noop */ }
    const player = playerRef.current;
    playerRef.current = null;
    try { player?.stop(); } catch { /* noop */ }
  }, []);

  /** Handle one event from the realtime session. Drives the state
   *  machine and the TTS player. */
  const handleEvent = useCallback(async (ev: Record<string, unknown>) => {
    if (!activeRef.current) return;
    const t = String(ev.type ?? '');

    if (t === 'transcript.partial') {
      const text = String(ev.text ?? '');
      turnTextsRef.current.partial = text;
      setState((prev) =>
        prev.status === 'listening' ? { ...prev, partial: text } : prev,
      );
    } else if (t === 'transcript.final') {
      turnTextsRef.current.user = String(ev.text ?? '');
      turnTextsRef.current.partial = '';
    } else if (t === 'input.paused') {
      // Assistant turn starts. Mute the mic so the assistant's own TTS
      // playback isn't picked up by the mic (echo) and so the user's
      // mid-thought doesn't bleed into the reply. Backboard is half-duplex
      // and ignores audio during its turn anyway; muting keeps our local
      // analyser quiet too. Unmuted again on input.resumed.
      captureRef.current?.setMuted(true);
      ttsChunkReceivedRef.current = false;
      turnTextsRef.current.assistant = '';
      setState({ status: 'thinking' });
    } else if (t === 'content_streaming') {
      const content = String(ev.content ?? '');
      if (content) {
        turnTextsRef.current.assistant += content;
        // While LLM is streaming, sit in speaking (with no audio yet) so
        // the user sees the response forming.
        setState({
          status: 'speaking',
          level: 0.3,
          userText: turnTextsRef.current.user,
          assistantText: turnTextsRef.current.assistant,
          source: 'backboard',
        });
      }
    } else if (t === 'tts_stream_start') {
      // CRITICAL for multi-turn: reset the player BEFORE prepare(). The
      // player is hoisted across turns to keep iOS user-gesture auth, but
      // its MediaSource + chunk buffers from the previous turn would
      // otherwise survive — prepare() is a no-op after the first call, so
      // turn 2's audio would append to turn 1's MediaSource and play the
      // old assistant reply.
      const player = ensurePlayer();
      player.reset();
      const mime = (ev.content_type as string | undefined) ?? '';
      player.prepare(mime);
      setState({
        status: 'speaking',
        level: 0.5,
        userText: turnTextsRef.current.user,
        assistantText: turnTextsRef.current.assistant,
        source: 'backboard',
      });
    } else if (t === 'tts_audio_chunk') {
      if (typeof ev.data === 'string') {
        ttsChunkReceivedRef.current = true;
        ensurePlayer().pushChunk(ev.data);
      }
    } else if (t === 'tts_stream_end') {
      const mime = (ev.content_type as string | undefined) ?? 'audio/mpeg';
      await ensurePlayer().finish(mime);
    } else if (t === 'input.resumed') {
      // Assistant turn finished.
      if (!activeRef.current) return;
      // If the LLM produced a reply but Backboard streamed no TTS audio for
      // this turn, surface a clear error rather than silently swallowing it.
      if (!ttsChunkReceivedRef.current && turnTextsRef.current.assistant) {
        setState({
          status: 'error',
          message: 'Voice playback unavailable — no audio was returned for this turn.',
        });
        return;
      }
      // Unmute the mic and go back to listening for the next turn. The WS
      // session stays open across turns — no need to reopen.
      captureRef.current?.setMuted(false);
      setState({ status: 'listening', level: 0 });
    } else if (t === 'session.begin' || t === 'user_message' || t === 'message_saved') {
      // Lifecycle / bookkeeping — nothing to do. (message_saved is documented
      // but was never observed firing in practice; run_ended below is what
      // actually carries the finished assistant message.)
    } else if (t === 'run_ended') {
      // Assistant reply just finished (this event carries the final
      // message_id/content directly). For a brand-new conversation, this is
      // the earliest point gen_title() has anything to read — queue it the
      // same way text chat's SSE finalHandler does (useEventHandlers.ts)
      // instead of leaving the raw-transcript fallback
      // (maybe_autotitle_conversation) as the permanent title.
      if (isNewConvoRef.current && activeConvoRef.current) {
        isNewConvoRef.current = false;
        queueTitleGeneration(activeConvoRef.current);
      }
    } else if (t === 'error' || t === 'run_failed') {
      const msg = String(ev.message ?? ev.error ?? 'voice error');
      setState({ status: 'error', message: msg });
    }
    // Other events (run_started, message_start, etc.) are bookkeeping; we
    // intentionally ignore them.
  }, []);

  const ensurePlayer = useCallback((): TtsPlayer => {
    if (!playerRef.current) {
      playerRef.current = createTtsPlayer();
      // Subscribe once for the lifetime of the player.
      playerRef.current.onLevel((lvl) => {
        setState((prev) => (prev.status === 'speaking' ? { ...prev, level: lvl } : prev));
      });
    }
    return playerRef.current;
  }, []);

  // Drives the orb state machine off the session's event stream until the
  // session ends, then tears down and goes idle.
  const runPump = useCallback((sess: RealtimeSession) => {
    (async () => {
      try {
        for await (const ev of sess.events()) {
          await handleEvent(ev as Record<string, unknown>);
          if (!activeRef.current) break;
        }
      } catch (e) {
        if (activeRef.current) {
          setState({ status: 'error', message: `Realtime stream ended: ${(e as Error).message}` });
        }
      } finally {
        // Server closed the session — clean up our side and go idle.
        if (activeRef.current) {
          await cleanup();
          setState({ status: 'idle' });
        }
      }
    })();
  }, [handleEvent, cleanup]);

  const begin = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setState({ status: 'opening-mic' });

    // 1. Open the WS session first so we know auth/thread/etc. resolved
    //    before asking the user for mic permission.
    let sess: RealtimeSession;
    try {
      sess = await openRealtimeSession({
        conversationId: activeConvoRef.current || undefined,
        language,
        ttsVoice,
      });
    } catch (err) {
      activeRef.current = false;
      setState({ status: 'error', message: `Realtime session failed: ${(err as Error).message}` });
      return;
    }
    if (!activeRef.current) {
      sess.close();
      return;
    }
    sessionRef.current = sess;

    // The server may mint a brand-new conversation_id when none was provided
    // (e.g. voice mode opened from the New Chat page). Track it now so the
    // session/close logic sees the real id, but DEFER notifying the host:
    // onConversationId triggers a route change to /c/<id>, and navigating
    // before the mic is acquired interrupts the first-time getUserMedia
    // permission prompt — which breaks live audio on a brand-new chat. We
    // fire it below, only once the mic stream is live.
    const newConvoId = String(sess.beginEvent.conversation_id ?? '');
    const mintedConvoId =
      newConvoId && newConvoId !== activeConvoRef.current ? newConvoId : '';
    if (mintedConvoId) {
      activeConvoRef.current = mintedConvoId;
      isNewConvoRef.current = true;
    }

    // 2. Start PCM capture and pipe chunks straight into the session.
    let cap: PcmCapture;
    try {
      cap = await startPcmCapture({
        onChunk: (buf) => {
          // PCM chunks flow continuously; the server's VAD decides when
          // to commit. Capture's own setMuted gates whether we send.
          sessionRef.current?.sendPcm(buf);
        },
        onLevel: (lvl) => {
          setState((prev) => (prev.status === 'listening' ? { ...prev, level: lvl } : prev));
        },
      });
    } catch (err) {
      activeRef.current = false;
      sess.close();
      setState({ status: 'error', message: micErrorMessage(err) });
      return;
    }
    if (!activeRef.current) {
      void cap.stop();
      sess.close();
      return;
    }
    captureRef.current = cap;

    setState({ status: 'listening', level: 0 });

    // Mic is live — only now surface a newly-minted conversation id. The host
    // routes to /c/<id> here; doing it before getUserMedia resolved would
    // abort the first-time permission prompt on a brand-new chat.
    if (mintedConvoId) {
      onConversationId?.(mintedConvoId);
    }

    // 3. Pump events from the session — drives the state machine.
    //    session.begin is consumed inside openRealtimeSession, so it
    //    never reaches this loop.
    runPump(sess);
  }, [language, ttsVoice, onConversationId, runPump]);

  const end = useCallback(() => {
    void cleanup();
    setState({ status: 'idle' });
  }, [cleanup]);

  const submitNow = useCallback(() => {
    // Spacebar PTT semantics: ask the server to commit the current
    // partial transcript immediately. Only effective when the server
    // config sets `commit_strategy="manual"`; harmless otherwise.
    sessionRef.current?.commit();
  }, []);

  return { state, begin, end, submitNow };
}

function micErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code === 'permission-denied') return 'Microphone access denied.';
  if (code === 'no-device') return 'No microphone available.';
  if (code === 'os-blocked') return 'Microphone is in use by another app.';
  if (code === 'worklet-load-failed') return 'Audio worklet failed to load (refresh and retry).';
  if (code === 'unsupported') return 'Your browser does not support voice mode.';
  return `Microphone error: ${(err as Error).message ?? 'unknown'}`;
}
