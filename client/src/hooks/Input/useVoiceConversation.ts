import { useCallback, useEffect, useRef, useState } from 'react';
import { createEnergyVad, type VadController } from '~/audio/vad';
import { createTtsPlayer, type TtsPlayer } from '~/audio/ttsPlayer';

/** Where the audio you're hearing comes from — exposed so the UI can
 *  truthfully label browser-TTS fallback runs ("voiced by your device"). */
export type VoiceSource = 'backboard' | 'browser';

export type VoiceState =
  | { status: 'idle' }
  | { status: 'opening-mic' }
  | { status: 'listening'; level: number; partial?: string }
  | { status: 'thinking' }
  | { status: 'speaking'; level: number; userText: string; assistantText: string; source: VoiceSource }
  | { status: 'error'; message: string };

type Options = {
  /** Nash conversationId to pin the turn to (empty for new convo). */
  conversationId?: string;
  /** Optional LLM model spec (e.g. ``openai/gpt-4.1``). */
  model?: string;
  /** Language for STT. */
  language?: string;
  /** TTS voice id. */
  ttsVoice?: string;
  /** Notify host conversation that a new convo id was minted by the backend. */
  onConversationId?: (id: string) => void;
};

const CONVERSE_URL = '/api/voice/converse';
const STREAM_URL = (id: string) => `/api/voice/converse/stream/${id}`;

/**
 * Drive the Phase 2 voice-conversation loop. The host component opens the
 * voice overlay → calls ``begin()`` (one user gesture, satisfies the iOS
 * Safari requirement for AudioContext). After that, the hook cycles through
 * listening → thinking → speaking automatically until ``end()`` is called.
 *
 * Tap-to-interrupt: ``interrupt()`` stops TTS playback and abandons the
 * in-flight SSE stream so the user can speak again.
 */
