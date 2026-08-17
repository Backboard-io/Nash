import React, { useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSetRecoilState } from 'recoil';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { SquarePen, Plus, PanelLeft } from 'lucide-react';
import { TooltipAnchor, Button } from '@librechat/client';
import { CLOSE_SIDEBAR_ID, OPEN_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache, cn } from '~/utils';
import store from '~/store';

export default function NewChat({
  index = 0,
  toggleNav,
  subHeaders,
  isSmallScreen,
  headerButtons,
  orgSwitcher,
}: {
  index?: number;
  toggleNav: () => void;
  isSmallScreen?: boolean;
  subHeaders?: React.ReactNode;
  headerButtons?: React.ReactNode;
  orgSwitcher?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const setActiveFolderId = useSetRecoilState(store.activeFolderId);
  /** Note: this component needs an explicit index passed if using more than one */
  const { newConversation: newConvo } = useNewConvo(index);
  const localize = useLocalize();
  const { conversation } = store.useCreateConversationAtom(index);
  /* The Figma sidebar carries the active fill on New Chat while a blank chat
     is the open view — it is the selected destination, not just a button. */
  const { pathname } = useLocation();
  const isNewChatActive = pathname === '/c/new';

  const handleToggleNav = useCallback(() => {
    toggleNav();
    // Delay focus until after the sidebar animation completes (200ms)
    setTimeout(() => {
      document.getElementById(OPEN_SIDEBAR_ID)?.focus();
    }, 250);
  }, [toggleNav]);

  const clickHandler: React.MouseEventHandler<HTMLAnchorElement> = useCallback(
    (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }

      e.preventDefault();
      setActiveFolderId(null);
      clearMessagesCache(queryClient, conversation?.conversationId);
      queryClient.invalidateQueries([QueryKeys.messages]);
      newConvo({ template: { folderId: null } });
      if (isSmallScreen) {
        toggleNav();
      }
    },
    [queryClient, conversation, newConvo, toggleNav, isSmallScreen, setActiveFolderId],
  );

  return (
    <>
      {/* Matches the page's own top bar exactly — same height, same top
          padding — so the wordmark in the drawer and the wordmark on the page
          sit on the same line. Change one and change the other. */}
      <div className="flex h-14 flex-shrink-0 items-center justify-between px-2 pt-2">
        {/* Figma brand mark: 17px/600 at -0.2px. */}
        <span className="select-none text-[17px] font-semibold leading-[27px] tracking-[-0.2px] text-text-primary">
          {isSmallScreen ? 'Nash' : 'nash:'}
        </span>
        <div className="flex items-center gap-0.5">
          {headerButtons}

          <TooltipAnchor
            description={localize('com_nav_close_sidebar')}
            render={
              <Button
                id={CLOSE_SIDEBAR_ID}
                size="icon"
                variant="outline"
                data-testid="close-sidebar-button"
                aria-label={localize('com_nav_close_sidebar')}
                aria-expanded={true}
                className="h-10 w-10 rounded-full border-none bg-transparent text-text-secondary duration-0 hover:bg-surface-hover focus-visible:ring-inset focus-visible:ring-black focus-visible:ring-offset-0 dark:focus-visible:ring-white md:-mr-[7px] md:h-8 md:w-8 md:rounded-[8px]"
                onClick={handleToggleNav}
              >
                {/* One icon at both widths. This rendered `PanelLeft` on
                    desktop and a different `MobileSidebar` mark on mobile, so
                    the same control looked like two different things — and
                    neither matched the hamburger the page's top bar used for
                    the very same toggle. */}
                <PanelLeft size={18} aria-hidden="true" />
              </Button>
            }
          />
        </div>
      </div>
      {/* 8 here, not 10: the brand row sits INSIDE this 2px-gap flex, where
          the Figma sidebar has it outside the scroller. 2 + 8 + 2 lands the
          org switcher on the same 70px as the artboard. */}
      <div className="h-3 flex-shrink-0" aria-hidden="true" />
      {orgSwitcher}
      {orgSwitcher != null && (
        <div className="h-3.5 flex-shrink-0" aria-hidden="true" />
      )}
      {subHeaders != null ? subHeaders : null}
      {/* Section break: the Figma sidebar puts a full 10px block between the
          brand, the org switcher, the search field and the nav rows. */}
      <div className="h-3.5 flex-shrink-0" aria-hidden="true" />
      <Link
        to="/c/new"
        state={{ focusChat: true }}
        onClick={clickHandler}
        data-testid="nav-new-chat-button"
        aria-label={localize('com_nav_new_chat')}
        className={cn(
          'flex h-[34px] w-full flex-shrink-0 items-center gap-[11px] rounded-[8px] px-[9px] text-[12.5px] leading-[18.75px] transition-colors hover:bg-surface-hover',
          isNewChatActive
            ? 'bg-surface-hover text-text-primary dark:text-text-primary'
            : 'text-text-primary dark:text-text-secondary',
        )}
      >
        {isSmallScreen ? (
          <SquarePen size={18} className="flex-shrink-0 text-text-secondary" aria-hidden="true" />
        ) : (
          <Plus size={16} className="flex-shrink-0 text-text-secondary" aria-hidden="true" />
        )}
        {localize('com_nav_new_chat')}
      </Link>
    </>
  );
}
