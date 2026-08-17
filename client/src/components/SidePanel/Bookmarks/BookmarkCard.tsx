import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { TConversationTag } from 'librechat-data-provider';
import BookmarkCardActions from './BookmarkCardActions';
import BookmarkConversationsDialog from './BookmarkConversationsDialog';
import EditBookmarkDialog from './EditBookmarkDialog';
import { useLocalize } from '~/hooks';

interface BookmarkCardProps {
  bookmark: TConversationTag;
}

/**
 * Single padded bookmark card (Figma). A clickable content area holds the note
 * as a nested content-preview panel (rendered only when a note exists) above the
 * title, then a "<count> · Saved <time>" caption with the conversation count in
 * teal (the tag's "type"), then the edit/copy/delete/⋯ actions on their own
 * right-aligned row. Clicking the content opens the conversations carrying this
 * bookmark; the ⋯ menu offers the same "view conversations" action explicitly.
 * Editing opens the "Edit Bookmark" modal rather than mutating inline.
 * Real-fields-only: no TL;DR bullets, content-type pill, or source-conversation
 * line (none exist on a tag).
 */
export default function BookmarkCard({ bookmark }: BookmarkCardProps) {
  const localize = useLocalize();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isConvosOpen, setIsConvosOpen] = useState(false);

  let savedAgo = '';
  try {
    if (bookmark.createdAt) {
      savedAgo = formatDistanceToNow(new Date(bookmark.createdAt), { addSuffix: true });
    }
  } catch {
    savedAgo = '';
  }

  return (
    <>
      <div className="group flex h-full flex-col gap-3 rounded-2xl border border-border-light bg-surface-primary p-3 transition-colors hover:border-border-medium">
        {/* Clickable content: the note as a nested preview panel + the title.
            Opens the conversations carrying this bookmark. */}
        <button
          type="button"
          onClick={() => setIsConvosOpen(true)}
          title={bookmark.tag}
          className="flex flex-1 cursor-pointer flex-col gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {bookmark.description ? (
            <div className="nash-card rounded-xl p-4 transition-colors group-hover:bg-surface-tertiary">
              <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">
                {bookmark.description}
              </p>
            </div>
          ) : null}
          <h3 className="line-clamp-2 break-words text-sm font-semibold text-text-primary">
            {bookmark.tag}
          </h3>
        </button>

        {/* Caption: count (the tag's "type", in teal) · saved time */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <span className="shrink-0 font-medium text-brand-purple">
            {bookmark.count}{' '}
            {localize(bookmark.count === 1 ? 'com_ui_conversation' : 'com_ui_conversations')}
          </span>
          {savedAgo && (
            <>
              <span aria-hidden="true" className="text-text-secondary">
                ·
              </span>
              <span className="shrink-0 text-text-secondary">
                {localize('com_ui_bookmark_saved_ago', { time: savedAgo })}
              </span>
            </>
          )}
        </div>

        {/* Actions row, right-aligned (Figma places the icons on their own line) */}
        <div className="flex justify-end">
          <BookmarkCardActions
            bookmark={bookmark}
            onEdit={() => setIsEditOpen(true)}
            onView={() => setIsConvosOpen(true)}
          />
        </div>
      </div>

      <EditBookmarkDialog bookmark={bookmark} open={isEditOpen} onOpenChange={setIsEditOpen} />
      <BookmarkConversationsDialog
        tag={bookmark.tag}
        open={isConvosOpen}
        onOpenChange={setIsConvosOpen}
      />
    </>
  );
}
