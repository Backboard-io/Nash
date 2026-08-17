import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRecoilState } from 'recoil';
import { useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { TooltipAnchor, Button, Dropdown, useMediaQuery } from '@librechat/client';
import {
  Constants,
  PermissionTypes,
  PermissionBits,
  Permissions,
  QueryKeys,
  EModelEndpoint,
  LocalStorageKeys,
} from 'librechat-data-provider';
import type t from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { useAuthContext, useDocumentTitle, useHasAccess, useLocalize, useDefaultConvo } from '~/hooks';
import { useGetEndpointsQuery } from '~/data-provider';
import { useCreateAgentMutation, useListAgentsQuery } from '~/data-provider/Agents';
import { useToastContext } from '@librechat/client';
import MarketplaceAdminSettings from './MarketplaceAdminSettings';
import { SidePanelProvider, useChatContext } from '~/Providers';
import { SidePanelGroup } from '~/components/SidePanel';
import CollapsedNavRail from '~/components/Nav/CollapsedNavRail';
import { clearMessagesCache } from '~/utils';
import CategoryTabs from './CategoryTabs';
import {
  SortMenu,
  ViewToggle,
  type BookmarkView,
} from '~/components/SidePanel/Bookmarks/BookmarkControls';
import SearchBar from './SearchBar';
import AgentGrid from './AgentGrid';
import store from '~/store';

interface AgentMarketplaceProps {
  className?: string;
}

/**
 * Persona Marketplace - browse, install, and use personas.
 *
 * Composition (Figma teal spec): left-aligned header + "Create Persona" CTA ·
 * full-width search + sort · "My Personas" section · "Explore Personas" section
 * with a Featured / Pre-built / Community segmented control.
 */
const AgentMarketplace: React.FC<AgentMarketplaceProps> = ({ className = '' }) => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { user } = useAuthContext();
  /* Credit for personas the user wrote: their own name, however they are
     identified in this deployment. */
  const ownerName = user?.name || user?.username || undefined;
  const [view, setView] = useState<BookmarkView>('grid');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { conversation, newConversation, setConversation } = useChatContext();
  const getDefaultConversation = useDefaultConvo();

  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const [, setHideSidePanel] = useRecoilState(store.hideSidePanel);
  const [, setOpenControlPanel] = useRecoilState(store.openControlPanel);

  const searchQuery = searchParams.get('q') || '';

  const [exploreSegment, setExploreSegment] = useState<string>('prebuilt');
  const [sortBy, setSortBy] = useState<string>('popular');

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useDocumentTitle(`${localize('com_agents_marketplace')} | Nash`);

  // Keep the right side panel (persona/agent builder) available in the marketplace.
  useEffect(() => {
    setHideSidePanel(false);
    localStorage.setItem('hideSidePanel', 'false');
    localStorage.setItem('fullPanelCollapse', 'false');
  }, [setHideSidePanel]);

  // Required before agent queries can run.
  useGetEndpointsQuery();

  const handleAgentSelect = (agent: t.Agent) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('agent_id', agent.id);
    setSearchParams(newParams);
  };

  const handleSearch = (query: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (query.trim()) {
      newParams.set('q', query.trim());
    } else {
      newParams.delete('q');
    }
    setSearchParams(newParams);
  };

  // Open the persona (agent) builder in the left slide-out. Clearing agent_id
  // first guarantees the builder mounts in "new persona" mode rather than
  // loading a previously selected agent for editing.
  const handleCreatePersona = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('agent_id');
    setSearchParams(newParams);
    setOpenControlPanel(EModelEndpoint.agents);
  };

  // Open the persona builder pre-loaded with an existing persona for editing.
  // The builder (AgentPanelSwitch) loads whichever agent is attached to the
  // active conversation, so we set this persona as the conversation's agent,
  // then open the builder. We use setConversation rather than newConversation
  // because the latter navigates to /c/new, kicking the user out of the
  // marketplace and into the chat view.
  const handleEditPersona = (agent: t.Agent) => {
    const template = {
      conversationId: Constants.NEW_CONVO as string,
      endpoint: EModelEndpoint.agents,
      agent_id: agent.id,
    };
    const currentConvo = getDefaultConversation({
      conversation: { ...(conversation ?? {}), ...template },
      preset: template,
    });
    // buildDefaultConvo only restores agent_id when the preset's agent_id is empty
    // or ephemeral; for a real persona it drops it, leaving the builder in "new"
    // mode. Force it back so AgentPanelSwitch loads this persona for editing.
    setConversation({ ...currentConvo, agent_id: agent.id });
    setOpenControlPanel(EModelEndpoint.agents);
  };

  /**
   * The user's own personas, read here purely so an Explore card can tell
   * whether the template it is showing has already been installed.
   */
  /* The exact key the agent mutations maintain — `allAgentViewAndEditQueryKeys`
     is `{ requiredPermission }` and nothing else. Adding `limit` here made this
     a *different* React Query key, so create/delete wrote their updated list
     into a cache entry nobody was reading and the page only caught up on
     reload. The Flask route ignores `limit` anyway and returns the user's whole
     list. */
  const { data: ownedAgents } = useListAgentsQuery(
    { requiredPermission: PermissionBits.EDIT } as t.AgentListParams,
    {},
  );

  /**
   * Template id → the user's copy. An installed persona records the template it
   * came from in `installed_from`, which is the only reliable link: matching on
   * name instead would mark a template installed because the user happens to
   * have written their own persona called "Editor".
   */
  const installedByTemplate = useMemo(() => {
    const map = new Map<string, t.Agent>();
    for (const owned of ownedAgents?.data ?? []) {
      const from = (owned as { installed_from?: string }).installed_from;
      if (from) {
        map.set(from, owned);
      }
    }
    return map;
  }, [ownedAgents?.data]);

  const [installingId, setInstallingId] = useState<string | null>(null);

  const installPersona = useCreateAgentMutation({
    onSuccess: (created) => {
      setInstallingId(null);
      /* Belt and braces on top of the mutation's own cache write: every agents
         query refetches, so the owned list, the explore grid and anything else
         reading personas all agree without a reload. `refetchOnMount: false` on
         this query means a stale entry would otherwise sit there until the app
         restarts. */
      queryClient.invalidateQueries([QueryKeys.agents]);
      showToast({
        message: localize('com_agents_install_success', {
          name: created.name || localize('com_ui_agent'),
        }),
        status: 'success',
      });
    },
    onError: () => {
      setInstallingId(null);
      showToast({ message: localize('com_agents_install_error'), status: 'error' });
    },
  });

  /**
   * Duplicate an owned persona.
   *
   * Built on the same create call as install rather than
   * `useDuplicateAgentMutation`, which posts to a `/duplicate` route this
   * backend does not implement — it would 404.
   *
   * Unlike install, the copy is **yours**: no `author_name`, so it is signed
   * with your name, no `installed_from`, so it is editable. That is the whole
   * point of duplicating an installed persona — install keeps somebody else's
   * work intact and read-only, duplicate gives you one you can change.
   */
  const handleDuplicatePersona = (agent: t.Agent) => {
    installPersona.mutate({
      name: localize('com_ui_copy_of', { 0: agent.name ?? '' }),
      description: agent.description,
      instructions: (agent as { instructions?: string }).instructions ?? '',
      tools: [],
      provider: (conversation?.endpoint ?? '') as t.AgentCreateParams['provider'],
      model: conversation?.model ?? null,
      model_parameters: {} as t.AgentCreateParams['model_parameters'],
    } as t.AgentCreateParams);
  };

  /**
   * Install a catalogue persona: copy the template into the user's own personas.
   *
   * The catalogue rows are read-only templates that belong to nobody, so the
   * old "Use" — which faked the template into the editable agents cache and
   * opened a chat — was starting a conversation against an agent the account
   * did not have. Installing creates a real owned agent from the same
   * instructions, and Use then runs against that copy.
   *
   * Model and provider come from the conversation the user is in, so an
   * installed persona starts on whatever they are already using rather than on
   * a model the catalogue picked for them.
   */
  const handleInstallPersona = (agent: t.Agent) => {
    setInstallingId(agent.id ?? null);
    installPersona.mutate({
      name: agent.name,
      description: agent.description,
      instructions: (agent as { instructions?: string }).instructions ?? '',
      tools: [],
      provider: (conversation?.endpoint ?? '') as t.AgentCreateParams['provider'],
      model: conversation?.model ?? null,
      model_parameters: {} as t.AgentCreateParams['model_parameters'],
      installed_from: agent.id,
      /* The copy keeps the credit. Authorship does not transfer on install —
         the user did not write these instructions — so an installed persona
         still reads "Backboard" under its name in My Personas, exactly as it
         did in Explore. Without this the byline fell back to the category,
         which is empty on an owned agent, and the card lost its second line. */
      author_name: (agent as { author_name?: string }).author_name,
    } as t.AgentCreateParams);
  };

  // Start a chat with the persona (the card "Use" action). Mirrors
  // AgentDetailContent.handleStartChat: ensure the persona is in the editable
  // agents cache, set it as the active agent, then open a new conversation.
  const handleUsePersona = (agent: t.Agent) => {
    /* Whatever arrives here is a persona the user owns — an Explore card
       resolves Use to its installed copy before calling this. The template was
       previously spliced into the editable-agents cache to make Use work at
       all, which only papered over the fact that the backend had no such agent
       for this account; the chat then failed on send. */
    localStorage.setItem(`${LocalStorageKeys.AGENT_ID_PREFIX}0`, agent.id);
    clearMessagesCache(queryClient, conversation?.conversationId);
    queryClient.invalidateQueries([QueryKeys.messages]);

    const template = {
      conversationId: Constants.NEW_CONVO as string,
      endpoint: EModelEndpoint.agents,
      agent_id: agent.id,
      title: localize('com_agents_chat_with', { name: agent.name || localize('com_ui_agent') }),
    };
    const currentConvo = getDefaultConversation({
      conversation: { ...(conversation ?? {}), ...template },
      preset: template,
    });
    newConversation({ template: currentConvo, preset: template });

    if (isSmallScreen) {
      setNavVisible(false);
    }
  };

  const exploreCategory = exploreSegment;

  /* Counts come from the grids themselves as they load, so numbering a tab
     costs no extra request. A segment the user has not opened yet has no count
     and shows none. */
  const [segmentCounts, setSegmentCounts] = useState<Record<string, number>>({});
  const [myPersonaCount, setMyPersonaCount] = useState<number | undefined>(undefined);

  const exploreSegments = useMemo<t.TMarketplaceCategory[]>(
    () => [
      {
        value: 'prebuilt',
        label: 'com_agents_segment_prebuilt',
        count: segmentCounts.prebuilt ?? 0,
      },
      {
        value: 'community',
        label: 'com_agents_segment_community',
        count: segmentCounts.community ?? 0,
      },
    ],
    [segmentCounts],
  );

  const handleExploreCount = useCallback(
    (count: number) => setSegmentCounts((prev) => ({ ...prev, [exploreCategory]: count })),
    [exploreCategory],
  );
  const sortOptions = useMemo(
    () => [
      { value: 'popular', label: localize('com_agents_sort_popular') },
      { value: 'newest', label: localize('com_agents_sort_newest') },
      { value: 'name', label: localize('com_agents_sort_name') },
    ],
    [localize],
  );

  const hasAccessToMarketplace = useHasAccess({
    permissionType: PermissionTypes.MARKETPLACE,
    permission: Permissions.USE,
  });
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    if (!hasAccessToMarketplace) {
      timeoutId = setTimeout(() => {
        navigate('/c/new');
      }, 1000);
    }
    return () => {
      clearTimeout(timeoutId);
    };
  }, [hasAccessToMarketplace, navigate]);

  if (!hasAccessToMarketplace) {
    return null;
  }

  /* The same section heading Bookmarks uses: §2's 11px uppercase label, not a
     20px title. Two page-title-sized headings stacked under the real page title
     made each section read as its own page. The subtitles went with it — a
     sentence under an 11px label is a paragraph attached to a tab stop, and
     Bookmarks carries none. */
  const sectionHeader = (title: string, count?: number, action?: React.ReactNode) => (
    <div className="mb-2 flex h-8 items-center justify-between gap-4">
      <h2 className="flex items-center gap-[7px] px-[2px] text-[11px] font-medium uppercase leading-[16.5px] tracking-[0.06em] text-text-secondary">
        {title}
        {count != null && (
          <>
            <span className="text-text-tertiary">·</span>
            <span className="text-text-tertiary">{count}</span>
          </>
        )}
      </h2>
      {action}
    </div>
  );

  return (
    <div className={`relative flex w-full grow overflow-hidden bg-presentation ${className}`}>
      <SidePanelProvider>
        <SidePanelGroup>
          <main className="flex h-full flex-col overflow-hidden" role="main">
            <div
              ref={scrollContainerRef}
              className="scrollbar-gutter-stable relative flex h-full flex-col overflow-y-auto overflow-x-hidden"
            >
              {/* Top nav controls (only when the left sidebar is hidden) */}
              {!isSmallScreen && (
                <div className="sticky top-0 z-20 flex items-start justify-between bg-presentation px-2 pt-4 md:min-h-14">
                  <div className="mx-1 flex items-center gap-2">
                    {!navVisible ? (
                      <CollapsedNavRail setNavVisible={setNavVisible} />
                    ) : (
                      <div className="h-8 w-8" />
                    )}
                  </div>
                </div>
              )}

              {/* §14 page chrome: 34 / 40 / 60 desktop, 6 / 16 / 44 mobile,
                  on the same 1160 column as Bookmarks and Memories. */}
              <div className="w-full px-4 pb-[44px] pt-[6px] md:px-[40px] md:pb-[60px] md:pt-[2px]">

                {/* Header: title + subtitle + Create Persona */}
                <header className="flex flex-row items-start justify-between gap-4">
                  <div className="min-w-0">
                    {/* §2: a page title is 30/600 at -.5px. */}
                    <h1 className="text-[30px] font-semibold leading-[38px] tracking-[-0.5px] text-text-primary">
                      {localize('com_agents_marketplace')}
                    </h1>
                    <p className="mt-[7px] max-w-2xl text-[13.5px] leading-[20px] text-text-secondary-alt">
                      {localize('com_agents_marketplace_subtitle')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreatePersona}
                    aria-label={localize('com_ui_create_persona')}
                    title={localize('com_ui_create_persona')}
                    className="grid size-[39px] shrink-0 place-items-center rounded-[10px] bg-text-primary text-surface-primary transition-opacity hover:opacity-90 focus:outline-none"
                  >
                    <Plus className="size-[17px]" aria-hidden="true" />
                  </button>
                </header>

                {/* Search + sort — the same row rhythm as Bookmarks. */}
                <div className="flex items-center gap-[10px] pt-[20px]">
                  <SearchBar value={searchQuery} onSearch={handleSearch} />
                  {/* §5's standard sort — the same control Bookmarks uses,
                      with this page's options. */}
                  <SortMenu
                    sort={sortBy}
                    onChange={setSortBy}
                    options={sortOptions.map((o) => ({ key: o.value, label: o.label }))}
                  />
                  {/* The same list/grid pair Bookmarks uses, in the same slot,
                      so the two pages are switched the same way. */}
                  <ViewToggle view={view} onChange={setView} />
                  <MarketplaceAdminSettings />
                </div>

                {searchQuery ? (
                  /* Search results */
                  <section className="pt-[22px]">
                    <AgentGrid
                      category="all"
                      source="owned"
                      view={view}
                      ownerName={ownerName}
                      onDuplicate={handleDuplicatePersona}
                      onCountChange={setMyPersonaCount}
                      searchQuery={searchQuery}
                      sort={sortBy}
                      variant="owned"
                      onSelectAgent={handleAgentSelect}
                      onUse={handleUsePersona}
                      onEdit={handleEditPersona}
                      onStartChat={isSmallScreen ? () => setNavVisible(false) : undefined}
                      scrollElementRef={scrollContainerRef}
                    />
                  </section>
                ) : (
                  <>
                    {/* My Personas */}
                    <section className="pt-[22px]">
                      {sectionHeader(localize('com_agents_my_personas'), myPersonaCount)}
                      <AgentGrid
                        category="all"
                        source="owned"
                        view={view}
                        ownerName={ownerName}
                        onDuplicate={handleDuplicatePersona}
                        onCountChange={setMyPersonaCount}
                        searchQuery=""
                        sort={sortBy}
                        variant="owned"
                        onSelectAgent={handleAgentSelect}
                        onUse={handleUsePersona}
                        onEdit={handleEditPersona}
                        onStartChat={isSmallScreen ? () => setNavVisible(false) : undefined}
                        onCreatePersona={handleCreatePersona}
                        scrollElementRef={scrollContainerRef}
                      />
                    </section>

                    {/* Explore Personas */}
                    {(
                      <section className="pt-[22px]">
                        {sectionHeader(localize('com_agents_explore'), segmentCounts[exploreCategory])}
                        <div className="pb-1 pt-4">
                          <CategoryTabs
                            categories={exploreSegments}
                            activeTab={exploreSegment}
                            isLoading={false}
                            onChange={setExploreSegment}
                          />
                        </div>
                        <AgentGrid
                          key={`explore-${exploreCategory}`}
                          category={exploreCategory}
                          view={view}
                          onCountChange={handleExploreCount}
                          searchQuery=""
                          sort={sortBy}
                          variant="explore"
                          onSelectAgent={handleAgentSelect}
                          onUse={handleUsePersona}
                          onInstall={handleInstallPersona}
                          installedByTemplate={installedByTemplate}
                          installingId={installingId}
                          onStartChat={isSmallScreen ? () => setNavVisible(false) : undefined}
                          scrollElementRef={scrollContainerRef}
                        />
                      </section>
                    )}
                  </>
                )}
              </div>
            </div>
          </main>
        </SidePanelGroup>
      </SidePanelProvider>
    </div>
  );
};

export default AgentMarketplace;
