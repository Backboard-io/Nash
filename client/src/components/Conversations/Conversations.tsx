import { useMemo, memo, type FC, useCallback, useRef } from 'react';
import throttle from 'lodash/throttle';
import { ChevronDown } from 'lucide-react';
import { Spinner, useMediaQuery } from '@librechat/client';
import { List, AutoSizer, CellMeasurer, CellMeasurerCache } from 'react-virtualized';
import type { TConversation } from 'librechat-data-provider';
import { useLocalize, TranslationKeys } from '~/hooks';
import { useActiveJobs } from '~/data-provider';
import { groupConversationsByDate, cn } from '~/utils';
import Convo from './Convo';

export type CellPosition = {
  columnIndex: number;
  rowIndex: number;
};

export type MeasuredCellParent = {
  invalidateCellSizeAfterRender?: ((cell: CellPosition) => void) | undefined;
  recomputeGridSize?: ((cell: CellPosition) => void) | undefined;
};

interface ConversationsProps {
  conversations: Array<TConversation | null>;
  moveToTop: () => void;
  toggleNav: () => void;
  containerRef: React.RefObject<List>;
  loadMoreConversations: () => void;
  isLoading: boolean;
  isSearchLoading: boolean;
  isChatsExpanded: boolean;
  setIsChatsExpanded: (expanded: boolean) => void;
  searchQuery?: string;
  hideHeader?: boolean;
}

interface MeasuredRowProps {
  cache: CellMeasurerCache;
  rowKey: string;
  parent: MeasuredCellParent;
  index: number;
  style: React.CSSProperties;
  children: React.ReactNode;
}

/** Reusable wrapper for virtualized row measurement */
const MeasuredRow: FC<MeasuredRowProps> = memo(
  ({ cache, rowKey, parent, index, style, children }) => (
    <CellMeasurer cache={cache} columnIndex={0} key={rowKey} parent={parent} rowIndex={index}>
      {({ registerChild }) => (
        <div ref={registerChild as React.LegacyRef<HTMLDivElement>} style={style}>
          {children}
        </div>
      )}
    </CellMeasurer>
  ),
);

MeasuredRow.displayName = 'MeasuredRow';

const LoadingSpinner = memo(() => {
  const localize = useLocalize();

  return (
    <div className="mx-auto mt-2 flex items-center justify-center gap-2">
      <Spinner className="text-text-primary" />
      <span className="animate-pulse text-text-primary">{localize('com_ui_loading')}</span>
    </div>
  );
});

LoadingSpinner.displayName = 'LoadingSpinner';

interface ChatsHeaderProps {
  isExpanded: boolean;
  onToggle: () => void;
}

/** Collapsible header for the Chats section */
export const ChatsHeader: FC<ChatsHeaderProps> = memo(({ isExpanded, onToggle }) => {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  return (
    <button
      onClick={onToggle}
      className="group flex h-8 w-full items-center justify-between rounded-[8px] px-[9px] text-[11px] font-medium uppercase leading-[16.5px] text-text-secondary outline-none transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white max-md:text-[12px] max-md:normal-case max-md:leading-[18px]"
      aria-expanded={isExpanded}
      type="button"
    >
      <span className="select-none">{localize(isSmallScreen ? 'com_ui_recents' : 'com_ui_chats')}</span>
      <ChevronDown
        className={cn(
          'h-3.5 w-3.5 text-text-secondary transition-transform duration-200',
          isExpanded ? '' : '-rotate-90',
        )}
      />
    </button>
  );
});

ChatsHeader.displayName = 'ChatsHeader';

const DateLabel: FC<{ groupName: string }> = memo(({ groupName }) => {
  const localize = useLocalize();
  return (
    <h2 className="flex h-[30px] items-center px-[9px] text-[11px] font-medium leading-[16.5px] text-text-secondary-alt">
      {localize(groupName as TranslationKeys) || groupName}
    </h2>
  );
});

DateLabel.displayName = 'DateLabel';

type FlattenedItem =
  | { type: 'chats-header' }
  | { type: 'header'; groupName: string }
  | { type: 'convo'; convo: TConversation }
  | { type: 'loading' };

const MemoizedConvo = memo(
  ({
    conversation,
    retainView,
    toggleNav,
    isGenerating,
  }: {
    conversation: TConversation;
    retainView: () => void;
    toggleNav: () => void;
    isGenerating: boolean;
  }) => {
    return (
      <Convo
        conversation={conversation}
        retainView={retainView}
        toggleNav={toggleNav}
        isGenerating={isGenerating}
      />
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.conversation.conversationId === nextProps.conversation.conversationId &&
      prevProps.conversation.title === nextProps.conversation.title &&
      prevProps.conversation.endpoint === nextProps.conversation.endpoint &&
      prevProps.conversation.folderId === nextProps.conversation.folderId &&
      prevProps.isGenerating === nextProps.isGenerating
    );
  },
);

