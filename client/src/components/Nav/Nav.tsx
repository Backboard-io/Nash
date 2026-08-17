import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  memo,
  lazy,
  Suspense,
  useRef,
  startTransition,
} from 'react';
import { Constants } from 'librechat-data-provider';
import { useRecoilValue } from 'recoil';
import { matchSorter } from 'match-sorter';
import { motion } from 'framer-motion';
import { Skeleton, useMediaQuery } from '@librechat/client';
import type { InfiniteQueryObserverResult } from '@tanstack/react-query';
import type { ConversationListResponse } from 'librechat-data-provider';
import type { List } from 'react-virtualized';
import {
  useLocalize,
  useAuthContext,
  useLocalStorage,
  useNavScrolling,
} from '~/hooks';
import {
  useConversationsInfiniteQuery,
  useTitleGeneration,
} from '~/data-provider';
import { Conversations } from '~/components/Conversations';
import FavoritesList from '~/components/Nav/Favorites/FavoritesList';
import { FoldersList } from './Folders';
import { ChatsHeader } from '~/components/Conversations/Conversations';
import NavControlLinks from './NavControlLinks';
import SearchBar from './SearchBar';
import NewChat from './NewChat';
import { cn } from '~/utils';
import store from '~/store';

const AccountSettings = lazy(() => import('./AccountSettings'));

export const NAV_WIDTH = {
  MOBILE: 310,
  DESKTOP: 280,
} as const;

const SearchBarSkeleton = memo(() => (
  <div className={cn('flex h-9 flex-shrink-0 items-center')}>
    <Skeleton className="h-9 w-full rounded-[9px]" />
  </div>
));

SearchBarSkeleton.displayName = 'SearchBarSkeleton';

const NavMask = memo(
  ({ navVisible, toggleNavVisible }: { navVisible: boolean; toggleNavVisible: () => void }) => (
    <div
      id="mobile-nav-mask-toggle"
      role="button"
      tabIndex={0}
      className={`nav-mask transition-opacity duration-200 ease-in-out ${navVisible ? 'active opacity-100' : 'opacity-0'}`}
      onClick={toggleNavVisible}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          toggleNavVisible();
        }
      }}
      aria-label="Toggle navigation"
    />
  ),
);

const MemoNewChat = memo(NewChat);

