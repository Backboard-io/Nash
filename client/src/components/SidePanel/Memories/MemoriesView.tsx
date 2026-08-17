import React, { useEffect, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TooltipAnchor, Button, NewChatIcon, useMediaQuery } from '@librechat/client';
import { PermissionTypes, Permissions, QueryKeys } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { useDocumentTitle, useHasAccess, useLocalize } from '~/hooks';
import { SidePanelProvider, useChatContext } from '~/Providers';
import { SidePanelGroup } from '~/components/SidePanel';
import { OpenSidebar } from '~/components/Chat/Menus';
import { clearMessagesCache } from '~/utils';
import MemoryPanel from './MemoryPanel';

/**
 * Full-page Memories experience. Mirrors the Bookmarks page shell
 * (SidePanelProvider > SidePanelGroup > main) and renders the existing
 * self-contained MemoryPanel as its body.
 */
export default function MemoriesView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { conversation, newConversation } = useChatContext();

  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useDocumentTitle(`${localize('com_ui_memories')} | Nash`);

  const hasReadAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.READ,
  });

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    if (!hasReadAccess) {
      timeoutId = setTimeout(() => navigate('/c/new'), 1000);
    }
    return () => clearTimeout(timeoutId);
  }, [hasReadAccess, navigate]);

  const handleNewChat = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      window.open('/c/new', '_blank');
      return;
    }
    clearMessagesCache(queryClient, conversation?.conversationId);
    queryClient.invalidateQueries([QueryKeys.messages]);
    newConversation();
  };

  if (!hasReadAccess) {
    return null;
  }

  return (
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
                              data-testid="memories-new-chat-button"
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

              <div className="mx-auto w-full max-w-[1160px] px-6 pb-16 pt-4 lg:px-[60px] lg:pt-0">
                <MemoryPanel />
              </div>
            </div>
          </main>
        </SidePanelGroup>
      </SidePanelProvider>
    </div>
  );
}
