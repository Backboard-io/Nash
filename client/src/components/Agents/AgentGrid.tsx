import React, { useMemo, useEffect } from 'react';
import { Plus, Search, Bot } from 'lucide-react';
import { Spinner } from '@librechat/client';
import { PermissionBits } from 'librechat-data-provider';
import type t from 'librechat-data-provider';
import { useMarketplaceAgentsInfiniteQuery, useListAgentsQuery } from '~/data-provider/Agents';
import { useDeleteAgentMutation } from '~/data-provider';
import { useAgentCategories, useLocalize } from '~/hooks';
import EmptyState from '~/components/ui/EmptyState';
import { secondaryAction } from '~/components/ui/actionButton';
import { cn } from '~/utils';
import { useInfiniteScroll } from '~/hooks/useInfiniteScroll';
import { useToastContext } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { useHasData } from './SmartLoader';
import ErrorDisplay from './ErrorDisplay';
import AgentCard from './AgentCard';
import { bookmarkListClass } from '~/components/SidePanel/Bookmarks/BookmarkControls';

interface AgentGridProps {
  category: string;
  searchQuery: string;
  onSelectAgent: (agent: t.Agent) => void;
  onStartChat?: () => void;
  /** Start using a persona (begin a chat). Wired to the card "Use" action. */
  onUse?: (agent: t.Agent) => void;
  /** Open a persona in the builder for editing (owned variant only). */
  onEdit?: (agent: t.Agent) => void;
  /** Install a catalogue persona (explore variant only). */
  onInstall?: (agent: t.Agent) => void;
  /** Copy an owned persona (owned variant only). */
  onDuplicate?: (agent: t.Agent) => void;
  /** Credit for personas that carry no author of their own. */
  ownerName?: string;
  /** Grid of cards, or one row per persona. */
  view?: 'grid' | 'list';
  /**
   * How many personas this grid is showing. Reported upward so the section
   * heading and the segment pills can be numbered without a second request
   * for data the grid has already fetched.
   */
  onCountChange?: (count: number) => void;
  /** Template id → the user's installed copy, so a card knows which it is. */
  installedByTemplate?: Map<string, t.Agent>;
  /** Template id currently being installed. */
  installingId?: string | null;
  scrollElementRef?: React.RefObject<HTMLElement>;
  /** Owned personas show Use + Edit; explore personas show Use. */
  variant?: 'owned' | 'explore';
  /** Client-side ordering of the loaded personas: 'popular' | 'newest' | 'name'. */
  sort?: string;
  /** When provided, the empty state offers a "Create Persona" action. */
  onCreatePersona?: () => void;
  /**
   * Where the personas come from:
   * - 'marketplace' (default): all VIEW-able personas via the marketplace query.
   * - 'owned': the user's OWN personas via the partition-scoped /api/agents list.
   *   Searched/sorted client-side. Use this for "My Personas" so Edit/Delete
   *   never render on personas the user does not own.
   */
  source?: 'marketplace' | 'owned';
}

/**
 * Component for displaying a grid of persona (agent) cards
 */
