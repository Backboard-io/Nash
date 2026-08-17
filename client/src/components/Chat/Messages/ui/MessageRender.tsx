import React, { useCallback, useMemo, memo } from 'react';
import { useRecoilValue } from 'recoil';
import { type TMessage } from 'librechat-data-provider';
import type { TMessageProps } from '~/common';
import MessageContent from '~/components/Chat/Messages/Content/MessageContent';
import MessageModelLabel from '~/components/Chat/Messages/MessageModelLabel';
import PlaceholderRow from '~/components/Chat/Messages/ui/PlaceholderRow';
import SiblingSwitch from '~/components/Chat/Messages/SiblingSwitch';
import HoverButtons from '~/components/Chat/Messages/HoverButtons';
import { useLocalize, useMessageActions, useContentMetadata } from '~/hooks';
import SubRow from '~/components/Chat/Messages/SubRow';
import { cn, getMessageAriaLabel } from '~/utils';
import { MessageContext } from '~/Providers';
import store from '~/store';

type MessageRenderProps = {
  message?: TMessage;
  isSubmitting?: boolean;
} & Pick<
  TMessageProps,
  'currentEditId' | 'setCurrentEditId' | 'siblingIdx' | 'setSiblingIdx' | 'siblingCount'
>;

const MessageRender = memo(
  ({
    message: msg,
    siblingIdx,
    siblingCount,
    setSiblingIdx,
    currentEditId,
    setCurrentEditId,
    isSubmitting = false,
  }: MessageRenderProps) => {
    const localize = useLocalize();
    const {
      ask,
      edit,
      index,
      enterEdit,
      conversation,
      latestMessage,
      handleFeedback,
      handleContinue,
      copyToClipboard,
      regenerateMessage,
    } = useMessageActions({
      message: msg,
      currentEditId,
      setCurrentEditId,
    });
    const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

    const handleRegenerateMessage = useCallback(() => regenerateMessage(), [regenerateMessage]);
    const hasNoChildren = !(msg?.children?.length ?? 0);
    const isLast = useMemo(
      () => hasNoChildren && (msg?.depth === latestMessage?.depth || msg?.depth === -1),
      [hasNoChildren, msg?.depth, latestMessage?.depth],
    );
    const isLatestMessage = msg?.messageId === latestMessage?.messageId;
    // The active branch's leaf is the message currently receiving the response.
    // Do not rely solely on latestMessage here: that Recoil value is briefly
    // reset during the SSE `created` handoff, which made an empty in-progress
    // assistant message render completed-message actions and a model label.
    const effectiveIsSubmitting = hasNoChildren ? isSubmitting : false;

    const { hasParallelContent } = useContentMetadata(msg);

    if (!msg) {
      return null;
    }

    const getChatWidthClass = () => {
      if (maximizeChatSpace) {
        return 'w-full max-w-full md:px-5 lg:px-1 xl:px-5';
      }
      if (hasParallelContent) {
        /* Figma thread column: 768 outer, 720 of text once the gutter is off. */
      return 'md:max-w-[768px]';
      }
      return 'md:max-w-[920px]';
    };

    const baseClasses = {
      common: 'group mx-auto flex flex-1 gap-3 transition-all duration-swap transform-gpu ',
      chat: getChatWidthClass(),
    };

    const conditionalClasses = {
      focus: 'focus:outline-none focus:ring-2 focus:ring-border-xheavy',
    };

    return (
      <div
        id={msg.messageId}
        aria-label={getMessageAriaLabel(msg, localize)}
        className={cn(
          baseClasses.common,
          baseClasses.chat,
          conditionalClasses.focus,
          'message-render',
          msg.isCreatedByUser && 'justify-end',
        )}
      >
        <div
          className={cn(
            'relative flex w-full flex-col',
            msg.isCreatedByUser ? 'user-turn' : 'agent-turn',
          )}
        >
          <div className="flex flex-col gap-0">
            <MessageModelLabel message={msg} conversation={conversation ?? null} />
            <div className="flex max-w-full flex-grow flex-col gap-0">
              <MessageContext.Provider
                value={{
                  messageId: msg.messageId,
                  conversationId: conversation?.conversationId,
                  isExpanded: false,
                  isSubmitting: effectiveIsSubmitting,
                  isLatestMessage,
                }}
              >
                <MessageContent
                  ask={ask}
                  edit={edit}
                  isLast={isLast}
                  text={msg.text || ''}
                  message={msg}
                  enterEdit={enterEdit}
                  error={!!(msg.error ?? false)}
                  isSubmitting={effectiveIsSubmitting}
                  unfinished={msg.unfinished ?? false}
                  isCreatedByUser={msg.isCreatedByUser ?? true}
                  siblingIdx={siblingIdx ?? 0}
                  setSiblingIdx={setSiblingIdx ?? (() => ({}))}
                />
              </MessageContext.Provider>
            </div>
            {hasNoChildren && effectiveIsSubmitting ? (
              <PlaceholderRow />
            ) : (
              <SubRow classes={cn('mt-3 text-xs', msg.isCreatedByUser && 'justify-end')}>
                <SiblingSwitch
                  siblingIdx={siblingIdx}
                  siblingCount={siblingCount}
                  setSiblingIdx={setSiblingIdx}
                />
                <HoverButtons
                  index={index}
                  isEditing={edit}
                  message={msg}
                  enterEdit={enterEdit}
                  isSubmitting={isSubmitting}
                  conversation={conversation ?? null}
                  regenerate={handleRegenerateMessage}
                  copyToClipboard={copyToClipboard}
                  handleContinue={handleContinue}
                  latestMessage={latestMessage}
                  handleFeedback={handleFeedback}
                  isLast={isLast}
                />
              </SubRow>
            )}
          </div>
        </div>
      </div>
    );
  },
);

export default MessageRender;
