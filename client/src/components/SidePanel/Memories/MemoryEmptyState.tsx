import { Plus, Search, Layers } from 'lucide-react';
import { DbIcon, CloudOffIcon, RefreshIcon } from '~/components/svg/NashMemoriesIcons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import EmptyState from '~/components/ui/EmptyState';
import { primaryAction, secondaryAction } from '~/components/ui/actionButton';

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
    <EmptyState
      tone={isError ? 'error' : 'neutral'}
      icon={
        isError ? (
          <CloudOffIcon size={24} />
        ) : variant === 'no-results' ? (
          <Search size={24} aria-hidden="true" />
        ) : variant === 'scope-empty' ? (
          <Layers size={24} aria-hidden="true" />
        ) : (
          <DbIcon size={24} />
        )
      }
      title={title}
      description={description}
      action={
        variant === 'empty' && onAddMemory ? (
          <button type="button" onClick={onAddMemory} className={cn(primaryAction, 'h-[40px] px-[18px] text-[13.5px]')}>
            <Plus size={15} aria-hidden="true" />
            {localize('com_ui_add_memory')}
          </button>
        ) : isError && onRetry ? (
          <button type="button" onClick={onRetry} className={cn(secondaryAction, 'h-[40px] px-[18px] text-[13.5px]')}>
            <RefreshIcon size={15} className="text-text-secondary" />
            {localize('com_ui_try_again')}
          </button>
        ) : undefined
      }
    />
  );
}
