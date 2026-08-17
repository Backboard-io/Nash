import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRecoilState } from 'recoil';
import { useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { TooltipAnchor, Button, NewChatIcon, Dropdown, useMediaQuery } from '@librechat/client';
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
import type { AgentListResponse } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { useDocumentTitle, useHasAccess, useLocalize, useDefaultConvo } from '~/hooks';
import { useGetEndpointsQuery } from '~/data-provider';
import MarketplaceAdminSettings from './MarketplaceAdminSettings';
import { SidePanelProvider, useChatContext } from '~/Providers';
import { SidePanelGroup } from '~/components/SidePanel';
import { OpenSidebar } from '~/components/Chat/Menus';
import { clearMessagesCache } from '~/utils';
import CategoryTabs from './CategoryTabs';
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

  const [exploreSegment, setExploreSegment] = useState<string>('featured');
  const [sortBy, setSortBy] = useState<string>('popular');
  const [showAllMine, setShowAllMine] = useState<boolean>(false);

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

  const handleNewChat = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      window.open('/c/new', '_blank');
      return;
    }
    clearMessagesCache(queryClient, conversation?.conversationId);
    queryClient.invalidateQueries([QueryKeys.messages]);
    newConversation();
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

  // Start a chat with the persona (the card "Use" action). Mirrors
  // AgentDetailContent.handleStartChat: ensure the persona is in the editable
  // agents cache, set it as the active agent, then open a new conversation.
  const handleUsePersona = (agent: t.Agent) => {
    const keys = [QueryKeys.agents, { requiredPermission: PermissionBits.EDIT }];
    const listResp = queryClient.getQueryData<AgentListResponse>(keys);
    if (listResp != null && !listResp.data.some((a) => a.id === agent.id)) {
      const merged = [agent, ...JSON.parse(JSON.stringify(listResp.data))];
      queryClient.setQueryData<AgentListResponse>(keys, { ...listResp, data: merged });
    }

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

  // Featured maps to the backend "promoted" flag; the other segments query by
  // category name (backend may return empty until those catalogs are populated).
  const exploreSegments = useMemo<t.TMarketplaceCategory[]>(
    () => [
      { value: 'featured', label: 'com_agents_segment_featured', count: 0 },
      { value: 'prebuilt', label: 'com_agents_segment_prebuilt', count: 0 },
      { value: 'community', label: 'com_agents_segment_community', count: 0 },
    ],
    [],
  );
  const exploreCategory = exploreSegment === 'featured' ? 'promoted' : exploreSegment;

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

  const sectionHeader = (title: string, subtitle: string, action?: React.ReactNode) => (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
        <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
      </div>
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
                              data-testid="agents-new-chat-button"
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
                {/* Header: title + subtitle + Create Persona */}
                <header className="flex flex-col gap-4 pb-2 pt-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">
                      {localize('com_agents_marketplace')}
                    </h1>
                    <p className="mt-2 max-w-2xl text-base text-text-secondary">
                      {localize('com_agents_marketplace_subtitle')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreatePersona}
                    className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-brand-purple px-4 py-2.5 text-sm font-semibold text-brand-purple-foreground transition-colors hover:bg-brand-purple-hover focus:outline-none focus:ring-2 focus:ring-brand-purple focus:ring-offset-2 focus:ring-offset-presentation"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {localize('com_ui_create_persona')}
                  </button>
                </header>

                {/* Search + sort */}
                <div className="flex items-center gap-3 py-6">
                  <SearchBar value={searchQuery} onSearch={handleSearch} />
                  <Dropdown
                    value={sortBy}
                    onChange={setSortBy}
                    options={sortOptions}
                    sizeClasses="min-w-[10rem]"
                    className="flex-shrink-0"
                    testId="persona-sort-dropdown"
                    ariaLabel={localize('com_agents_sort_popular')}
                  />
                  <MarketplaceAdminSettings />
                </div>

                {searchQuery ? (
                  /* Search results */
                  <section className="pt-2">
                    <AgentGrid
                      category="all"
                      source="owned"
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
                    <section className="pt-2">
                      {sectionHeader(
                        localize('com_agents_my_personas'),
                        localize('com_agents_my_personas_subtitle'),
                        <button
                          type="button"
                          onClick={() => setShowAllMine((v) => !v)}
                          className="flex-shrink-0 text-sm font-medium text-brand-purple transition-colors hover:text-brand-purple-hover"
                        >
                          {showAllMine
                            ? localize('com_ui_show_less')
                            : localize('com_ui_view_all')}
                        </button>,
                      )}
                      <AgentGrid
                        category="all"
                        source="owned"
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
                    {!showAllMine && (
                      <section className="pt-12">
                        {sectionHeader(
                          localize('com_agents_explore'),
                          localize('com_agents_explore_subtitle'),
                        )}
                        <div className="mb-6">
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
                          searchQuery=""
                          sort={sortBy}
                          variant="explore"
                          onSelectAgent={handleAgentSelect}
                          onUse={handleUsePersona}
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
