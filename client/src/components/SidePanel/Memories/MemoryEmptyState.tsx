import { Plus, Search, Layers } from 'lucide-react';
import { DbIcon, CloudOffIcon, RefreshIcon } from '~/components/svg/NashMemoriesIcons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type MemoryEmptyVariant = 'empty' | 'no-results' | 'scope-empty' | 'error';

interface MemoryEmptyStateProps {
  variant?: MemoryEmptyVariant;
  onAddMemory?: () => void;
  onRetry?: () => void;
}

export default function MemoryEmptyState({
  variant = 'empty',
  onAddMemory,
  onRetry,
}: MemoryEmptyStateProps) {
  const localize = useLocalize();
  const isError = variant === 'error';

  const title = isError
    ? localize('com_ui_memories_load_failed_title')
    : variant === 'no-results'
      ? localize('com_ui_no_memories_found')
      : variant === 'scope-empty'
        ? localize('com_ui_no_memories_scope')
        : localize('com_ui_no_memories_title');

  const description = isError
    ? localize('com_ui_memories_load_failed_desc')
    : variant === 'no-results'
      ? localize('com_ui_no_memories_found_desc')
      : variant === 'scope-empty'
        ? localize('com_ui_no_memories_scope_desc')
        : localize('com_ui_no_memories_desc');

  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 py-[54px] text-center">
      <div
        className={cn(
          'flex size-14 items-center justify-center rounded-full',
          isError ? 'bg-[#FDE8EF] dark:bg-[#2D1520]' : 'bg-[#ECEDEF] dark:bg-[#181A1E]',
        )}
      >
        {isError ? (
          <CloudOffIcon size={24} className="text-text-destructive" />
        ) : variant === 'no-results' ? (
          <Search size={24} className="text-text-secondary-alt" aria-hidden="true" />
        ) : variant === 'scope-empty' ? (
          <Layers size={24} className="text-text-secondary-alt" aria-hidden="true" />
        ) : (
          <DbIcon size={24} className="text-text-secondary-alt" />
        )}
      </div>
      <p className="text-[16px] font-medium leading-[24px] text-text-primary">{title}</p>
      <p className="max-w-[450px] text-[13px] leading-[19.5px] text-text-secondary-alt">
        {description}
      </p>
      {variant === 'empty' && onAddMemory && (
        <button
          type="button"
          onClick={onAddMemory}
          className="inline-flex h-[38px] items-center gap-2 rounded-[10px] bg-brand-purple pl-[15px] pr-[18px] text-[13.5px] font-medium leading-[20.25px] text-white transition-colors hover:bg-brand-purple-hover active:bg-brand-purple-pressed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus size={15} aria-hidden="true" />
          {localize('com_ui_add_memory')}
        </button>
      )}
      {isError && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-[38px] items-center gap-2 rounded-[10px] border border-border-light bg-[#ECEDEF] pl-[15px] pr-[18px] text-[13.5px] font-medium leading-[20.25px] text-text-primary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-[#181A1E]"
        >
          <RefreshIcon size={15} className="text-text-secondary" />
          {localize('com_ui_try_again')}
        </button>
      )}
    </div>
  );
}
