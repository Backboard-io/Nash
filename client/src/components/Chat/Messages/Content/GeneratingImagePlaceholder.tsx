import { memo } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { TMessage } from 'librechat-data-provider';
import { useBadgeRowContext } from '~/Providers';
import { useMessageContext } from '~/Providers';

type Props = {
  message?: TMessage;
};

/**
 * Render a "Generating image…" placeholder under the assistant bubble while
 * the Backboard Image Tool is producing media for this turn. Disappears the
 * moment a `media_generated` event lands (i.e. message.generatedMedia has at
 * least one item) or when streaming ends.
 */
function GeneratingImagePlaceholder({ message }: Props) {
  const { isSubmitting = false, isLatestMessage = false } = useMessageContext();
  let toggleOn = false;
  try {
    const ctx = useBadgeRowContext();
    toggleOn = Boolean(ctx?.imageGeneration?.toggleState);
  } catch {
    // BadgeRowContext only exists inside the chat input scope; if a message
    // renders outside that context (shared links etc.), there's no toggle.
  }

  const alreadyHasMedia = (message?.generatedMedia?.length ?? 0) > 0;
  const isAssistant = message?.isCreatedByUser === false;
  // On a mid-generation refresh the input toggle isn't a reliable signal (it may
  // not be restored for the reloaded conversation), so also honor the server's
  // per-message image-generation flag carried in the resume snapshot.
  const isImageGenerationTurn = toggleOn || message?.imageGeneration === true;

  if (!isImageGenerationTurn || !isSubmitting || !isLatestMessage || alreadyHasMedia || !isAssistant) {
    return null;
  }

  return (
    <div
      className="relative mt-2 aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border border-border-light bg-surface-secondary text-text-secondary"
      role="status"
      aria-live="polite"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
        aria-hidden="true"
      />
      <span className="absolute left-3 top-3 inline-flex items-center gap-2 text-sm font-medium">
        <ImageIcon className="h-4 w-4 animate-pulse" aria-hidden="true" />
        <span className="animate-pulse">Generating image…</span>
      </span>
    </div>
  );
}

export default memo(GeneratingImagePlaceholder);