const AgentGrid: React.FC<AgentGridProps> = ({
  category,
  searchQuery,
  onSelectAgent,
  onStartChat,
  onUse,
  onEdit,
  onInstall,
  onDuplicate,
  ownerName,
  view = 'grid',
  onCountChange,
  installedByTemplate,
  installingId,
  scrollElementRef,
  variant = 'owned',
  sort = 'popular',
  onCreatePersona,
  source = 'marketplace',
}) => {
  const isOwnedSource = source === 'owned';
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();

  const deleteAgent = useDeleteAgentMutation({
    onSuccess: () => {
      /* Same reason as install: refetch every agents query so the row goes
         immediately rather than at the next reload. */
      queryClient.invalidateQueries([QueryKeys.agents]);
      showToast({ message: localize('com_ui_agent_deleted'), status: 'success' });
    },
    onError: () => {
      showToast({ message: localize('com_ui_agent_delete_error'), status: 'error' });
    },
  });

  const handleDeleteAgent = (agentId: string) => {
    deleteAgent.mutate({ agent_id: agentId });
  };

  // Get category data from API
  const { categories } = useAgentCategories();

  // Build query parameters based on current state
  const queryParams = useMemo(() => {
    const params: {
      requiredPermission: number;
      category?: string;
      search?: string;
      limit: number;
      promoted?: 0 | 1;
    } = {
      requiredPermission: PermissionBits.VIEW, // View permission for marketplace viewing
      limit: 6,
    };

    // Handle search
    if (searchQuery) {
      params.search = searchQuery;
      // Include category filter for search if it's not 'all' or 'promoted'
      if (category !== 'all' && category !== 'promoted') {
        params.category = category;
      }
    } else {
      // Handle category-based queries
      if (category === 'promoted') {
        params.promoted = 1;
      } else if (category !== 'all') {
        params.category = category;
      }
      // For 'all' category, no additional filters needed
    }

    return params;
  }, [category, searchQuery]);

  // Marketplace query (explore/featured). Disabled when sourcing owned personas.
  const {
    data,
    isLoading: marketplaceLoading,
    error: marketplaceError,
    isFetching: marketplaceFetching,
    fetchNextPage,
    hasNextPage,
    refetch: marketplaceRefetch,
    isFetchingNextPage,
  } = useMarketplaceAgentsInfiniteQuery(queryParams, { enabled: !isOwnedSource });

  // Owned personas come from the partition-scoped basic /api/agents list, which
  // returns only the user's own personas. Disabled for the marketplace source.
  const {
    data: ownedData,
    isLoading: ownedLoading,
    error: ownedError,
    isFetching: ownedFetching,
    refetch: ownedRefetch,
  } = useListAgentsQuery(
    /* Same key the mutations write to — see Marketplace. With `limit` in here
       the owned list was a separate cache entry, so a persona installed or
       deleted on this page did not appear or disappear until a reload. */
    { requiredPermission: PermissionBits.EDIT } as t.AgentListParams,
    { enabled: isOwnedSource },
  );

  const isLoading = isOwnedSource ? ownedLoading : marketplaceLoading;
  const error = isOwnedSource ? ownedError : marketplaceError;
  const isFetching = isOwnedSource ? ownedFetching : marketplaceFetching;
  const refetch = isOwnedSource ? ownedRefetch : marketplaceRefetch;

  // Flatten all pages into a single array of agents
  const currentAgents = useMemo(() => {
    if (isOwnedSource) {
      return ownedData?.data ?? [];
    }
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.data || []);
  }, [isOwnedSource, ownedData?.data, data?.pages]);

  // Client-side ordering of the loaded personas. 'popular' keeps server order;
  // 'newest'/'name' reorder the pages already fetched (backend sort is not yet
  // supported by the marketplace query).
  const sortedAgents = useMemo(() => {
    let list = [...currentAgents];
    // The owned source is not searched server-side; filter it locally so the
    // marketplace search box also works for "My Personas".
    if (isOwnedSource && searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          (a.name || '').toLowerCase().includes(q) ||
          (a.description || '').toLowerCase().includes(q),
      );
    }
    if (sort === 'name') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sort === 'newest') {
      const ts = (agent: t.Agent): number => {
        const raw =
          (agent as { created_at?: string | number }).created_at ??
          (agent as { createdAt?: string | number }).createdAt;
        const value = raw != null ? new Date(raw).getTime() : 0;
        return Number.isNaN(value) ? 0 : value;
      };
      list.sort((a, b) => ts(b) - ts(a));
    }
    return list;
  }, [currentAgents, sort, isOwnedSource, searchQuery]);

  useEffect(() => {
    onCountChange?.(sortedAgents.length);
  }, [sortedAgents.length, onCountChange]);

  // Check if we have meaningful data to prevent unnecessary loading states
  const hasData = useHasData(isOwnedSource ? ownedData : data?.pages?.[0]);

  // Set up infinite scroll
  const { setScrollElement } = useInfiniteScroll({
    // The owned list is returned in full (no pagination), so disable infinite scroll.
    hasNextPage: isOwnedSource ? false : hasNextPage,
    isLoading: isFetching || isFetchingNextPage,
    fetchNextPage: () => {
      if (!isOwnedSource && hasNextPage && !isFetching) {
        fetchNextPage();
      }
    },
    threshold: 0.8, // Trigger when 80% scrolled
    throttleMs: 200,
  });

  // Connect the scroll element when it's provided
  useEffect(() => {
    const scrollElement = scrollElementRef?.current;
    if (scrollElement) {
      setScrollElement(scrollElement);
    }
  }, [scrollElementRef, setScrollElement]);

  /**
   * Get category display name from API data or use fallback
   */
  const getCategoryDisplayName = (categoryValue: string) => {
    const categoryData = categories.find((cat) => cat.value === categoryValue);
    if (categoryData) {
      return categoryData.label;
    }

    // Fallback for special categories or unknown categories
    if (categoryValue === 'promoted') {
      return localize('com_agents_top_picks');
    }
    if (categoryValue === 'all') {
      return 'All';
    }

    // Simple capitalization for unknown categories
    return categoryValue.charAt(0).toUpperCase() + categoryValue.slice(1);
  };

  /**
   * The skeleton stands in for the card, so it is built from the card's own
   * geometry: radius 13 on --surface, 16 of padding, one 12px gap, a 32 avatar,
   * two header lines, two description lines and a Use-sized block.
   *
   * It was a different shape entirely — radius 16, 20 of padding, a 40 avatar —
   * and its divider was a full-bleed `-mx-5` rule inside a rounded box with no
   * `overflow-hidden`, so the line ran out past both corners and sat on the page
   * background. Nothing here bleeds now, and the card clips anyway.
   */
  const loadingSkeleton = (
    <div
      className={bookmarkListClass(view)}
      role="status"
      aria-label={localize('com_agents_loading')}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 overflow-hidden nash-card rounded-[13px] p-4"
        >
          <div className="flex items-center gap-3">
            <div className="size-8 flex-shrink-0 animate-pulse rounded-full bg-surface-active" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="h-[13px] w-1/2 animate-pulse rounded-[4px] bg-surface-active" />
              <div className="h-[11px] w-1/4 animate-pulse rounded-[4px] bg-surface-active" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-[11px] w-full animate-pulse rounded-[4px] bg-surface-active" />
            <div className="h-[11px] w-4/5 animate-pulse rounded-[4px] bg-surface-active" />
          </div>
          <div className="mt-1 h-[30px] w-[62px] animate-pulse rounded-[8px] bg-surface-active" />
        </div>
      ))}
      <span className="sr-only">{localize('com_agents_loading')}</span>
    </div>
  );

  // Handle error state with enhanced error display
  if (error) {
    return (
      <ErrorDisplay
        error={error || 'Unknown error occurred'}
        onRetry={() => refetch()}
        context={{
          searchQuery,
          category,
        }}
      />
    );
  }

  // Main content component with proper semantic structure
  const mainContent = (
    <div
      /* `space-y-6` lands on the `sr-only` announcement div as well as the
         grid, so it reads as 24px above every section. That is more than the
         equivalent Bookmarks section carries, and deliberately so — kept
         because it looks better here, not because the two must match. */
      className="space-y-6"
      role="tabpanel"
      id={`category-panel-${category}`}
      aria-labelledby={`category-tab-${category}`}
      aria-live="polite"
      aria-busy={isLoading && !hasData}
    >
      {/* Handle empty results with enhanced accessibility */}
      {(!sortedAgents || sortedAgents.length === 0) && !isLoading && !isFetching ? (
        <div
          role="status"
          aria-live="polite"
          /* The label a screen reader announces. Dropped when this moved onto
             the shared component — the visible heading is inside EmptyState,
             so without it the status region announced nothing. */
          aria-label={
            searchQuery
              ? localize('com_agents_search_empty_heading')
              : localize('com_agents_empty_state_heading')
          }
        >
          {/* The shared empty state — this was a hand-built one with an 18px
              heading, no icon and its own button classes. */}
          <EmptyState
            icon={searchQuery ? <Search size={24} aria-hidden="true" /> : <Bot size={24} aria-hidden="true" />}
            title={
              searchQuery
                ? localize('com_agents_search_empty_heading')
                : localize('com_agents_empty_state_heading')
            }
            description={searchQuery ? undefined : localize('com_agents_empty_state_subtitle')}
            action={
              !searchQuery && onCreatePersona ? (
                <button
                  type="button"
                  onClick={onCreatePersona}
                  /* §4 `.ghost.outlined` — the filled primary already sits in
                     the page header, and two on one screen is the thing §4's
                     one-primary rule is about. */
                  className={cn(secondaryAction, 'h-[40px] px-[18px] text-[13.5px]')}
                >
                  <Plus size={15} aria-hidden="true" />
                  {localize('com_ui_create_persona')}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* Announcement for screen readers */}
          <div id="search-results-count" className="sr-only" aria-live="polite" aria-atomic="true">
            {localize('com_agents_grid_announcement', {
              count: sortedAgents?.length || 0,
              category: getCategoryDisplayName(category),
            })}
          </div>

          {/* Persona grid - 3 per row on wide screens */}
          {sortedAgents && sortedAgents.length > 0 && (
            <div
              /* The Bookmarks list/grid class itself, not a copy of it: same
                 12px gap and the same breakpoints, so the two pages cannot end
                 up laying the same cards out differently. */
              className={bookmarkListClass(view)}
              role="grid"
              aria-label={localize('com_agents_grid_announcement', {
                count: sortedAgents.length,
                category: getCategoryDisplayName(category),
              })}
            >
              {sortedAgents.map((agent: t.Agent, index: number) => (
                <div key={`${agent.id}-${index}`} role="gridcell">
                  <AgentCard
                    agent={agent}
                    variant={variant}
                    view={view}
                    ownerName={ownerName}
                    onSelect={onSelectAgent}
                    onStartChat={onStartChat}
                    onUse={onUse}
                    onInstall={variant === 'explore' ? onInstall : undefined}
                    installedAgent={
                      variant === 'explore' ? installedByTemplate?.get(agent.id ?? '') : undefined
                    }
                    isInstalling={installingId === agent.id}
                    onEdit={variant === 'owned' ? onEdit : undefined}
                    onDuplicate={variant === 'owned' ? onDuplicate : undefined}
                    onDelete={variant === 'owned' ? handleDeleteAgent : undefined}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Loading indicator when fetching more with accessibility */}
          {isFetchingNextPage && (
            <div
              className="flex justify-center py-8"
              role="status"
              aria-live="polite"
              aria-label={localize('com_agents_loading')}
            >
              <Spinner className="h-6 w-6 text-primary" />
              <span className="sr-only">{localize('com_agents_loading')}</span>
            </div>
          )}

        </>
      )}
    </div>
  );

  /* Skeletons are for a first load, not for every fetch. Any `isFetching` —
     a tab switch, a background refetch, a window refocus — used to replace a
     grid that was already on screen with six pulsing boxes, so switching tabs
     flashed the page empty and back. `hasData` is what SmartLoader computes for
     exactly this, and it was already being derived here and never read. */
  if (isLoading && !hasData) {
    return loadingSkeleton;
  }
  return mainContent;
};

export default AgentGrid;
