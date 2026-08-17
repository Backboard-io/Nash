import React from 'react';
import { useRecoilValue } from 'recoil';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { TMessageProps } from '~/common';
import { useMessageHelpers, useLocalize, useAttachments, useContentMetadata } from '~/hooks';
import MessageModelLabel from './MessageModelLabel';
import ContentParts from './Content/ContentParts';
import SiblingSwitch from './SiblingSwitch';
import MultiMessage from './MultiMessage';
import HoverButtons from './HoverButtons';
import SubRow from './SubRow';
import { cn, getMessageAriaLabel } from '~/utils';
import store from '~/store';

export default function Message(props: TMessageProps) {
  const localize = useLocalize();
  const { message, siblingIdx, siblingCount, setSiblingIdx, currentEditId, setCurrentEditId } =
    props;
  const { attachments, searchResults } = useAttachments({
    messageId: message?.messageId,
    attachments: message?.attachments,
  });
  const {
    edit,
    index,
    isLast,
    enterEdit,
    handleScroll,
    conversation,
    isSubmitting,
    latestMessage,
    handleContinue,
    copyToClipboard,
    regenerateMessage,
  } = useMessageHelpers(props);

  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const { children, messageId = null, isCreatedByUser } = message ?? {};

  const { hasParallelContent } = useContentMetadata(message);

  if (!message) {
    return null;
  }

  const getChatWidthClass = () => {
    if (maximizeChatSpace) {
      return 'w-full max-w-full md:px-5 lg:px-1 xl:px-5';
    }
    if (hasParallelContent) {
      return 'md:max-w-[58rem] xl:max-w-[70rem]';
    }
    return 'md:max-w-[920px]';
  };

  const baseClasses = {
    common: 'group mx-auto flex flex-1 gap-3 transition-all duration-swap transform-gpu',
    chat: getChatWidthClass(),
  };

  return (
    <>
      <div
        className="w-full border-0 bg-transparent dark:border-0 dark:bg-transparent"
        onWheel={handleScroll}
        onTouchMove={handleScroll}
      >
        <div className="m-auto justify-center p-4 py-2 md:gap-6">
          <div
            id={messageId ?? ''}
            aria-label={getMessageAriaLabel(message, localize)}
            className={cn(
              baseClasses.common,
              baseClasses.chat,
              'message-render',
              isCreatedByUser && 'justify-end',
            )}
          >
            <div
              className={cn(
                'relative flex w-full flex-col',
                isCreatedByUser ? 'user-turn' : 'agent-turn',
              )}
            >
              <div className="flex flex-col gap-0">
            <MessageModelLabel message={message} conversation={conversation ?? null} />
                <div className="flex max-w-full flex-grow flex-col gap-0">
                  <ContentParts
                    edit={edit}
                    isLast={isLast}
                    enterEdit={enterEdit}
                    siblingIdx={siblingIdx}
                    attachments={attachments}
                    isSubmitting={isSubmitting}
                    searchResults={searchResults}
                    messageId={message.messageId}
                    setSiblingIdx={setSiblingIdx}
                    isCreatedByUser={message.isCreatedByUser}
                    conversationId={conversation?.conversationId}
                    isLatestMessage={messageId === latestMessage?.messageId}
                    content={message.content as Array<TMessageContentParts | undefined>}
                  />
                </div>
                {isLast && isSubmitting ? (
                  <div className="mt-1 h-[27px] bg-transparent" />
                ) : (
                  <SubRow classes={cn('mt-3 text-xs', isCreatedByUser && 'justify-end')}>
                    <SiblingSwitch
                      siblingIdx={siblingIdx}
                      siblingCount={siblingCount}
                      setSiblingIdx={setSiblingIdx}
                    />
                    <HoverButtons
                      index={index}
                      isEditing={edit}
                      message={message}
                      enterEdit={enterEdit}
                      isSubmitting={isSubmitting}
                      conversation={conversation ?? null}
                      regenerate={() => regenerateMessage()}
                      copyToClipboard={copyToClipboard}
                      handleContinue={handleContinue}
                      latestMessage={latestMessage}
                      isLast={isLast}
                    />
                  </SubRow>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <MultiMessage
        key={messageId}
        messageId={messageId}
        conversation={conversation}
        messagesTree={children ?? []}
        currentEditId={currentEditId}
        setCurrentEditId={setCurrentEditId}
      />
    </>
  );
}
