import { memo, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Constants } from 'librechat-data-provider';
import { useRecoilValue } from 'recoil';
import { useLocalize } from '~/hooks';
import useVoiceConversationRT from '~/hooks/Input/useVoiceConversationRealtime';
import { type VoiceState } from '~/hooks/Input/useVoiceConversation';
import store from '~/store';
import Orb, { type OrbState } from './Orb';

type Props = {
  open: boolean;
  conversationId?: string;
  model?: string;
  onClose: () => void;
  onConversationId?: (id: string) => void;
};

/**
 * Fullscreen voice-conversation overlay.
 *
 * Tapping the entry button opens this portal; the user speaks hands-free with
 * server-side VAD turn-taking. Space sends the current turn immediately; Esc,
 * the X, or the Exit live mode button closes the overlay and ends the session. There is no mid-response
 * interrupt yet — barge-in is deferred until Backboard's realtime models
 * support it (today the endpoint keeps streaming TTS through a stop).
 */
function VoiceMode({ open, conversationId, model, onClose, onConversationId }: Props) {
  // Realtime WebSocket path: live partial transcripts, server-side VAD,
  // persistent session across turns. The REST hook still lives in tree
  // (useVoiceConversation.ts + /api/voice/converse) as a fallback we can
  // swap back to without redesign if Backboard's realtime endpoint regresses.
  void model;  // model is REST-only for now; realtime uses the assistant default
  // Voice resolution order: per-conversation override (composer Voice pill) →
  // per-user default (Settings → Preferences) → server default (undefined).
  const defaultTTSVoice = useRecoilValue(store.defaultTTSVoice);
  const perConvoVoice = useRecoilValue(
    store.ttsVoiceByConversation(conversationId ?? Constants.NEW_CONVO),
  );
  const effectiveVoice = perConvoVoice || defaultTTSVoice;
  const { state, begin, end, submitNow } = useVoiceConversationRT({
    conversationId,
    ttsVoice: effectiveVoice || undefined,
    onConversationId,
  });

  // Open → request mic. Close → tear down.
  useEffect(() => {
    if (open) {
      void begin();
    } else {
      end();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keyboard shortcuts while the overlay is open:
  //   - Escape: close
  //   - Space (release): submit the current listening turn immediately,
  //     skipping the VAD silence-timeout. Pressing Space does nothing —
  //     the user is already being listened to; we only need a manual
  //     "send now" hotkey for impatient or quiet-room cases.
  useEffect(() => {
    if (!open) return;
    const isTextFocus = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Swallow space so it doesn't scroll the page underneath the overlay.
      if (e.key === ' ' && !isTextFocus()) {
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isTextFocus()) {
        e.preventDefault();
        submitNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [open, onClose, submitNow]);

  // Lock body scroll while the overlay is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const localize = useLocalize();
  const { orbState, level, status } = useMemo(() => toView(state), [state]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-surface-primary"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute left-4 top-4 rounded-full border border-[#4F48D9]/40 bg-[#635BFF]/10 px-2 py-0.5 text-xs font-medium text-[#4F48D9] dark:text-[#B9B5FF]">
        {localize('com_ui_beta')}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close voice mode"
        className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      <Orb state={orbState} level={level} />

      <div className="mt-4 text-sm text-text-tertiary" aria-live="polite">
        {status}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mt-8 inline-flex items-center gap-2 rounded-full border border-[#4F48D9]/40 bg-[#635BFF]/10 px-5 py-2.5 text-sm font-medium text-[#4F48D9] transition-colors hover:bg-[#635BFF]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-[#B9B5FF]"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        {localize('com_ui_exit_live_mode')}
      </button>
    </div>,
    document.body,
  );
}

function toView(s: VoiceState): {
  orbState: OrbState;
  level: number;
  status: string;
} {
  if (s.status === 'listening') {
    // Show the live partial transcript under the orb so the user has
    // confirmation that we heard them. This is the only text shown during
    // a voice session — full transcripts belong to the chat thread, not
    // the voice overlay (matches ChatGPT Voice).
    const partial = (s.partial || '').trim();
    return {
      orbState: 'listening',
      level: s.level,
      status: partial ? `"${partial}"` : 'Listening… speak whenever',
    };
  }
  if (s.status === 'thinking') {
    // No label — the orb's motion/color conveys the state.
    return { orbState: 'thinking', level: 0, status: '' };
  }
  if (s.status === 'speaking') {
    // No label — the orb conveys speaking. Mid-response barge-in is deferred
    // (Backboard keeps streaming TTS through a stop), so the reply plays out;
    // Esc/X exits. Backboard TTS is the only source.
    return { orbState: 'speaking', level: s.level, status: '' };
  }
  if (s.status === 'opening-mic') {
    return { orbState: 'idle', level: 0, status: 'Opening microphone…' };
  }
  if (s.status === 'error') {
    return { orbState: 'idle', level: 0, status: s.message };
  }
  return { orbState: 'idle', level: 0, status: 'Ready' };
}

export default memo(VoiceMode);
