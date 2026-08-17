import { memo } from 'react';
import { Loader2 } from 'lucide-react';
import type { TMessage } from 'librechat-data-provider';
import { useMessageContext } from '~/Providers';

type Props = {
  message?: TMessage;
};

/**
 * A transient status line shown under the assistant bubble while it does tool
 * work that produces no discrete media (unlike image generation, which has its
 * own placeholder). The backend emits a `tool_status` SSE event; useResumableSSE
 * stores it on the message as `toolStatus`. It disappears the moment reply text
 * starts streaming (the caller only renders this while there is no regular
 * content yet) or a `done` arrives.
 *
 * The label is a generic "Working…" — the backend deliberately does not
 * classify which tool fired (that would be keyword/regex guessing based on
 * tool names), so this component doesn't pick an icon from the label text
 * either.
 */
function ToolStatusIndicator({ message }: Props) {
  const { isSubmitting = false, isLatestMessage = false } = useMessageContext();
  const status = (message as unknown as { toolStatus?: { label?: string } } | undefined)
    ?.toolStatus;
  const label = status?.label ?? '';
  const isAssistant = message?.isCreatedByUser === false;

  if (!label || !isSubmitting || !isLatestMessage || !isAssistant) {
    return null;
  }

  return (
    <div
      className="mt-2 inline-flex items-center gap-2 rounded-full border border-border-light bg-surface-secondary px-3 py-1.5 text-sm text-text-secondary"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-pulse" aria-hidden="true" />
      <span className="animate-pulse">{label}</span>
    </div>
  );
}

export default memo(ToolStatusIndicator);
