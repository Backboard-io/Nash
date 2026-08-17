import React, { useMemo, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Spinner } from '@librechat/client';
import { PermissionBits } from 'librechat-data-provider';
import type t from 'librechat-data-provider';
import { useMarketplaceAgentsInfiniteQuery, useListAgentsQuery } from '~/data-provider/Agents';
import { useDeleteAgentMutation } from '~/data-provider';
import { useAgentCategories, useLocalize } from '~/hooks';
import { useInfiniteScroll } from '~/hooks/useInfiniteScroll';
import { useToastContext } from '@librechat/client';
import { useHasData } from './SmartLoader';
import ErrorDisplay from './ErrorDisplay';
import AgentCard from './AgentCard';

interface AgentGridProps {
  category: string;
  searchQuery: string;
  onSelectAgent: (agent: t.Agent) => void;
  onStartChat?: () => void;
  /** Start using a persona (begin a chat). Wired to the card "Use" action. */
  onUse?: (agent: t.Agent) => void;
  /** Open a persona in the builder for editing (owned variant only). */
  onEdit?: (agent: t.Agent) => void;
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
  scrollElementRef,
  variant = 'owned',
  sort = 'popular',
  onCreatePersona,
  source = 'marketplace',
}) => {
  const isOwnedSource = source === 'owned';
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const deleteAgent = useDeleteAgentMutation({
    onSuccess: () => {
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
    { requiredPermission: PermissionBits.EDIT, limit: 100 } as t.AgentListParams,
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

  // Skeleton grid shown while personas load (matches the card footprint).
  const loadingSkeleton = (
    <div
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-label={localize('com_agents_loading')}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-surface-tertiary p-5">
          <div className="flex items-center gap-3">
            <div className="size-10 flex-shrink-0 animate-pulse rounded-full bg-surface-hover" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-surface-hover" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-surface-hover" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-surface-hover" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-surface-hover" />
          </div>
          <div className="-mx-5 mt-4 border-t border-border-light" />
          <div className="mt-3 h-7 w-24 animate-pulse rounded-lg bg-surface-hover" />
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
          className="flex flex-col items-center justify-center py-16 text-center"
          role="status"
          aria-live="polite"
          aria-label={
            searchQuery
              ? localize('com_agents_search_empty_heading')
              : localize('com_agents_empty_state_heading')
          }
        >
          <h3 className="text-lg font-semibold text-text-primary">
            {searchQuery
              ? localize('com_agents_search_empty_heading')
              : localize('com_agents_empty_state_heading')}
          </h3>
          {!searchQuery && (
            <p className="mt-2 max-w-sm text-sm text-text-secondary">
              {localize('com_agents_empty_state_subtitle')}
            </p>
          )}
          {!searchQuery && onCreatePersona && (
            <button
              type="button"
              onClick={onCreatePersona}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-purple px-4 py-2.5 text-sm font-semibold text-brand-purple-foreground transition-colors hover:bg-brand-purple-hover focus:outline-none focus:ring-2 focus:ring-brand-purple focus:ring-offset-2 focus:ring-offset-presentation"
            >
              <Plus className="size-4" aria-hidden="true" />
              {localize('com_ui_create_persona')}
            </button>
          )}
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
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
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
                    onSelect={onSelectAgent}
                    onStartChat={onStartChat}
                    onUse={onUse}
                    onEdit={variant === 'owned' ? onEdit : undefined}
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

  if (isLoading || (isFetching && !isFetchingNextPage)) {
    return loadingSkeleton;
  }
  return mainContent;
};

export default AgentGrid;
