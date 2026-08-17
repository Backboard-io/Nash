import type { TConversationTag, TSavedMessage } from 'librechat-data-provider';
import BookmarkEmptyState, { type BookmarkEmptyVariant } from './BookmarkEmptyState';
import BookmarkCard from './BookmarkCard';
import SavedResponseCard from './SavedResponseCard';
import { useLocalize } from '~/hooks';

interface BookmarkListProps {
  bookmarks: TConversationTag[];
  /** Bookmarked assistant replies, rendered in the same grid as the tag cards. */
  savedResponses?: TSavedMessage[];
  isLoading?: boolean;
  isError?: boolean;
  emptyVariant?: BookmarkEmptyVariant;
  onRetry?: () => void;
  onGoToChats?: () => void;
}

const gridClass = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

function BookmarkCardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-border-light bg-surface-primary p-3">
      {/* content-preview placeholder */}
      <div className="rounded-xl bg-surface-secondary p-4">
        <div className="h-3 w-3/4 animate-pulse rounded bg-surface-tertiary" />
      </div>
      {/* title placeholder */}
      <div className="h-3 w-1/2 animate-pulse rounded bg-surface-tertiary" />
      {/* caption placeholder */}
      <div className="h-2.5 w-1/3 animate-pulse rounded bg-surface-tertiary" />
    </div>
  );
}

export default function BookmarkList({
  bookmarks,
  savedResponses = [],
  isLoading = false,
  isError = false,
  emptyVariant = 'empty',
  onRetry,
  onGoToChats,
}: BookmarkListProps) {
  const localize = useLocalize();

  if (isError) {
    return <BookmarkEmptyState variant="error" onRetry={onRetry} />;
  }

  if (isLoading) {
    return (
      <div className={gridClass} aria-busy="true" aria-label={localize('com_ui_bookmarks')}>
        {Array.from({ length: 3 }).map((_, index) => (
          <BookmarkCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (bookmarks.length === 0 && savedResponses.length === 0) {
    return <BookmarkEmptyState variant={emptyVariant} onGoToChats={onGoToChats} />;
  }

  return (
    <div className={gridClass} role="list" aria-label={localize('com_ui_bookmarks')}>
      {savedResponses.map((saved) => (
        <div key={`saved-${saved.messageId}`} role="listitem">
          <SavedResponseCard saved={saved} />
        </div>
      ))}
      {bookmarks.map((bookmark, index) => (
        <div key={bookmark._id ?? bookmark.tag ?? `bm-${index}`} role="listitem">
          <BookmarkCard bookmark={bookmark} />
        </div>
      ))}
    </div>
  );
}
