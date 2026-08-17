import {
  useMemo,
  memo,
  type FC,
  useCallback,
  useRef,
  useState,
  useEffect,
  Fragment,
} from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import throttle from 'lodash/throttle';
import { ChevronDown } from 'lucide-react';
import { Spinner, useMediaQuery } from '@librechat/client';
import type { TConversation } from 'librechat-data-provider';
import { useLocalize, TranslationKeys } from '~/hooks';
import { useActiveJobs } from '~/data-provider';
import { groupConversationsByDate, cn } from '~/utils';
import { liquid } from '~/utils/motion';
import Convo from './Convo';
import { CHAT_ROW_GAP } from './rowSpacing';
import Collapse from '~/components/ui/Collapse';

interface ConversationsProps {
  conversations: Array<TConversation | null>;
  moveToTop: () => void;
  toggleNav: () => void;
  loadMoreConversations: () => void;
  isLoading: boolean;
  isSearchLoading: boolean;
  isChatsExpanded: boolean;
  setIsChatsExpanded: (expanded: boolean) => void;
  searchQuery?: string;
  hideHeader?: boolean;
}

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
      className="group flex h-8 w-full items-center justify-between rounded-[8px] px-[9px] text-[11px] font-medium uppercase leading-[16.5px] tracking-[0.06em] text-text-secondary outline-none transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white max-md:text-[12px] max-md:normal-case max-md:leading-[18px]"
      aria-expanded={isExpanded}
      type="button"
    >
      <span className="select-none">{localize(isSmallScreen ? 'com_ui_recents' : 'com_ui_chats')}</span>
      <ChevronDown
        className={cn(
          'h-3.5 w-3.5 text-text-secondary transition-transform duration-[380ms] ease-[cubic-bezier(.16,1,.3,1)]',
          isExpanded ? '' : '-rotate-90',
        )}
      />
    </button>
  );
});

ChatsHeader.displayName = 'ChatsHeader';

/* §14 date groups — rules 8 and 10: 24px above a heading, 4px below, and none
 * above the first, so a heading sits close to the chats it names and far from
 * the ones it doesn't.
 *
 * A heading whose height depends on its position used to be unsafe here, back
 * when heights were measured and cached per group name: one measured while
 * first kept that height when a pin appeared above it, and drew over the row
 * beneath. The heights are declared now, from this function, and recomputed
 * whenever the rows change — there is no cached measurement left to disagree
 * with what is on screen. */
/* All the separation sits *above* the heading and none below it, so the label
   reads as attached to the chats it names rather than floating between two
   groups. Splitting the space evenly (2 above, 4 below) was worse than either
   extreme: the heading belonged to neither side and the groups stopped being
   legible as groups. 12 above is half the 24 this started at — enough to see
   the boundary at a glance, not so much that a one-chat group drifts away from
   its own label. */
const DATE_LABEL_HEIGHT = 32; // matches the FOLDERS header's h-8
const DATE_GROUP_GAP = 12; // above the heading — where the separation lives
const DATE_LABEL_PAD_BOTTOM = 0; // none: the heading belongs to the chats below

const dateHeaderHeight = (isFirst: boolean) =>
  (isFirst ? 0 : DATE_GROUP_GAP) + DATE_LABEL_HEIGHT + DATE_LABEL_PAD_BOTTOM;

const DateLabel: FC<{ groupName: string }> = memo(({ groupName }) => {
  const localize = useLocalize();
  return (
    // §2 and §14 rule 10: a date heading is a label, not a control — 11px
    // medium, UPPERCASE, .06em tracking, in --t3 (which this app spells
    // `text-secondary-alt`; `text-tertiary` here is --t4).
    <h2
      style={{ height: DATE_LABEL_HEIGHT }}
      className="flex items-center px-[9px] text-[11px] font-medium uppercase leading-[16.5px] tracking-[0.06em] text-text-secondary-alt"
    >
      {localize(groupName as TranslationKeys) || groupName}
    </h2>
  );
});

DateLabel.displayName = 'DateLabel';

type FlattenedItem =
  | { type: 'header'; groupName: string; isFirst: boolean }
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
  /* Every field the row actually draws has to be listed here, or the row is
   * told not to re-render when it changes. `isPinned` was missing: the pin is
   * the one thing this comparator was most likely to be asked about, and a
   * pinned chat kept whatever glyph it had until something forced a remount —
   * which is why the pin used to survive an unpin until a refresh, and why a
   * chat sitting under PINNED could show no pin at all. */
  (prevProps, nextProps) => {
    return (
      prevProps.conversation.conversationId === nextProps.conversation.conversationId &&
      prevProps.conversation.title === nextProps.conversation.title &&
      prevProps.conversation.endpoint === nextProps.conversation.endpoint &&
      prevProps.conversation.folderId === nextProps.conversation.folderId &&
      prevProps.conversation.isPinned === nextProps.conversation.isPinned &&
      prevProps.isGenerating === nextProps.isGenerating
    );
  },
);

