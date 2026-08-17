import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { matchSorter } from 'match-sorter';
import { TooltipAnchor, Button, NewChatIcon, Dropdown, useMediaQuery } from '@librechat/client';
import { PermissionTypes, Permissions, QueryKeys } from 'librechat-data-provider';
import type { TConversationTag, TSavedMessage } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { useConversationTagsQuery, useSavedMessagesQuery } from '~/data-provider';
import { useDocumentTitle, useHasAccess, useLocalize } from '~/hooks';
import { SidePanelProvider, useChatContext } from '~/Providers';
import { BookmarkContext } from '~/Providers/BookmarkContext';
import { SidePanelGroup } from '~/components/SidePanel';
import { OpenSidebar } from '~/components/Chat/Menus';
import BookmarkFilterTabs, { type BookmarkCategory } from './BookmarkFilterTabs';
import { type BookmarkEmptyVariant } from './BookmarkEmptyState';
import { clearMessagesCache } from '~/utils';
import BookmarkList from './BookmarkList';

const pageSize = 12;

/**
 * Full-page Bookmarks experience (Figma teal redesign, frames 30/55-58).
 *
 * Mirrors the persona Marketplace shell (SidePanelProvider > SidePanelGroup >
 * main) but is wired to conversation-tag bookmarks. Per the "real fields only"
 * mandate it renders only fields that exist on TConversationTag (tag, count,
 * description, createdAt) — no fabricated content-type / TL;DR / source. The
 * content-type filter tabs surface the honest category-empty state since
 * conversation tags carry no content-type classification.
 */
