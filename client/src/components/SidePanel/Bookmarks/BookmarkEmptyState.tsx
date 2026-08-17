import { Bookmark, Layers, Search, TriangleAlert } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import EmptyState from '~/components/ui/EmptyState';
import { primaryAction, secondaryAction } from '~/components/ui/actionButton';

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
    <EmptyState
      tone={isError ? 'error' : 'neutral'}
      icon={<Icon size={24} aria-hidden="true" />}
      title={title}
      description={description}
      action={
        variant === 'empty' && onGoToChats ? (
          <button
            type="button"
            onClick={onGoToChats}
            className={cn(primaryAction, 'h-[40px] px-[18px] text-[13.5px]')}
          >
            {localize('com_ui_go_to_chats')}
          </button>
        ) : isError && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={cn(secondaryAction, 'h-[40px] px-[18px] text-[13.5px]')}
          >
            {localize('com_ui_retry')}
          </button>
        ) : undefined
      }
    />
  );
}
