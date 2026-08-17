import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useSetRecoilState } from 'recoil';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { SquarePen, Plus, PanelLeft } from 'lucide-react';
import { TooltipAnchor, MobileSidebar, Button } from '@librechat/client';
import { CLOSE_SIDEBAR_ID, OPEN_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache } from '~/utils';
import store from '~/store';

export default function NewChat({
  index = 0,
  toggleNav,
  subHeaders,
  isSmallScreen,
  headerButtons,
}: {
  index?: number;
  toggleNav: () => void;
  isSmallScreen?: boolean;
  subHeaders?: React.ReactNode;
  headerButtons?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const setActiveFolderId = useSetRecoilState(store.activeFolderId);
  /** Note: this component needs an explicit index passed if using more than one */
  const { newConversation: newConvo } = useNewConvo(index);
  const localize = useLocalize();
  const { conversation } = store.useCreateConversationAtom(index);

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
      <div className="flex h-11 flex-shrink-0 items-center justify-between px-2">
        <span className="select-none text-[18px] font-semibold leading-[27px] text-text-primary max-md:text-[20px] max-md:leading-[30px]">
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
                <PanelLeft size={18} aria-hidden="true" className="max-md:hidden" />
                <MobileSidebar
                  aria-hidden="true"
                  className="icon-lg m-1 inline-flex items-center justify-center md:hidden"
                />
              </Button>
            }
          />
        </div>
      </div>
      <div className="h-1.5 flex-shrink-0 max-md:h-2.5" aria-hidden="true" />
      {subHeaders != null ? subHeaders : null}
      {/* Section break: 6 + the container's 2px gap either side = the 10 the spec states,
          matching the two breaks above it. */}
      <div className="h-1.5 flex-shrink-0 max-md:h-2.5" aria-hidden="true" />
      <Link
        to="/c/new"
        state={{ focusChat: true }}
        onClick={clickHandler}
        data-testid="nav-new-chat-button"
        aria-label={localize('com_nav_new_chat')}
        className="flex h-[34px] max-md:h-[42px] w-full flex-shrink-0 items-center gap-[11px] max-md:gap-[14px] rounded-[8px] px-[9px] max-md:pl-1 text-[13.5px] leading-[20.25px] max-md:text-[14px] max-md:font-medium max-md:leading-[21px] text-text-primary transition-colors hover:bg-surface-hover dark:text-text-secondary max-md:dark:text-text-primary"
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
