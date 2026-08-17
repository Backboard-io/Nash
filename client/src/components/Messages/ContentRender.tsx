import { useCallback, useMemo, memo } from 'react';
import { useRecoilValue } from 'recoil';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';
import type { TMessageProps } from '~/common';
import { useAttachments, useLocalize, useMessageActions, useContentMetadata } from '~/hooks';
import ContentParts from '~/components/Chat/Messages/Content/ContentParts';
import MessageModelLabel from '~/components/Chat/Messages/MessageModelLabel';
import PlaceholderRow from '~/components/Chat/Messages/ui/PlaceholderRow';
import SiblingSwitch from '~/components/Chat/Messages/SiblingSwitch';
import HoverButtons from '~/components/Chat/Messages/HoverButtons';
import SubRow from '~/components/Chat/Messages/SubRow';
import { cn, getMessageAriaLabel } from '~/utils';
import store from '~/store';

type ContentRenderProps = {
  message?: TMessage;
  isSubmitting?: boolean;
} & Pick<
  TMessageProps,
  'currentEditId' | 'setCurrentEditId' | 'siblingIdx' | 'setSiblingIdx' | 'siblingCount'
>;

const ContentRender = memo(
  ({
    message: msg,
    siblingIdx,
    siblingCount,
    setSiblingIdx,
    currentEditId,
    setCurrentEditId,
    isSubmitting = false,
  }: ContentRenderProps) => {
    const localize = useLocalize();
    const { attachments, searchResults } = useAttachments({
      messageId: msg?.messageId,
      attachments: msg?.attachments,
    });
    const {
      edit,
      index,
      enterEdit,
      conversation,
      latestMessage,
      handleContinue,
      handleFeedback,
      copyToClipboard,
      regenerateMessage,
    } = useMessageActions({
      message: msg,
      searchResults,
      currentEditId,
      setCurrentEditId,
    });
    const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

    const handleRegenerateMessage = useCallback(() => regenerateMessage(), [regenerateMessage]);
    const isLast = useMemo(
      () =>
        !(msg?.children?.length ?? 0) && (msg?.depth === latestMessage?.depth || msg?.depth === -1),
      [msg?.children, msg?.depth, latestMessage?.depth],
    );
    const hasNoChildren = !(msg?.children?.length ?? 0);
    const isLatestMessage = msg?.messageId === latestMessage?.messageId;
    // The rendered branch's leaf is authoritative while a response is active.
    // latestMessage can be transiently reset by the SSE `created` event, so
    // using it alone briefly exposes the completed-message action row.
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
        return 'md:max-w-[58rem] xl:max-w-[70rem]';
      }
      /* Must match MessageRender/MessageParts. A message swaps between those
         renderers and this one depending on whether it carries content parts
         (live turns do, reloaded plain replies don't), so any width difference
         shows up as the whole column — and the ml-auto model label with it —
         jumping sideways when you revisit a chat. */
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
              <ContentParts
                edit={edit}
                isLast={isLast}
                enterEdit={enterEdit}
                siblingIdx={siblingIdx}
                messageId={msg.messageId}
                attachments={attachments}
                searchResults={searchResults}
                setSiblingIdx={setSiblingIdx}
                isLatestMessage={isLatestMessage}
                isSubmitting={effectiveIsSubmitting}
                isCreatedByUser={msg.isCreatedByUser}
                conversationId={conversation?.conversationId}
                content={msg.content as Array<TMessageContentParts | undefined>}
              />
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
                  message={msg}
                  isEditing={edit}
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

export default ContentRender;
