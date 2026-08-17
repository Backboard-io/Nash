import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Mic, Square, Loader2, AlertCircle } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import useDictation, { type DictationState } from '~/hooks/Input/useDictation';
import { useChatFormContext } from '~/Providers';
import { cn } from '~/utils';

/**
 * Voice dictation button next to the chat-input toggles. Tap to start; the
 * transcript streams into the input live over the realtime WebSocket as you
 * speak. Tap again to stop (flushes the tail), or press Esc to cancel and
 * restore the original text. Dictation never auto-submits.
 *
 * Visual states:
 *   - idle       → mic icon
 *   - connecting → spinner (acquiring the microphone)
 *   - recording  → red square with a level-driven outer halo
 *   - finishing  → spinner (flushing the final transcript)
 *   - error      → triangle, tooltip explains why
 */
function MicButton() {
  // The chat input is a react-hook-form field named "text" — we inject the
  // transcript via setValue rather than a draft atom (drafts live in
  // localStorage, not Recoil, so a draft write wouldn't reach the mounted
  // textarea).
  const methods = useChatFormContext();

  // Composer text captured when dictation started. Live transcripts are
  // appended to this so the user's pre-existing text is preserved, and Esc
  // restores it verbatim.
  const baseRef = useRef('');

  const handleTranscript = useCallback(
    (live: string) => {
      const base = baseRef.current.trimEnd();
      const next = base && live ? `${base} ${live}` : base + live;
      methods.setValue('text', next, { shouldValidate: true });
    },
    [methods],
  );

  const { state, start, stop, cancel, reset } = useDictation({ onTranscript: handleTranscript });

  const handleCancel = useCallback(() => {
    cancel();
    methods.setValue('text', baseRef.current, { shouldValidate: true });
  }, [cancel, methods]);

  const onClick = useCallback(() => {
    if (state.status === 'idle' || state.status === 'error') {
      if (state.status === 'error') reset();
      baseRef.current = ((methods.getValues('text') as string | undefined) ?? '').trimEnd();
      void start();
      return;
    }
    if (state.status === 'recording') {
      void stop();
      return;
    }
    // connecting / finishing — in progress; clicking again is a no-op.
  }, [state.status, start, stop, reset, methods]);

  // Esc cancels an in-progress recording and restores the original text.
  useEffect(() => {
    if (state.status !== 'recording') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.status, handleCancel]);

  const tooltip = useMemo(() => tooltipFor(state), [state]);
  const recordingLevel = state.status === 'recording' ? state.level : 0;

  return (
    <TooltipAnchor
      description={tooltip}
      render={
        <button
          type="button"
          onClick={onClick}
          aria-label={tooltip}
          data-state={state.status}
          className={cn(
            'relative inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full sm:h-[34px] sm:w-[34px]',
            'bg-surface-active text-text-secondary',
            'transition-colors hover:bg-surface-active-alt',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            state.status === 'recording' && 'bg-red-500 text-white hover:bg-red-500',
            state.status === 'error' && 'bg-amber-500 text-white hover:bg-amber-500',
          )}
        >
          {state.status === 'recording' && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full border border-red-500/30"
              style={{
                transform: `scale(${1 + recordingLevel * 0.45})`,
                opacity: 0.25 + recordingLevel * 0.6,
                transition: 'transform 80ms linear, opacity 80ms linear',
              }}
            />
          )}
          {iconFor(state)}
        </button>
      }
    />
  );
}

function iconFor(state: DictationState) {
  if (state.status === 'recording') return <Square size={15} aria-hidden="true" />;
  if (state.status === 'connecting' || state.status === 'finishing')
    return <Loader2 size={17} className="animate-spin" aria-hidden="true" />;
  if (state.status === 'error') return <AlertCircle size={17} aria-hidden="true" />;
  return <Mic size={17} aria-hidden="true" />;
}

function tooltipFor(state: DictationState): string {
  if (state.status === 'recording') return 'Stop dictation (Esc to cancel)';
  if (state.status === 'connecting') return 'Connecting…';
  if (state.status === 'finishing') return 'Finishing…';
  if (state.status === 'error') {
    switch (state.code) {
      case 'permission-denied':
        return 'Microphone blocked — enable mic access in your browser to dictate.';
      case 'no-device':
        return 'No microphone found.';
      case 'os-blocked':
        return 'Mic is in use by another app.';
      case 'unsupported':
        return 'Voice dictation is not supported in this browser.';
      case 'worklet-load-failed':
        return 'Audio engine failed to load — tap to retry.';
      case 'connection-failed':
        return 'Dictation connection failed — tap to try again.';
      default:
        return 'Something went wrong — tap to retry.';
    }
  }
  return 'Dictate a message';
}

export default memo(MicButton);
