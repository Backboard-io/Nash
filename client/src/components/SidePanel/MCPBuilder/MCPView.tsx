import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TooltipAnchor, Button, useMediaQuery } from '@librechat/client';
import { QueryKeys } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { useDocumentTitle, useLocalize } from '~/hooks';
import { SidePanelProvider, useChatContext } from '~/Providers';
import { SidePanelGroup } from '~/components/SidePanel';
import CollapsedNavRail from '~/components/Nav/CollapsedNavRail';
import { clearMessagesCache } from '~/utils';
import MCPBuilderPanel from './MCPBuilderPanel';

/**
 * MCP servers as a full page.
 *
 * It used to be a slide-out in the left control panel, which is the wrong
 * container for it twice over: §7 says a panel is for *browsing a set* that
 * needs its own search, filters and scrolling, and this one has all three plus
 * cards, a create dialog and a provider catalogue — at roughly 300px wide, with
 * the conversation still behind it. Every other management surface in the app
 * (Bookmarks, Memories, Library, Personas) is a page; this is now one too, on
 * the same shell so its header lands on the same line as theirs.
 */
export default function MCPView() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { conversation, newConversation } = useChatContext();

  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();

  useDocumentTitle(`${localize('com_nav_setting_mcp')} | Nash`);

  return (
    <div className="relative flex w-full grow overflow-hidden bg-presentation">
      <SidePanelProvider>
        <SidePanelGroup>
          <main className="flex h-full flex-col overflow-hidden" role="main">
            <div className="scrollbar-gutter-stable relative flex h-full flex-col overflow-y-auto overflow-x-hidden">
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

              {/* The shared page shell — Bookmarks, Memories, Library, Personas. */}
              <div className="w-full px-4 pb-[44px] pt-[6px] md:px-[40px] md:pb-[60px] md:pt-[2px]">
                <MCPBuilderPanel />
              </div>
            </div>
          </main>
        </SidePanelGroup>
      </SidePanelProvider>
    </div>
  );
}