export default function BookmarksView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { conversation, newConversation } = useChatContext();

  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();

  const { data, isLoading, isError, refetch } = useConversationTagsQuery();
  // Bookmarked assistant replies. Until this was wired the page listed only
  // conversation tags, so a saved response was stored and shown nowhere — and
  // the "Responses" tab below rendered a permanent empty state.
  const { data: savedData, isLoading: savedLoading } = useSavedMessagesQuery();

  const [pageIndex, setPageIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<string>('recent');
  const [activeCategory, setActiveCategory] = useState<BookmarkCategory>('all');

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useDocumentTitle(`${localize('com_ui_bookmarks')} | Nash`);

  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    if (!hasAccessToBookmarks) {
      timeoutId = setTimeout(() => navigate('/c/new'), 1000);
    }
    return () => clearTimeout(timeoutId);
  }, [hasAccessToBookmarks, navigate]);

  const bookmarks: TConversationTag[] = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    // Dedup by tag name: it is the per-user unique key (DynamoDB sk = TAG#{tag}).
    // The Flask /api/tags payload carries no `_id`, so keying on `_id` here would
    // collapse the whole list to a single row.
    const seen = new Set<string>();
    return list.filter((bookmark) => {
      if (seen.has(bookmark.tag)) {
        return false;
      }
      seen.add(bookmark.tag);
      return true;
    });
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

  const sortedBookmarks = useMemo(() => {
    const copy = [...filteredBookmarks];
    switch (sortBy) {
      case 'name':
        return copy.sort((a, b) => a.tag.localeCompare(b.tag));
      case 'used':
        return copy.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
      case 'recent':
      default:
        return copy.sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });
    }
  }, [filteredBookmarks, sortBy]);

  const savedResponses: TSavedMessage[] = useMemo(() => {
    const list = Array.isArray(savedData) ? savedData : [];
    if (!searchQuery) {
      return list;
    }
    return matchSorter(list, searchQuery, {
      keys: ['text', 'note', 'title', 'model'],
      threshold: matchSorter.rankings.CONTAINS,
    });
  }, [savedData, searchQuery]);

  // "All" shows both kinds; "Responses" shows saved replies only. The remaining
  // content-type categories still surface the honest empty state, because
  // conversation tags carry no content-type classification.
  const visibleBookmarks = useMemo(
    () => (activeCategory === 'all' ? sortedBookmarks : ([] as TConversationTag[])),
    [sortedBookmarks, activeCategory],
  );
  const visibleResponses = useMemo(
    () =>
      activeCategory === 'all' || activeCategory === 'responses'
        ? savedResponses
        : ([] as TSavedMessage[]),
    [savedResponses, activeCategory],
  );

  const totalPages = Math.max(
    1,
    Math.ceil((visibleBookmarks.length + visibleResponses.length) / pageSize),
  );
  // Responses lead the grid, so paginate across the two lists as one sequence.
  const currentResponses = useMemo(
    () => visibleResponses.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    [visibleResponses, pageIndex],
  );
  const currentRows = useMemo(() => {
    const start = Math.max(0, pageIndex * pageSize - visibleResponses.length);
    const room = pageSize - currentResponses.length;
    return room > 0 ? visibleBookmarks.slice(start, start + room) : [];
  }, [visibleBookmarks, visibleResponses.length, currentResponses.length, pageIndex]);

  useEffect(() => {
    setPageIndex(0);
  }, [searchQuery, activeCategory, sortBy]);

  useEffect(() => {
    if (pageIndex > totalPages - 1) {
      setPageIndex(totalPages - 1);
    }
  }, [pageIndex, totalPages]);

  const sortOptions = useMemo(
    () => [
      { value: 'recent', label: localize('com_ui_bookmarks_sort_recent') },
      { value: 'name', label: localize('com_ui_bookmarks_sort_name') },
      { value: 'used', label: localize('com_ui_bookmarks_sort_used') },
    ],
    [localize],
  );

  const emptyVariant: BookmarkEmptyVariant =
    searchQuery.length > 0 ? 'no-results' : activeCategory !== 'all' ? 'category-empty' : 'empty';

  const goToChats = () => navigate('/c/new');

  const handleNewChat = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      window.open('/c/new', '_blank');
      return;
    }
    clearMessagesCache(queryClient, conversation?.conversationId);
    queryClient.invalidateQueries([QueryKeys.messages]);
    newConversation();
  };

  if (!hasAccessToBookmarks) {
    return null;
  }

  return (
    <BookmarkContext.Provider value={{ bookmarks }}>
      <div className="relative flex w-full grow overflow-hidden bg-presentation">
        <SidePanelProvider>
          <SidePanelGroup>
            <main className="flex h-full flex-col overflow-hidden" role="main">
              <div
                ref={scrollContainerRef}
                className="scrollbar-gutter-stable relative flex h-full flex-col overflow-y-auto overflow-x-hidden"
              >
                {/* Top nav controls (only when the left sidebar is hidden) */}
                {!isSmallScreen && (
                  <div className="sticky top-0 z-20 flex items-center justify-between bg-presentation p-2 md:h-14">
                    <div className="mx-1 flex items-center gap-2">
                      {!navVisible ? (
                        <>
                          <OpenSidebar setNavVisible={setNavVisible} />
                          <TooltipAnchor
                            description={localize('com_ui_new_chat')}
                            render={
                              <Button
                                size="icon"
                                variant="outline"
                                data-testid="bookmarks-new-chat-button"
                                aria-label={localize('com_ui_new_chat')}
                                className="rounded-xl border border-border-light bg-surface-secondary p-2 hover:bg-surface-active-alt max-md:hidden"
                                onClick={handleNewChat}
                              >
                                <NewChatIcon />
                              </Button>
                            }
                          />
                        </>
                      ) : (
                        <div className="h-10 w-10" />
                      )}
                    </div>
                  </div>
                )}

                <div className="mx-auto w-full max-w-6xl px-6 pb-16">
                  {/* Header: title + subtitle + saved-count badge */}
                  <header className="flex flex-col gap-4 pb-2 pt-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h1 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">
                        {localize('com_ui_bookmarks')}
                      </h1>
                      <p className="mt-2 max-w-2xl text-base text-text-secondary">
                        {localize('com_ui_bookmarks_subtitle')}
                      </p>
                    </div>
                    <span className="shrink-0 self-start rounded-lg bg-surface-secondary px-3 py-1.5 text-sm font-medium text-text-secondary">
                      {localize('com_ui_bookmarks_saved_count', {
                        count: bookmarks.length + savedResponses.length,
                      })}
                    </span>
                  </header>

                  {/* Search + sort */}
                  <div className="flex items-center gap-3 py-6">
                    <div className="relative grow">
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
                        className="h-11 w-full rounded-xl bg-surface-secondary pl-10 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <Dropdown
                      value={sortBy}
                      onChange={setSortBy}
                      options={sortOptions}
                      sizeClasses="min-w-[10rem]"
                      className="flex-shrink-0"
                      testId="bookmarks-sort-dropdown"
                      ariaLabel={localize('com_ui_bookmarks_sort_recent')}
                    />
                  </div>

                  {/* Category filter tabs */}
                  <BookmarkFilterTabs active={activeCategory} onChange={setActiveCategory} />

                  {/* Grid */}
                  <div className="pt-6">
                    <BookmarkList
                      bookmarks={currentRows}
                      savedResponses={currentResponses}
                      isLoading={isLoading || savedLoading}
                      isError={isError}
                      emptyVariant={emptyVariant}
                      onRetry={() => refetch()}
                      onGoToChats={goToChats}
                    />
                  </div>

                  {/* Pagination */}
                  {visibleBookmarks.length + visibleResponses.length > pageSize && (
                    <div
                      className="mt-6 flex items-center gap-2"
                      role="navigation"
                      aria-label="Pagination"
                    >
                      <button
                        type="button"
                        onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                        disabled={pageIndex === 0}
                        aria-label={localize('com_ui_prev')}
                        className="rounded-lg bg-surface-secondary px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-surface-secondary"
                      >
                        {localize('com_ui_prev')}
                      </button>
                      <div
                        className="whitespace-nowrap text-sm text-text-secondary"
                        aria-live="polite"
                      >
                        {pageIndex + 1} / {totalPages}
                      </div>
                      <button
                        type="button"
                        onClick={() => setPageIndex((prev) => (prev + 1 < totalPages ? prev + 1 : prev))}
                        disabled={pageIndex + 1 >= totalPages}
                        aria-label={localize('com_ui_next')}
                        className="rounded-lg bg-surface-secondary px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-surface-secondary"
                      >
                        {localize('com_ui_next')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </main>
          </SidePanelGroup>
        </SidePanelProvider>
      </div>
    </BookmarkContext.Provider>
  );
}
