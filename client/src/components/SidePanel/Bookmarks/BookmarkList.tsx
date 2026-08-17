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

/* The shared list/grid class, so the skeleton lays out exactly as the
   rows will. */
const gridClass = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3';

/**
 * BookmarkRow's shell, not an impression of it: radius 13 on --surface at the
 * row's own 15/13 padding. This was radius 16 on --app with a hairline and a
 * nested --surface panel — a different card entirely, so the list rearranged
 * itself the moment the rows arrived.
 */
function BookmarkCardSkeleton() {
  return (
    <div className="flex flex-col gap-[10px] nash-card rounded-[13px] px-[15px] py-[13px]">
      {/* meta line: icon · model · time */}
      <div className="flex h-[17px] items-center gap-[8px]">
        <div className="h-[13px] w-[13px] shrink-0 animate-pulse rounded-[4px] bg-surface-hover" />
        <div className="h-[10px] w-[34%] animate-pulse rounded-[5px] bg-surface-hover" />
        <div className="ml-auto h-[10px] w-[16%] animate-pulse rounded-[5px] bg-surface-hover" />
      </div>
      <div className="h-[11px] w-[92%] animate-pulse rounded-[5px] bg-surface-hover" />
      <div className="h-[11px] w-[64%] animate-pulse rounded-[5px] bg-surface-hover" />
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
