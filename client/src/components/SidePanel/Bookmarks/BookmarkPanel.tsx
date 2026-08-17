import { useMemo, useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { matchSorter } from 'match-sorter';
import type { TConversationTag } from 'librechat-data-provider';
import { useConversationTagsQuery } from '~/data-provider';
import { BookmarkContext } from '~/Providers/BookmarkContext';
import BookmarkFilterTabs, { type BookmarkCategory } from './BookmarkFilterTabs';
import { type BookmarkEmptyVariant } from './BookmarkEmptyState';
import BookmarkList from './BookmarkList';
import { useLocalize } from '~/hooks';

const pageSize = 10;

export default function BookmarkPanel() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useConversationTagsQuery();

  const [pageIndex, setPageIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<BookmarkCategory>('all');

  const bookmarks: TConversationTag[] = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    const seen = new Set<string>();
    return list
      .filter((bookmark) => {
        const key = bookmark.tag;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.position - b.position);
  }, [data]);

  const filteredBookmarks = useMemo(() => {
    if (!searchQuery) {
      return bookmarks;
    }
    return matchSorter(bookmarks, searchQuery, {
      keys: ['tag', 'description'],
      threshold: matchSorter.rankings.CONTAINS,
    });
  }, [bookmarks, searchQuery]);

  // Conversation-tag bookmarks carry no content-type classification, so only "All"
  // returns rows today. The content-type categories surface the category-empty state
  // instead of fabricated rows (same honest pattern as the memory scope tabs).
  const visibleBookmarks = useMemo(
    () => (activeCategory === 'all' ? filteredBookmarks : ([] as TConversationTag[])),
    [filteredBookmarks, activeCategory],
  );

  const totalPages = Math.max(1, Math.ceil(visibleBookmarks.length / pageSize));

  const currentRows = useMemo(
    () => visibleBookmarks.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    [visibleBookmarks, pageIndex],
  );

  useEffect(() => {
    setPageIndex(0);
  }, [searchQuery, activeCategory]);

  useEffect(() => {
    if (pageIndex > totalPages - 1) {
      setPageIndex(totalPages - 1);
    }
  }, [pageIndex, totalPages]);

  const emptyVariant: BookmarkEmptyVariant =
    searchQuery.length > 0 ? 'no-results' : activeCategory !== 'all' ? 'category-empty' : 'empty';

  const goToChats = () => navigate('/c/new');

  return (
    <BookmarkContext.Provider value={{ bookmarks }}>
      <div className="flex h-full w-full flex-col">
        <div role="region" aria-label={localize('com_ui_bookmarks')} className="mt-2 space-y-4">
          {/* Header: Title + Subtitle + saved-count badge */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-text-primary">
                {localize('com_ui_bookmarks')}
              </h2>
              <p className="mt-0.5 text-sm text-text-secondary">
                {localize('com_ui_bookmarks_subtitle')}
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-surface-secondary px-2 py-1 text-xs font-medium text-text-secondary">
              {localize('com_ui_bookmarks_saved_count', { count: bookmarks.length })}
            </span>
          </div>

          {/* Search */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={localize('com_ui_search_bookmarks')}
              aria-label={localize('com_ui_search_bookmarks')}
              className="h-10 w-full rounded-lg bg-surface-secondary pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Category filter tabs */}
          <BookmarkFilterTabs active={activeCategory} onChange={setActiveCategory} />

          {/* List */}
          <BookmarkList
            bookmarks={currentRows}
            isLoading={isLoading}
            isError={isError}
            emptyVariant={emptyVariant}
            onRetry={() => refetch()}
            onGoToChats={goToChats}
          />

          {/* Pagination */}
          {visibleBookmarks.length > pageSize && (
            <div className="flex items-center gap-2" role="navigation" aria-label="Pagination">
              <button
                type="button"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
                aria-label={localize('com_ui_prev')}
                className="rounded-lg bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-surface-tertiary"
              >
                {localize('com_ui_prev')}
              </button>
              <div className="whitespace-nowrap text-sm text-text-secondary" aria-live="polite">
                {pageIndex + 1} / {totalPages}
              </div>
              <button
                type="button"
                onClick={() => setPageIndex((prev) => (prev + 1 < totalPages ? prev + 1 : prev))}
                disabled={pageIndex + 1 >= totalPages}
                aria-label={localize('com_ui_next')}
                className="rounded-lg bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-surface-tertiary"
              >
                {localize('com_ui_next')}
              </button>
            </div>
          )}
        </div>
      </div>
    </BookmarkContext.Provider>
  );
}
