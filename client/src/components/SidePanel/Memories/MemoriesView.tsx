import React, { useEffect, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TooltipAnchor, Button, useMediaQuery } from '@librechat/client';
import { PermissionTypes, Permissions, QueryKeys } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { useDocumentTitle, useHasAccess, useLocalize } from '~/hooks';
import { SidePanelProvider, useChatContext } from '~/Providers';
import { SidePanelGroup } from '~/components/SidePanel';
import CollapsedNavRail from '~/components/Nav/CollapsedNavRail';
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

              {/* The shared page shell — the same one Bookmarks, the persona
                  marketplace and Files use, so all four titles land on the same
                  line. This was a centred max-w-[1160px] on a different padding
                  ladder, which put the header somewhere else on every viewport. */}
              <div className="w-full px-4 pb-[44px] pt-[6px] md:px-[40px] md:pb-[60px] md:pt-[2px]">
                <MemoryPanel />
              </div>
            </div>
          </main>
        </SidePanelGroup>
      </SidePanelProvider>
    </div>
  );
}
