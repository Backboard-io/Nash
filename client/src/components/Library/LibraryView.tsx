import React, { useMemo } from 'react';
import { Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, NewChatIcon, TooltipAnchor, useMediaQuery } from '@librechat/client';
import { QueryKeys } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { useDocumentTitle, useLocalize } from '~/hooks';
import { SidePanelProvider, useChatContext } from '~/Providers';
import { SidePanelGroup } from '~/components/SidePanel';
import { OpenSidebar } from '~/components/Chat/Menus';
import { FilesContent, type FileTab } from '~/components/Files/FilesView';
import LibraryRail from './LibraryRail';
import { clearMessagesCache } from '~/utils';

type LibrarySection = FileTab;

const DEFAULT_SECTION: LibrarySection = 'all';

function isLibrarySection(value?: string): value is LibrarySection {
  return value === 'all' || value === 'images' || value === 'files';
}

/**
 * Library page. Adopts the Files page layout (single header, "+ New", search + view
 * controls, All / Images / Files filter chips, file table) while keeping the Library
 * name. Bookmarks are reached from the sidebar, not from here — a duplicate section
 * on this page only forked the same data into two places.
 */
export default function LibraryView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { section } = useParams<{ section?: string }>();
  const { conversation, newConversation } = useChatContext();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();

  const activeSection = isLibrarySection(section) ? section : DEFAULT_SECTION;

  const sectionLabels: Record<LibrarySection, string> = useMemo(
    () => ({
      all: localize('com_ui_all_proper'),
      images: localize('com_ui_images'),
      files: localize('com_ui_files'),
    }),
    [localize],
  );

  useDocumentTitle(`${sectionLabels[activeSection]} | ${localize('com_ui_library')} | Nash`);

  const handleNewChat = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      window.open('/c/new', '_blank');
      return;
    }
    clearMessagesCache(queryClient, conversation?.conversationId);
    queryClient.invalidateQueries([QueryKeys.messages]);
    newConversation();
  };

  if (section == null || !isLibrarySection(section)) {
    return <Navigate to={`/library/${DEFAULT_SECTION}`} replace />;
  }

  return (
    <div className="relative flex w-full grow overflow-hidden bg-presentation">
      <SidePanelProvider>
        <SidePanelGroup>
          <main className="flex h-full overflow-hidden" role="main">
            <div className="scrollbar-gutter-stable relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
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
                              data-testid="library-new-chat-button"
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

              <div className="mx-auto w-full max-w-5xl px-6 pb-16">
                <FilesContent
                  controlledTab={activeSection}
                  onTabChange={(tab) => navigate(`/library/${tab}`)}
                  /* Centre column is the Files surface (spec + Figma): title/subtitle/regionLabel
                     all fall back to com_ui_files{,_subtitle}, leaving the rail's <h2> as the only
                     "Library" heading on the page. */
                />
              </div>
            </div>
            <LibraryRail />
          </main>
        </SidePanelGroup>
      </SidePanelProvider>
    </div>
  );
}