const Nav = memo(
  ({
    navVisible,
    setNavVisible,
  }: {
    navVisible: boolean;
    setNavVisible: React.Dispatch<React.SetStateAction<boolean>>;
  }) => {
    const localize = useLocalize();
    const { isAuthenticated } = useAuthContext();
    useTitleGeneration(isAuthenticated);

    const isSmallScreen = useMediaQuery('(max-width: 768px)');
    const [newUser, setNewUser] = useLocalStorage('newUser', true);
    // Persisted per user (designer's rule card recommends collapse state
    // surviving reload).
    const [isChatsExpanded, setIsChatsExpandedState] = useState<boolean>(() => {
      try {
        return localStorage.getItem('nashChatsExpanded') !== 'false';
      } catch {
        return true;
      }
    });
    const setIsChatsExpanded = useCallback((next: boolean) => {
      setIsChatsExpandedState(next);
      try {
        localStorage.setItem('nashChatsExpanded', String(next));
      } catch {
        /* storage unavailable — session-only state is fine */
      }
    }, []);
    const [showLoading, setShowLoading] = useState(false);

    const search = useRecoilValue(store.search);
    const activeFolderId = useRecoilValue(store.activeFolderId);

    const { data, fetchNextPage, isFetchingNextPage, isLoading, isFetching } =
      useConversationsInfiniteQuery(
        {
          folderId: 'none',
        },
        {
          enabled: isAuthenticated,
          staleTime: 30000,
          cacheTime: 300000,
        },
      );

    const computedHasNextPage = useMemo(() => {
      if (data?.pages && data.pages.length > 0) {
        const lastPage: ConversationListResponse = data.pages[data.pages.length - 1];
        return lastPage.nextCursor !== null;
      }
      return false;
    }, [data?.pages]);

    const outerContainerRef = useRef<HTMLDivElement>(null);
    const conversationsRef = useRef<List | null>(null);

    const { moveToTop } = useNavScrolling<ConversationListResponse>({
      setShowLoading,
      fetchNextPage: async (options?) => {
        if (computedHasNextPage) {
          return fetchNextPage(options);
        }
        return Promise.resolve(
          {} as InfiniteQueryObserverResult<ConversationListResponse, unknown>,
        );
      },
      isFetchingNext: isFetchingNextPage,
    });

    const conversations = useMemo(() => {
      return data ? data.pages.flatMap((page) => page.conversations) : [];
    }, [data]);

    const filteredConversations = useMemo(() => {
      if (!search.debouncedQuery) {
        return conversations;
      }
      return matchSorter(conversations, search.debouncedQuery, {
        keys: ['title'],
        threshold: matchSorter.rankings.CONTAINS,
      });
    }, [conversations, search.debouncedQuery]);

    const toggleNavVisible = useCallback(() => {
      // Use startTransition to mark this as a non-urgent update
      // This prevents blocking the main thread during the cascade of re-renders
      startTransition(() => {
        setNavVisible((prev: boolean) => {
          localStorage.setItem('navVisible', JSON.stringify(!prev));
          return !prev;
        });
        if (newUser) {
          setNewUser(false);
        }
      });
    }, [newUser, setNavVisible, setNewUser]);

    const closeNav = useCallback(() => {
      startTransition(() => {
        setNavVisible(false);
        localStorage.setItem('navVisible', JSON.stringify(false));
        if (newUser) {
          setNewUser(false);
        }
      });
    }, [newUser, setNavVisible, setNewUser]);

    const itemToggleNav = useCallback(() => {
      if (isSmallScreen) {
        toggleNavVisible();
      }
    }, [isSmallScreen, toggleNavVisible]);

    useEffect(() => {
      if (isSmallScreen) {
        const savedNavVisible = localStorage.getItem('navVisible');
        if (savedNavVisible === null) {
          toggleNavVisible();
        }
      }
    }, [isSmallScreen, toggleNavVisible]);

    useEffect(() => {
      if (!search.debouncedQuery) {
        return;
      }
      if (!isFetchingNextPage && computedHasNextPage) {
        fetchNextPage();
      }
    }, [search.debouncedQuery, isFetchingNextPage, computedHasNextPage, fetchNextPage]);

    const loadMoreConversations = useCallback(() => {
      if (isFetchingNextPage || !computedHasNextPage) {
        return;
      }

      fetchNextPage();
    }, [isFetchingNextPage, computedHasNextPage, fetchNextPage]);

    const subHeaders = useMemo(
      () => (
        <>
          {search.enabled === null && <SearchBarSkeleton />}
          {search.enabled === true && <SearchBar isSmallScreen={isSmallScreen} />}
        </>
      ),
      [search.enabled, isSmallScreen],
    );

    const [isSearchLoading, setIsSearchLoading] = useState(
      !!search.query && (search.isTyping || isLoading || isFetching || isFetchingNextPage),
    );

    useEffect(() => {
      if (search.isTyping) {
        setIsSearchLoading(true);
      } else if (!isLoading && !isFetching && !isFetchingNextPage) {
        setIsSearchLoading(false);
      } else if (!!search.query && (isLoading || isFetching || isFetchingNextPage)) {
        setIsSearchLoading(true);
      }
    }, [search.query, search.isTyping, isLoading, isFetching, isFetchingNextPage]);

    // Always render sidebar to avoid mount/unmount costs
    // Use transform for GPU-accelerated animation (no layout thrashing)
    const sidebarWidth = isSmallScreen ? NAV_WIDTH.MOBILE : NAV_WIDTH.DESKTOP;

    // Sidebar content (shared between mobile and desktop)
    const sidebarContent = (
      <div className="flex h-full flex-col">
        <nav
          id="chat-history-nav"
          aria-label={localize('com_ui_chat_history')}
          className={cn(
            'flex h-full flex-col gap-[2px]',
            isSmallScreen ? 'pb-10 pl-5 pr-4 pt-11' : 'px-3 pb-3 pt-3.5',
          )}
          aria-hidden={!navVisible}
        >
          <div className="flex flex-1 flex-col gap-[2px] overflow-hidden" ref={outerContainerRef}>
            <MemoNewChat
              subHeaders={subHeaders}
              toggleNav={toggleNavVisible}
              isSmallScreen={isSmallScreen}
            />
            <NavControlLinks isSmallScreen={isSmallScreen} toggleNav={toggleNavVisible} />
            <div className="pt-[8px]">
              <ChatsHeader
                isExpanded={isChatsExpanded}
                onToggle={() => setIsChatsExpanded(!isChatsExpanded)}
              />
            </div>
            {isChatsExpanded && <FavoritesList />}
            {/* Collapse is a three-level hierarchy (designer's rule card):
                CHATS owns everything below it including the FOLDERS header;
                the FOLDERS header collapses all folders at once (their own
                open states are kept, so reopening restores them); each folder
                row only collapses its own chats. */}
            {isChatsExpanded && <FoldersList toggleNav={itemToggleNav} />}
            <div className="flex min-h-0 flex-grow flex-col overflow-hidden">
              <Conversations
                conversations={filteredConversations}
                moveToTop={moveToTop}
                toggleNav={itemToggleNav}
                containerRef={conversationsRef}
                loadMoreConversations={loadMoreConversations}
                isLoading={isFetchingNextPage || showLoading || isLoading}
                isSearchLoading={isSearchLoading}
                isChatsExpanded={isChatsExpanded}
                setIsChatsExpanded={setIsChatsExpanded}
                searchQuery={search.debouncedQuery}
                hideHeader
              />
            </div>
          </div>
          <div className="h-px w-full flex-shrink-0 bg-border-light" aria-hidden="true" />
          <div className="h-2 flex-shrink-0" aria-hidden="true" />
          <Suspense fallback={<Skeleton className="h-12 w-full rounded-[9px]" />}>
            <AccountSettings onNavigate={isSmallScreen ? closeNav : undefined} />
          </Suspense>
          {/* Version — 10.5px, centred. */}
          <div className="flex-shrink-0 text-center text-[10.5px] leading-[15.75px] text-text-secondary-alt dark:text-text-tertiary">
            Nash {String(Constants.VERSION)}
          </div>
        </nav>
      </div>
    );

    // Mobile: Fixed positioned sidebar that slides over content
    // Uses CSS transitions (not Framer Motion) to sync perfectly with content animation
    if (isSmallScreen) {
      return (
        <>
          <div
            data-testid="nav"
            className={cn(
              'nav fixed left-0 top-0 z-[110] h-full rounded-r-[20px] border-r border-border-light bg-surface-primary-alt dark:bg-surface-primary',
              navVisible && 'active',
            )}
            style={{
              width: sidebarWidth,
              transform: navVisible ? 'translateX(0)' : `translateX(-${sidebarWidth}px)`,
              transition: 'transform 0.2s ease-out',
            }}
          >
            {sidebarContent}
          </div>
          <NavMask navVisible={navVisible} toggleNavVisible={toggleNavVisible} />
        </>
      );
    }

    // Desktop: Inline sidebar with width transition
    return (
      <div
        className="flex-shrink-0 overflow-hidden"
        style={{ width: navVisible ? sidebarWidth : 0, transition: 'width 0.2s ease-out' }}
      >
        <motion.div
          data-testid="nav"
          className={cn('nav h-full bg-surface-primary-alt', navVisible && 'active')}
          style={{ width: sidebarWidth }}
          initial={false}
          animate={{
            x: navVisible ? 0 : -sidebarWidth,
          }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {sidebarContent}
        </motion.div>
      </div>
    );
  },
);

Nav.displayName = 'Nav';

export default Nav;
