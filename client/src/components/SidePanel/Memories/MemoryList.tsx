import type { TUserMemory } from 'librechat-data-provider';
import MemoryEmptyState, { type MemoryEmptyVariant } from './MemoryEmptyState';
import MemoryCard from './MemoryCard';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MemoryListProps {
  memories: TUserMemory[];
  hasUpdateAccess: boolean;
  isLoading?: boolean;
  isError?: boolean;
  emptyVariant?: MemoryEmptyVariant;
  onRetry?: () => void;
  onAddMemory?: () => void;
}

const skeletonOpacity = ['opacity-100', 'opacity-70', 'opacity-45'];

function MemoryCardSkeleton({ index }: { index: number }) {
  return (
    <div
      className={cn(
        'flex h-[88px] animate-pulse flex-col gap-[10px] rounded-[12px] border border-border-light bg-surface-secondary pb-4 pl-[18px] pr-4 pt-4 dark:border-[#2E3036]',
        skeletonOpacity[index % skeletonOpacity.length],
      )}
    >
      <div className="flex items-center gap-[10px]">
        <div className="h-[10px] w-[72px] rounded-[5px] bg-[#ECEDEF] dark:bg-[#181A1E]" />
        <div className="h-[10px] w-[96px] rounded-[5px] bg-[#ECEDEF] dark:bg-[#181A1E]" />
        <div className="h-[10px] w-[52px] rounded-[5px] bg-[#ECEDEF] dark:bg-[#181A1E]" />
      </div>
      <div className="h-[13px] w-[92%] rounded-[5px] bg-[#ECEDEF] dark:bg-[#181A1E]" />
      <div className="h-[13px] w-[60%] rounded-[5px] bg-[#ECEDEF] dark:bg-[#181A1E]" />
    </div>
  );
}

export default function MemoryList({
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

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={localize('com_ui_memories')}>
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
    <div className="space-y-3" role="list" aria-label={localize('com_ui_memories')}>
      {memories.map((memory) => (
        <div key={memory.key} role="listitem">
          <MemoryCard memory={memory} hasUpdateAccess={hasUpdateAccess} />
        </div>
      ))}
    </div>
  );
}
