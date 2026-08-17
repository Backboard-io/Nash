import type { ScopedMemory } from './types';
import { bookmarkListClass, type BookmarkView } from '~/components/SidePanel/Bookmarks/BookmarkControls';
import MemoryEmptyState, { type MemoryEmptyVariant } from './MemoryEmptyState';
import MemoryCard from './MemoryCard';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MemoryListProps {
  memories: ScopedMemory[];
  hasUpdateAccess: boolean;
  isLoading?: boolean;
  isError?: boolean;
  emptyVariant?: MemoryEmptyVariant;
  onRetry?: () => void;
  onAddMemory?: () => void;
  /** Same two layouts Bookmarks offers, from the same helper — one definition
   *  of what a grid is, so the two pages cannot drift apart. */
  view?: BookmarkView;
}

const skeletonOpacity = ['opacity-100', 'opacity-70', 'opacity-45'];

function MemoryCardSkeleton({ index }: { index: number }) {
  return (
    <div
      className={cn(
        /* The card's own geometry, so nothing jumps when the rows arrive —
           radius 13, padding 16, no border, and tokens rather than hexes. */
        'flex h-[88px] animate-pulse flex-col gap-[10px] nash-card rounded-[13px] p-4',
        skeletonOpacity[index % skeletonOpacity.length],
      )}
    >
      <div className="flex items-center gap-[10px]">
        <div className="h-[10px] w-[72px] rounded-[5px] bg-surface-active" />
        <div className="h-[10px] w-[96px] rounded-[5px] bg-surface-active" />
        <div className="h-[10px] w-[52px] rounded-[5px] bg-surface-active" />
      </div>
      <div className="h-[13px] w-[92%] rounded-[5px] bg-surface-active" />
      <div className="h-[13px] w-[60%] rounded-[5px] bg-surface-active" />
    </div>
  );
}

export default function MemoryList({
  view = 'list',
  memories,
  hasUpdateAccess,
  isLoading = false,
  isError = false,
  emptyVariant = 'empty',
  onRetry,
  onAddMemory,
}: MemoryListProps) {
  const localize = useLocalize();

  if (isError && memories.length === 0) {
    return <MemoryEmptyState variant="error" onRetry={onRetry} />;
  }

  const listClass = bookmarkListClass(view);

  if (isLoading) {
    return (
      <div className={listClass} aria-busy="true" aria-label={localize('com_ui_memories')}>
        {Array.from({ length: 3 }).map((_, index) => (
          <MemoryCardSkeleton key={index} index={index} />
        ))}
      </div>
    );
  }

  if (memories.length === 0) {
    return <MemoryEmptyState variant={emptyVariant} onAddMemory={onAddMemory} />;
  }

  return (
    <div className={listClass} role="list" aria-label={localize('com_ui_memories')}>
      {memories.map((memory) => (
        <div key={memory.key} role="listitem">
          <MemoryCard memory={memory} hasUpdateAccess={hasUpdateAccess} view={view} />
        </div>
      ))}
    </div>
  );
}
