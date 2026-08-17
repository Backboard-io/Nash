import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { TooltipAnchor, useToastContext } from '@librechat/client';
import type { TSavedMessage } from 'librechat-data-provider';
import { useUnsaveMessageMutation } from '~/data-provider';
import { formatModelName } from '~/utils';
import { useLocalize } from '~/hooks';

/**
 * A bookmarked assistant reply.
 *
 * Mirrors BookmarkCard's shape so the two kinds sit in one grid without looking
 * like different products: preview panel, title, caption, right-aligned actions.
 * Here the preview is the response snapshot, the title is the conversation it
 * came from, and the caption carries the model and when it was saved.
 */
export default function SavedResponseCard({ saved }: { saved: TSavedMessage }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const [removing, setRemoving] = useState(false);

  const unsave = useUnsaveMessageMutation({
    onError: () => {
      setRemoving(false);
      showToast({ message: localize('com_ui_bookmark_save_error'), status: 'error' });
    },
  });

  let savedAgo = '';
  try {
    if (saved.createdAt) {
      savedAgo = formatDistanceToNow(new Date(saved.createdAt), { addSuffix: true });
    }
  } catch {
    savedAgo = '';
  }

  const openSource = () => {
    if (saved.conversationId) {
      navigate(`/c/${saved.conversationId}`);
    }
  };

  return (
    <div className="group flex h-full flex-col gap-3 rounded-2xl border border-border-light bg-surface-primary p-3 transition-colors hover:border-border-medium">
      <button
        type="button"
        onClick={openSource}
        title={saved.title || localize('com_ui_untitled')}
        className="flex flex-1 cursor-pointer flex-col gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="rounded-xl bg-surface-secondary p-4 transition-colors group-hover:bg-surface-tertiary">
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">
            {saved.text}
          </p>
        </div>
        {saved.note ? (
          <p className="line-clamp-2 break-words text-xs italic text-text-secondary-alt">
            {saved.note}
          </p>
        ) : null}
        <h3 className="line-clamp-2 break-words text-sm font-semibold text-text-primary">
          {saved.title || localize('com_ui_untitled')}
        </h3>
      </button>

      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        {saved.model ? (
          <span className="shrink-0 font-medium text-brand-purple">{formatModelName(saved.model)}</span>
        ) : null}
        {saved.model && savedAgo ? (
          <span aria-hidden="true" className="text-text-secondary">
            ·
          </span>
        ) : null}
        {savedAgo ? (
          <span className="shrink-0 text-text-secondary">
            {localize('com_ui_bookmark_saved_ago', { time: savedAgo })}
          </span>
        ) : null}
      </div>

      <div className="flex justify-end">
        <TooltipAnchor
          description={localize('com_ui_delete')}
          render={
            <button
              type="button"
              disabled={removing}
              onClick={() => {
                setRemoving(true);
                unsave.mutate(saved.messageId);
              }}
              aria-label={localize('com_ui_delete')}
              className="flex size-8 items-center justify-center rounded-lg text-text-secondary-alt transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          }
        />
      </div>
    </div>
  );
}
