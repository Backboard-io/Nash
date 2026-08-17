import { useEffect } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { TooltipAnchor } from '@librechat/client';
import { Constants, Tools } from 'librechat-data-provider';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import store, { ephemeralAgentByConvoId } from '~/store';
import { cn } from '~/utils';

/** Figma icon/tempChat — speech bubble with clock hands (exported vector, not in lucide). */
function TempChatIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M14.875 8.14585C14.8687 9.16222 14.6052 10.1605 14.1091 11.0475C13.613 11.9346 12.9004 12.6817 12.0377 13.2191C11.1751 13.7565 10.1904 14.0668 9.17541 14.121C8.16047 14.1752 7.14833 13.9716 6.23329 13.5292L2.47913 14.5208L3.47079 10.8375C3.06387 10.0251 2.84611 9.13105 2.83384 8.22248C2.82158 7.3139 3.01512 6.41433 3.39996 5.5912C3.7848 4.76806 4.35096 4.0427 5.05601 3.4695C5.76106 2.89629 6.5867 2.4901 7.47106 2.28137C8.35542 2.07264 9.27556 2.06678 10.1625 2.26424C11.0494 2.4617 11.8802 2.85735 12.5925 3.42154C13.3048 3.98572 13.8801 4.70381 14.2754 5.52199C14.6707 6.34016 14.8757 7.23719 14.875 8.14585Z"
        stroke="currentColor"
        strokeWidth="1.41667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 4.95831V7.79165L10.2708 8.85415"
        stroke="currentColor"
        strokeWidth="1.41667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * ChatGPT-style temporary chat toggle (dashed speech bubble) in the composer.
 * While on: memory is off and the backend persists nothing to DynamoDB.
 * Toggling while the current conversation already has messages starts a fresh
 * chat in the new mode — an existing conversation can't change nature mid-way.
 */
export default function TemporaryChatToggle() {
  const localize = useLocalize();
  const [isTemporary, setIsTemporary] = useRecoilState(store.isTemporary);
  const { conversation, isSubmitting, newConversation } = useChatContext();
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const setEphemeralAgent = useSetRecoilState(ephemeralAgentByConvoId(conversationId));

  const hasMessages = Array.isArray(conversation?.messages) && conversation.messages.length >= 1;

  useEffect(() => {
    if (!isTemporary) {
      return;
    }
    setEphemeralAgent((prev) => ({
      ...(prev || {}),
      [Tools.memory]: 'Off',
    }));
  }, [isTemporary, setEphemeralAgent]);

  const label = isTemporary
    ? localize('com_ui_temporary_off')
    : localize('com_ui_temporary_on');

  const handleToggle = () => {
    setIsTemporary(!isTemporary);
    if (hasMessages) {
      newConversation();
    }
  };

  return (
    <TooltipAnchor
      description={label}
      render={
        <button
          type="button"
          onClick={handleToggle}
          disabled={isSubmitting}
          aria-label={label}
          aria-pressed={isTemporary}
          className={cn(
            'inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full transition-colors',
            isTemporary
              ? 'bg-brand-purple/15 text-brand-purple hover:bg-brand-purple/25'
              : 'bg-surface-active text-text-secondary hover:bg-surface-active-alt',
          )}
        >
          <TempChatIcon size={17} />
        </button>
      }
    />
  );
}
