import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark } from 'lucide-react';
import { useLocalize } from '~/hooks';

type SavedResponseToastProps = {
  /** Folder the response landed in — already resolved to a display name. */
  folderName: string;
  /** Opens the surface listing saved responses. */
  onView: () => void;
  /** Omitted when there is nothing to undo (an edit of an existing bookmark). */
  onUndo?: () => void;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. */
  duration?: number;
};

/**
 * Figma C3 — 430x52, r12, fill surface-hover, 1px border-heavy, pad 10/10/10/14, gap 10.
 * The shared `showToast` only renders a message string, so a dedicated component is the
 * only way to express the View and Undo actions this toast is built around.
 *
 * Per Figma, View carries the filled style and Undo is the quieter of the two.
 */
const SavedResponseToast = ({
  folderName,
  onView,
  onUndo,
  onDismiss,
  duration = 6000,
}: SavedResponseToastProps) => {
  const localize = useLocalize();

  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-[200] flex w-[430px] max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-xl border border-border-heavy bg-surface-hover py-2.5 pl-3.5 pr-2.5 shadow-lg"
    >
      <Bookmark size={16} className="shrink-0 fill-current text-text-primary" />
      <span className="truncate text-[13px] leading-[19.5px] text-text-primary">
        {localize('com_ui_saved_to_folder', { folder: folderName })}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onView}
        className="flex h-8 shrink-0 items-center rounded-lg bg-surface-chat px-3 text-xs font-medium text-text-primary transition-colors hover:bg-surface-hover-alt"
      >
        {localize('com_ui_view')}
      </button>
      {onUndo != null && (
        <button
          type="button"
          onClick={onUndo}
          className="flex h-8 shrink-0 items-center rounded-lg px-3 text-xs font-medium text-text-secondary-alt transition-colors hover:text-text-primary"
        >
          {localize('com_ui_undo')}
        </button>
      )}
    </div>,
    document.body,
  );
};

export default memo(SavedResponseToast);
