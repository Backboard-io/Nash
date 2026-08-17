import React from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { TooltipAnchor, Button, NewChatIcon } from '@librechat/client';
import { OpenSidebar } from '~/components/Chat/Menus';
import { useChatContext } from '~/Providers';
import { clearMessagesCache } from '~/utils';
import { useLocalize } from '~/hooks';

export default function CollapsedNavRail({
  setNavVisible,
}: {
  setNavVisible: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { conversation, newConversation } = useChatContext();

  const handleNewChat: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      window.open('/c/new', '_blank');
      return;
    }
    clearMessagesCache(queryClient, conversation?.conversationId);
    queryClient.invalidateQueries([QueryKeys.messages]);
    newConversation();
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <OpenSidebar setNavVisible={setNavVisible} />
      <TooltipAnchor
        description={localize('com_ui_new_chat')}
        render={
          <Button
            size="icon"
            variant="ghost"
            data-testid="nav-rail-new-chat-button"
            aria-label={localize('com_ui_new_chat')}
            className="h-8 w-8 rounded-[8px] border-none bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary max-md:hidden"
            onClick={handleNewChat}
          >
            <NewChatIcon />
          </Button>
        }
      />
    </div>
  );
}