const Conversations: FC<ConversationsProps> = ({
  conversations: rawConversations,
  moveToTop,
  toggleNav,
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

    /* The Chats header is deliberately NOT a row in the virtualized list. As a
     * row, collapsing the section just dropped every row below it — instant,
     * while folders animate. §10: nothing opens or closes instantly. Lifted out
     * of the list, the list region itself can animate its height. */
    if (isChatsExpanded) {
      groupedConversations.forEach(([groupName, convos], groupIndex) => {
        items.push({ type: 'header', groupName, isFirst: groupIndex === 0 });
        items.push(...convos.map((convo) => ({ type: 'convo' as const, convo })));
      });

      if (isLoading) {
        items.push({ type: 'loading' } as any);
      }
    }
    return items;
  }, [groupedConversations, isLoading, isChatsExpanded]);

  /* Pinning moves a row between two absolute positions. `.nash-reordering`
   * puts a transition on every row's `top` so the move reads as travel rather
   * than a teleport — but only for the length of that move. Left on
   * permanently it would also animate the rows that settle during first
   * measurement, which looks like the list arriving crooked. */
  const pinnedSignature = useMemo(
    () =>
      filteredConversations
        .filter((convo) => convo.isPinned === true)
        .map((convo) => convo.conversationId)
        .join('|'),
    [filteredConversations],
  );
  const [isReordering, setIsReordering] = useState(false);
  const previousPinned = useRef(pinnedSignature);

  useEffect(() => {
    if (previousPinned.current === pinnedSignature) {
      return;
    }
    previousPinned.current = pinnedSignature;
    setIsReordering(true);
    const timer = window.setTimeout(() => setIsReordering(false), 460);
    return () => window.clearTimeout(timer);
  }, [pinnedSignature]);

  const reduceMotion = useReducedMotion();

  const rowKey = useCallback((item: FlattenedItem, index: number) => {
    if (item.type === 'header') {
      return `header-${item.groupName}`;
    }
    if (item.type === 'convo') {
      return `convo-${item.convo.conversationId}`;
    }
    return `loading-${index}`;
  }, []);

  const renderRow = useCallback(
    (item: FlattenedItem) => {
      if (item.type === 'loading') {
        return <LoadingSpinner />;
      }

      if (item.type === 'header') {
        return (
          /* Same spacing as the FOLDERS heading above it — see the constants. */
          <div
            style={{
              paddingTop: item.isFirst ? 0 : DATE_GROUP_GAP,
              paddingBottom: DATE_LABEL_PAD_BOTTOM,
            }}
          >
            <DateLabel groupName={item.groupName} />
          </div>
        );
      }

      const isGenerating = activeJobIds.has(item.convo.conversationId ?? '');
      return (
        /* `layout` only while a pin is actually moving something. In normal
         * flow a row can genuinely slide to its new place — the thing the
         * virtualized list could never do — but left on permanently it would
         * also animate every row that shifts when a page of history loads. */
        <motion.div
          layout={isReordering}
          transition={reduceMotion === true ? { duration: 0.001 } : liquid}
        >
          <MemoizedConvo
            conversation={item.convo}
            retainView={moveToTop}
            toggleNav={toggleNav}
            isGenerating={isGenerating}
          />
        </motion.div>
      );
    },
    [moveToTop, toggleNav, activeJobIds, isReordering, reduceMotion],
  );

  const throttledLoadMore = useMemo(
    () => throttle(loadMoreConversations, 300),
    [loadMoreConversations],
  );

  /* The virtualizer told us which rows were on screen; without it, a one-pixel
   * sentinel at the end of the list does the same job — when it scrolls into
   * view, the next page is due. */
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (el == null || typeof IntersectionObserver === 'undefined' || !isChatsExpanded) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting === true && throttledLoadMore(),
      { rootMargin: '320px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [throttledLoadMore, isChatsExpanded, flattenedItems.length]);

  const showEmptySearch = !!searchQuery && filteredConversations.length === 0;



  return (
    <div className="relative flex h-full min-h-0 flex-col pb-2 text-sm text-text-primary">
      {!hideHeader && (
        <div className="pb-[2px]">
          <ChatsHeader
            isExpanded={isChatsExpanded}
            onToggle={() => setIsChatsExpanded(!isChatsExpanded)}
          />
        </div>
      )}
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
        /* Plain rows in normal flow, not a virtualized list.
         *
         * The list used to own the only scrollbar in the sidebar, which is why
         * the nav links and folders above it stayed pinned while just the chats
         * moved. A virtualizer has to be given a bounded height to work, so it
         * could never be part of a taller scrolling region — §14 asks for one
         * region between the fixed brand row and the pinned footer, and this is
         * what was in the way. Rows are cheap and their heights were already
         * declared rather than measured; pages load on demand, so the DOM only
         * grows as far as you scroll. */
        <Collapse open={isChatsExpanded}>
          {/* The shared row rhythm — see rowSpacing. Hard-coding it here is how
              the two lists drifted apart the first time. */}
          <div className="flex flex-col" style={{ rowGap: CHAT_ROW_GAP }}>
            {flattenedItems.map((item, index) => (
              <Fragment key={rowKey(item, index)}>{renderRow(item)}</Fragment>
            ))}
            {/* Loads the next page when it comes into view, which is what
             *  onRowsRendered did for the virtualizer. */}
            <div ref={loadMoreRef} aria-hidden="true" className="h-px w-full" />
          </div>
        </Collapse>
      )}
    </div>
  );
};

export default memo(Conversations);
