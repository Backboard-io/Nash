import { Bookmark, Layers, Search, TriangleAlert } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type BookmarkEmptyVariant = 'empty' | 'no-results' | 'category-empty' | 'error';

interface BookmarkEmptyStateProps {
  variant?: BookmarkEmptyVariant;
  onGoToChats?: () => void;
  onRetry?: () => void;
}

export default function BookmarkEmptyState({
  variant = 'empty',
  onGoToChats,
  onRetry,
}: BookmarkEmptyStateProps) {
  const localize = useLocalize();

  const isError = variant === 'error';
  const Icon = isError
    ? TriangleAlert
    : variant === 'no-results'
      ? Search
      : variant === 'category-empty'
        ? Layers
        : Bookmark;

  const title = isError
    ? localize('com_ui_bookmarks_error')
    : variant === 'no-results'
      ? localize('com_ui_bookmarks_no_results')
      : variant === 'category-empty'
        ? localize('com_ui_bookmarks_category_empty')
        : localize('com_ui_no_bookmarks_title');

  const description = isError
    ? localize('com_ui_bookmarks_error_desc')
    : variant === 'no-results'
      ? localize('com_ui_bookmarks_no_results_desc')
      : variant === 'category-empty'
        ? localize('com_ui_bookmarks_category_empty_desc')
        : localize('com_ui_bookmarks_empty_desc');

  return (
    <div className="flex w-full flex-col items-center justify-center px-6 py-12 text-center">
      <div
        className={cn(
          'mb-4 flex size-12 items-center justify-center rounded-full',
          isError ? 'bg-rose-500/10' : 'bg-surface-tertiary',
        )}
      >
        <Icon
          className={cn('size-5', isError ? 'text-rose-500' : 'text-text-secondary')}
          aria-hidden="true"
        />
      </div>
      <p
        className={cn(
          'text-base font-semibold',
          isError ? 'text-rose-500 dark:text-rose-400' : 'text-text-primary',
        )}
      >
        {title}
      </p>
      <p className="mt-1 max-w-xs text-sm text-text-secondary">{description}</p>
      {variant === 'empty' && onGoToChats && (
        <button
          type="button"
          onClick={onGoToChats}
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-purple px-4 py-2 text-sm font-medium text-brand-purple-foreground transition-colors hover:bg-brand-purple-hover active:bg-brand-purple-pressed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {localize('com_ui_go_to_chats')}
        </button>
      )}
      {isError && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-surface-tertiary px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {localize('com_ui_retry')}
        </button>
      )}
    </div>
  );
}