const Conversations: FC<ConversationsProps> = ({
  conversations: rawConversations,
  moveToTop,
  toggleNav,
  containerRef,
  loadMoreConversations,
  isLoading,
  isSearchLoading,
  isChatsExpanded,
  setIsChatsExpanded,
  searchQuery,
  hideHeader = false,
}) => {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const convoHeight = isSmallScreen ? 44 : 34;

  // Fetch active job IDs for showing generation indicators
  const { data: activeJobsData } = useActiveJobs();
  const activeJobIds = useMemo(
    () => new Set(activeJobsData?.activeJobIds ?? []),
    [activeJobsData?.activeJobIds],
  );

  const filteredConversations = useMemo(
    () => rawConversations.filter(Boolean) as TConversation[],
    [rawConversations],
  );

  const groupedConversations = useMemo(
    () => groupConversationsByDate(filteredConversations),
    [filteredConversations],
  );

  const flattenedItems = useMemo(() => {
    const items: FlattenedItem[] = [];
    if (!hideHeader) {
      items.push({ type: 'chats-header' });
    }

    if (isChatsExpanded) {
      groupedConversations.forEach(([groupName, convos]) => {
        items.push({ type: 'header', groupName });
        items.push(...convos.map((convo) => ({ type: 'convo' as const, convo })));
      });

      if (isLoading) {
        items.push({ type: 'loading' } as any);
      }
    }
    return items;
  }, [groupedConversations, isLoading, isChatsExpanded]);

  // Store flattenedItems in a ref for keyMapper to access without recreating cache
  const flattenedItemsRef = useRef(flattenedItems);
  flattenedItemsRef.current = flattenedItems;

  // Create a stable cache that doesn't depend on flattenedItems
  const cache = useMemo(
    () =>
      new CellMeasurerCache({
        fixedWidth: true,
        defaultHeight: convoHeight,
        keyMapper: (index) => {
          const item = flattenedItemsRef.current[index];
          if (!item) {
            return `unknown-${index}`;
          }
          if (item.type === 'chats-header') {
            return 'chats-header';
          }
          if (item.type === 'header') {
            return `header-${item.groupName}`;
          }
          if (item.type === 'convo') {
            return `convo-${item.convo.conversationId}`;
          }
          if (item.type === 'loading') {
            return 'loading';
          }
          return `unknown-${index}`;
        },
      }),
    [convoHeight],
  );

  const rowRenderer = useCallback(
    ({ index, key, parent, style }) => {
      const item = flattenedItems[index];
      const rowProps = { cache, rowKey: key, parent, index, style };

      if (item.type === 'loading') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <LoadingSpinner />
          </MeasuredRow>
        );
      }

      if (item.type === 'chats-header') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <div className="pb-[2px]">
              <ChatsHeader
                isExpanded={isChatsExpanded}
                onToggle={() => setIsChatsExpanded(!isChatsExpanded)}
              />
            </div>
          </MeasuredRow>
        );
      }

      if (item.type === 'header') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            {/* 16 above each date marker (14 + the 2px row gap below the previous
                row) — per the dates card; the bare 2px read as one block. */}
            <div className="pb-[2px] pt-[14px]">
              <DateLabel groupName={item.groupName} />
            </div>
          </MeasuredRow>
        );
      }

      if (item.type === 'convo') {
        const isGenerating = activeJobIds.has(item.convo.conversationId ?? '');
        return (
          <MeasuredRow key={key} {...rowProps}>
            <div className="pb-[2px]">
              <MemoizedConvo
                conversation={item.convo}
                retainView={moveToTop}
                toggleNav={toggleNav}
                isGenerating={isGenerating}
              />
            </div>
          </MeasuredRow>
        );
      }

      return null;
    },
    [
      cache,
      flattenedItems,
      moveToTop,
      toggleNav,
      isSmallScreen,
      isChatsExpanded,
      setIsChatsExpanded,
      activeJobIds,
    ],
  );

  const getRowHeight = useCallback(
    ({ index }: { index: number }) => cache.getHeight(index, 0),
    [cache],
  );

  const throttledLoadMore = useMemo(
    () => throttle(loadMoreConversations, 300),
    [loadMoreConversations],
  );

  const handleRowsRendered = useCallback(
    ({ stopIndex }: { stopIndex: number }) => {
      if (stopIndex >= flattenedItems.length - 8) {
        throttledLoadMore();
      }
    },
    [flattenedItems.length, throttledLoadMore],
  );

  const showEmptySearch = !!searchQuery && filteredConversations.length === 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col pb-2 text-sm text-text-primary">
      {isSearchLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-text-primary" />
          <span className="ml-2 text-text-primary">{localize('com_ui_loading')}</span>
        </div>
      ) : showEmptySearch ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-text-secondary">{localize('com_ui_nothing_found')}</span>
        </div>
      ) : (
        <div className="flex-1">
          <AutoSizer>
            {({ width, height }) => (
              <List
                ref={containerRef}
                width={width}
                height={height}
                deferredMeasurementCache={cache}
                rowCount={flattenedItems.length}
                rowHeight={getRowHeight}
                rowRenderer={rowRenderer}
                overscanRowCount={10}
                aria-readonly={false}
                className="outline-none [&::-webkit-scrollbar-thumb]:rounded-[2px] [&::-webkit-scrollbar-thumb]:bg-black/15 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-[3px] dark:[&::-webkit-scrollbar-thumb]:bg-white/15"
                aria-label="Conversations"
                onRowsRendered={handleRowsRendered}
                tabIndex={-1}
                // No scrollbarGutter: it reserved a classic 8px gutter, making every
                // chat row 8px narrower than the nav items, folder rows and headers,
                // so the trailing pin never lined up with their chevrons.
                style={{ outline: 'none' }}
              />
            )}
          </AutoSizer>
        </div>
      )}
    </div>
  );
};

export default memo(Conversations);
