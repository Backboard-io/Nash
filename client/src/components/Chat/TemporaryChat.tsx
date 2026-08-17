import React, { useEffect } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { Constants, Tools } from 'librechat-data-provider';
import { MessageCircleDashed } from 'lucide-react';
import { useRecoilState, useRecoilCallback, useSetRecoilState } from 'recoil';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store, { ephemeralAgentByConvoId } from '~/store';

export function TemporaryChat() {
  const localize = useLocalize();
  const [isTemporary, setIsTemporary] = useRecoilState(store.isTemporary);
  const { conversation, isSubmitting } = useChatContext();
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const setEphemeralAgent = useSetRecoilState(ephemeralAgentByConvoId(conversationId));

  const temporaryBadge = {
    id: 'temporary',
    atom: store.isTemporary,
    isAvailable: true,
  };

  const handleBadgeToggle = useRecoilCallback(
    () => () => {
      setIsTemporary(!isTemporary);
    },
    [isTemporary],
  );

  useEffect(() => {
    if (!isTemporary) {
      return;
    }

    setEphemeralAgent((prev) => ({
      ...(prev || {}),
      [Tools.memory]: 'Off',
    }));
  }, [isTemporary, setEphemeralAgent]);

  if (
    (Array.isArray(conversation?.messages) && conversation.messages.length >= 1) ||
    isSubmitting
  ) {
    return null;
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <TooltipAnchor
        description={localize('com_ui_temporary')}
        render={
          <button
            onClick={handleBadgeToggle}
            aria-label={localize('com_ui_temporary')}
            aria-pressed={isTemporary}
            className={cn(
              'inline-flex size-10 flex-shrink-0 items-center justify-center rounded-xl border border-border-light text-text-primary transition-all ease-in-out',
              isTemporary
                ? 'bg-surface-active'
                : 'bg-presentation shadow-sm hover:bg-surface-active-alt',
            )}
          >
            <MessageCircleDashed className="icon-lg" aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}