export default function useVoiceConversation({
  conversationId,
  model,
  language,
  ttsVoice,
  onConversationId,
}: Options) {
  const [state, setState] = useState<VoiceState>({ status: 'idle' });
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const recordedMimeRef = useRef<string>('audio/webm');
  const vadRef = useRef<VadController | null>(null);
  // Safety timeout for a listening turn: if the user never speaks loud
  // enough to trip the VAD speaking→silence transition, we'd hang forever
  // waiting for it. Cap at 60 s of total listening so a stalled turn
  // always submits eventually.
  const listeningDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_LISTENING_MS = 60_000;
  // ONE TtsPlayer per overlay-open. iOS Safari requires the original user
  // gesture to be the same Audio element across turns, so we hoist the
  // player here and call reset() between turns rather than recreating it.
  const playerRef = useRef<TtsPlayer | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeConvoRef = useRef<string>(conversationId || '');
  const turnTextsRef = useRef<{ user: string; assistant: string }>({ user: '', assistant: '' });
  // True between begin() and cleanup(). Used to gate the post-`final`
  // chain (browser-TTS fallback + restartListening) so it bails out when
  // the user closes the overlay mid-turn instead of silently re-opening
  // the mic in the background.
  const activeRef = useRef(false);
  // Set when a Backboard tts_audio_chunk event arrives for the current
  // turn. If false at run_ended, we know Backboard's TTS pipeline never
  // fired and the fallback is honest about what's speaking.
  const ttsChunkReceivedRef = useRef(false);

  // Tear down everything when the host component unmounts.
  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = useCallback(() => {
    activeRef.current = false;
    if (listeningDeadlineRef.current !== null) {
      clearTimeout(listeningDeadlineRef.current);
      listeningDeadlineRef.current = null;
    }
    // Stop any in-flight browser-TTS fallback so the assistant doesn't
    // keep speaking after the overlay closes.
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    try {
      eventSourceRef.current?.close();
    } catch {
      /* noop */
    }
    eventSourceRef.current = null;
    vadRef.current?.stop();
    vadRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        /* noop */
      }
    }
    recorderRef.current = null;
    recordedChunksRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    playerRef.current?.stop();
    playerRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    setState({ status: 'opening-mic' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // The user can press Escape during the getUserMedia await. cleanup()
      // would have flipped activeRef.current = false, but the new stream
      // we just got isn't yet tracked by streamRef and would otherwise
      // stay hot in the background.
      if (!activeRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recordedMimeRef.current = mime;
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        sendTurn().catch((err) => {
          setState({ status: 'error', message: errorMessage(err) });
        });
      };
      recorderRef.current = recorder;
      recorder.start();

      const vad = createEnergyVad(stream, {
        onLevel: (level) => {
          setState((prev) => (prev.status === 'listening' ? { status: 'listening', level } : prev));
        },
        onSpeechEnd: () => {
          // Auto-submit on silence — main hands-free path.
          stopListening();
        },
      });
      vad.start();
      vadRef.current = vad;
      // Safety net: cap each listening turn at MAX_LISTENING_MS so a quiet
      // mic or VAD glitch can't hold the user hostage forever. If the user
      // truly is speaking continuously, the VAD will fire onSpeechEnd
      // earlier; if they're silent, this kicks in.
      if (listeningDeadlineRef.current !== null) {
        clearTimeout(listeningDeadlineRef.current);
      }
      listeningDeadlineRef.current = setTimeout(() => {
        listeningDeadlineRef.current = null;
        stopListening();
      }, MAX_LISTENING_MS);
      setState({ status: 'listening', level: 0 });
    } catch (err) {
      cleanup();
      setState({ status: 'error', message: micErrorMessage(err) });
    }
  }, [cleanup]);

  const stopListening = useCallback(() => {
    if (listeningDeadlineRef.current !== null) {
      clearTimeout(listeningDeadlineRef.current);
      listeningDeadlineRef.current = null;
    }
    vadRef.current?.stop();
    vadRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      // Recorder was never started or already done; advance manually.
      void sendTurn();
    }
  }, []);

  const sendTurn = useCallback(async () => {
    const chunks = recordedChunksRef.current.splice(0);
    const mime = recordedMimeRef.current;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (chunks.length === 0) {
      setState({ status: 'idle' });
      return;
    }
    const blob = new Blob(chunks, { type: mime });
    if (blob.size === 0) {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'thinking' });
    turnTextsRef.current = { user: '', assistant: '' };
    ttsChunkReceivedRef.current = false;
    // Player is created lazily on the FIRST turn (during the user-gesture
    // that opened the overlay), then reset() between turns so iOS Safari
    // keeps the original gesture authorization for subsequent .play()s.
    if (!playerRef.current) {
      const p = createTtsPlayer();
      // Subscribe ONCE for the lifetime of the player. The setState callback
      // is a no-op outside speaking state, so emitting level during reset
      // gaps is harmless. Avoids accumulating stale listeners if a turn
      // ends via interrupt/error instead of the happy tts_end path.
      p.onLevel((level) => {
        setState((prev) =>
          prev.status === 'speaking' ? { ...prev, level } : prev,
        );
      });
      playerRef.current = p;
    } else {
      playerRef.current.reset();
    }
    const player = playerRef.current;

    const form = new FormData();
    form.append('audio_file', blob, `nash-voice.${mimeFileExt(mime)}`);
    if (activeConvoRef.current) form.append('conversationId', activeConvoRef.current);
    if (model) form.append('model', model);
    if (language) form.append('language', language);
    if (ttsVoice) form.append('tts_voice', ttsVoice);

    const sessionKey = (() => {
      try {
        return sessionStorage.getItem('nash_session_key');
      } catch {
        return null;
      }
    })();

    let startResp: Response;
    try {
      startResp = await fetch(CONVERSE_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: sessionKey ? { 'X-Session-Key': sessionKey } : undefined,
        body: form,
      });
    } catch {
      setState({ status: 'error', message: 'Network error starting voice turn.' });
      return;
    }
    if (!startResp.ok) {
      setState({ status: 'error', message: `Voice turn failed (HTTP ${startResp.status}).` });
      return;
    }
    const startBody = (await startResp.json()) as { streamId?: string; conversationId?: string };
    if (!startBody.streamId) {
      setState({ status: 'error', message: 'No stream id from server.' });
      return;
    }
    if (startBody.conversationId && startBody.conversationId !== activeConvoRef.current) {
      activeConvoRef.current = startBody.conversationId;
      onConversationId?.(startBody.conversationId);
    }

    // EventSource doesn't support custom headers, so the session must
    // already be on a cookie (it is — apikey-login set httpOnly session_key).
    const es = new EventSource(STREAM_URL(startBody.streamId));
    eventSourceRef.current = es;

    es.onmessage = async (ev) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      const t = data.type as string | undefined;
      if (t === 'stt_delta' || t === 'stt_end') {
        turnTextsRef.current.user = String(data.text ?? '');
      } else if (t === 'assistant_delta') {
        turnTextsRef.current.assistant = String(data.text ?? '');
      } else if (t === 'tts_start') {
        // Move to speaking state ahead of audio chunks so the orb starts pulsing.
        setState({
          status: 'speaking',
          level: 0,
          userText: turnTextsRef.current.user,
          assistantText: turnTextsRef.current.assistant,
          source: 'backboard',
        });
        const mime = (data.mimeType as string | undefined) ?? '';
        player.prepare(mime);
      } else if (t === 'tts_chunk') {
        if (typeof data.data === 'string') {
          ttsChunkReceivedRef.current = true;
          player.pushChunk(data.data);
        }
      } else if (t === 'tts_end') {
        const mimeType = (data.mimeType as string | undefined) ?? 'audio/mpeg';
        await player.finish(mimeType);
      } else if (t === 'final') {
        es.close();
        eventSourceRef.current = null;
        // Safety net: if for any reason Backboard didn't stream
        // tts_audio_chunk events for this turn, fall back to the
        // browser's built-in speechSynthesis — labelled as 'browser' so
        // the UI never pretends it's Backboard.
        const assistantText = String(data.assistantText ?? turnTextsRef.current.assistant ?? '');
        const backboardSpoke = ttsChunkReceivedRef.current;
        const speakStart = performance.now();
        if (
          !backboardSpoke
          && assistantText
          && typeof window !== 'undefined'
          && 'speechSynthesis' in window
        ) {
          setState({
            status: 'speaking',
            level: 0.5,
            userText: turnTextsRef.current.user,
            assistantText,
            source: 'browser',
          });
          await speakViaBrowserTts(assistantText);
        }
        // Always hold the "Nash replied" view for a minimum visible
        // duration. When Backboard's TTS is silent AND browser
        // speechSynthesis is a no-op (no voices loaded, OS muted), the
        // speaking state can disappear in ~50ms and the user only sees
        // "thinking" flash straight into "listening" — confusing them
        // into thinking we re-armed the mic mid-thought.
        if (assistantText && activeRef.current) {
          const MIN_VISIBLE_MS = 1500;
          // Make sure we *do* show the assistantText, even when no TTS path
          // ran (e.g. backboard spoke via audio chunks and we never set
          // 'speaking' here, or assistantText only landed in the final
          // payload). Idempotent: if we're already in speaking, just
          // refresh the level so the orb keeps pulsing during the pause.
          setState((prev) => (
            prev.status === 'speaking'
              ? { ...prev, level: 0.4 }
              : {
                  status: 'speaking',
                  level: 0.4,
                  userText: turnTextsRef.current.user,
                  assistantText,
                  source: backboardSpoke ? 'backboard' : 'browser',
                }
          ));
          const elapsed = performance.now() - speakStart;
          const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
          if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
        }
        // If the user closed the overlay mid-speak (Escape), cleanup() has
        // already flipped activeRef.current = false. Bail before restarting
        // the mic, otherwise we'd silently re-open getUserMedia with no UI.
        if (!activeRef.current) return;
        await startListening();
      } else if (t === 'error') {
        es.close();
        eventSourceRef.current = null;
        const raw = String(data.error ?? 'voice error');
        // Backboard rejects turns where STT produced no text with this
        // exact message. It's not really an error — the user just didn't
        // say anything intelligible. Don't dump that string on them; show
        // a friendlier prompt and (if the overlay is still open) loop
        // straight back into listening so they can retry.
        const couldntHear = /content cannot be empty/i.test(raw);
        if (couldntHear && activeRef.current) {
          await startListening();
        } else {
          setState({ status: 'error', message: couldntHear ? "Didn't catch that — try speaking again." : raw });
        }
      }
    };
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setState({ status: 'error', message: 'Voice stream interrupted.' });
    };
  }, [model, language, ttsVoice, onConversationId, startListening]);

  const interrupt = useCallback(() => {
    // Cancel the in-flight TTS playback but KEEP the player alive — we want
    // to use it again on the next turn without losing the iOS gesture.
    playerRef.current?.reset();
    // Also kill any in-flight browser-TTS fallback utterance.
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    try {
      eventSourceRef.current?.close();
    } catch {
      /* noop */
    }
    eventSourceRef.current = null;
    void startListening();
  }, [startListening]);

  const begin = useCallback(async () => {
    activeRef.current = true;
    await startListening();
  }, [startListening]);

  const end = useCallback(() => {
    cleanup();
    setState({ status: 'idle' });
  }, [cleanup]);

  /** Force the current listening turn to submit immediately, bypassing the
   *  VAD's silence-timeout. Used by the Spacebar push-to-talk hotkey. No-op
   *  outside the listening state. */
  const submitNow = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      stopListening();
    }
  }, [stopListening]);

  return { state, begin, end, interrupt, submitNow };
}

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'audio/webm';
}

function mimeFileExt(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * Browser-native TTS fallback for when Backboard's TTS pipeline doesn't emit
 * any tts_audio_chunk events (account tier, voice config rejected, etc.).
 * Returns when speaking completes — or, on browsers without
 * speechSynthesis, returns immediately so the loop continues.
 */
function speakViaBrowserTts(text: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve();
        return;
      }
      // Cancel any previous in-flight utterance so back-to-back turns
      // don't pile up.
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 1.0;
      u.volume = 1.0;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    } catch {
      resolve();
    }
  });
}

function micErrorMessage(err: unknown): string {
  const e = err as DOMException | undefined;
  if (e?.name === 'NotAllowedError') return 'Microphone access denied.';
  if (e?.name === 'NotFoundError') return 'No microphone found.';
  if (e?.name === 'NotReadableError') return 'Mic is in use by another app.';
  return 'Could not access the microphone.';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'voice error';
}
