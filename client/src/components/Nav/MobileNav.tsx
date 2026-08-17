import React from 'react';
import { useMatch } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useMediaQuery } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { Dispatch, SetStateAction } from 'react';
import { ChatContext, AddedChatContext } from '~/Providers';
import { ChatMenu } from '~/components/Chat/Menus';
import useExportShareMenuItems from '~/components/Chat/ExportAndShareMenu';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize, useHasAccess, useChatHelpers, useAddedResponse } from '~/hooks';

function MobileChatMenu({ paramId }: { paramId?: string }) {
  const { data: startupConfig } = useGetStartupConfig();

  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });

  const hasAccessToMultiConvo = useHasAccess({
    permissionType: PermissionTypes.MULTI_CONVO,
    permission: Permissions.USE,
  });

  const chatHelpers = useChatHelpers(0, paramId);
  const addedChatHelpers = useAddedResponse();

  const { items: exportShareItems, dialogs: exportShareDialogs } = useExportShareMenuItems({
    isSharedButtonEnabled: startupConfig?.sharedLinksEnabled ?? false,
  });

  return (
    <ChatContext.Provider value={chatHelpers}>
      <AddedChatContext.Provider value={addedChatHelpers}>
        <ChatMenu
          renameHandler={() => {}}
          hasAccessToBookmarks={hasAccessToBookmarks}
          hasAccessToMultiConvo={hasAccessToMultiConvo}
          prependItems={exportShareItems}
        />
        {exportShareDialogs}
      </AddedChatContext.Provider>
    </ChatContext.Provider>
  );
}

export default function MobileNav({
  setNavVisible,
  navVisible,
}: {
  navVisible: boolean;
  setNavVisible: Dispatch<SetStateAction<boolean>>;
}) {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const chatMatch = useMatch('/c/:conversationId');

  if (!isSmallScreen) {
    return null;
  }

  return (
    <div className="sticky top-0 z-10 flex h-12 flex-shrink-0 items-center justify-between bg-surface-primary px-5 md:hidden">
      <button
        type="button"
        data-testid="mobile-header-new-chat-button"
        aria-label={
          navVisible ? localize('com_nav_close_sidebar') : localize('com_nav_open_sidebar')
        }
        aria-live="polite"
        className="-ml-2.5 inline-flex size-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-active-alt"
        onClick={() =>
          setNavVisible((prev) => {
            localStorage.setItem('navVisible', JSON.stringify(!prev));
            return !prev;
          })
        }
      >
        <span className="sr-only">
          {navVisible ? localize('com_nav_close_sidebar') : localize('com_nav_open_sidebar')}
        </span>
        <Menu size={20} aria-hidden="true" />
      </button>
      <span className="pointer-events-none absolute inset-x-0 text-center text-[17px] font-medium leading-[25.5px] text-text-primary">
        Nash
      </span>
      <div className="-mr-[9px] flex items-center">
        {chatMatch != null && <MobileChatMenu paramId={chatMatch.params.conversationId} />}
      </div>
    </div>
  );
}
