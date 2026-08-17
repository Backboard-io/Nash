import { Suspense, useMemo, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { DelayedRender } from '@librechat/client';
import { ContentTypes } from 'librechat-data-provider';
import type {
  Agents,
  TMessage,
  TAttachment,
  SearchResultData,
  TMessageContentParts,
} from 'librechat-data-provider';
import { UnfinishedMessage } from './MessageContent';
import { ParallelContentRenderer } from './ParallelContent';
import Sources from '~/components/Web/Sources';
import { cn, mapAttachments } from '~/utils';
import { SearchContext } from '~/Providers';
import MarkdownLite from './MarkdownLite';
import store from '~/store';
import Part from './Part';

const SearchContent = ({
  message,
  attachments,
  searchResults,
}: {
  message: TMessage;
  attachments?: TAttachment[];
  searchResults?: { [key: string]: SearchResultData };
}) => {
  const enableUserMsgMarkdown = useRecoilValue(store.enableUserMsgMarkdown);
  const { messageId, conversationId } = message;

  const attachmentMap = useMemo(() => mapAttachments(attachments ?? []), [attachments]);

  const renderPart = useCallback(
    (part: TMessageContentParts, idx: number) => {
      const toolCallId = (part?.[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined)?.id ?? '';
      const partAttachments = attachmentMap[toolCallId];
      return (
        <Part
          key={`display-${messageId}-${idx}`}
          showCursor={false}
          isSubmitting={false}
          isCreatedByUser={message.isCreatedByUser}
          attachments={partAttachments}
          part={part}
        />
      );
    },
    [attachmentMap, messageId, message.isCreatedByUser],
  );

  if (Array.isArray(message.content) && message.content.length > 0) {
    // Parallel content (compare-mode: multiple models answering one
    // message) needs the dedicated column renderer — without this check,
    // a shared/public conversation view would fall through to the plain
    // sequential .map() below and render two different models' answers as
    // one merged, unattributed block instead of side-by-side columns with
    // per-model headers (matching what the live ChatView already does via
    // ContentParts.tsx).
    const hasParallelContent = message.content.some((part) => part?.groupId != null);
    if (hasParallelContent) {
      return (
        <SearchContext.Provider value={{ searchResults }}>
          <ParallelContentRenderer
            content={message.content}
            messageId={messageId}
            conversationId={conversationId}
            attachments={attachments}
            searchResults={searchResults}
            isSubmitting={false}
            renderPart={renderPart}
          />
          {message.unfinished === true && (
            <Suspense>
              <DelayedRender delay={250}>
                <UnfinishedMessage message={message} key={`unfinished-${messageId}`} />
              </DelayedRender>
            </Suspense>
          )}
        </SearchContext.Provider>
      );
    }

    return (
      <SearchContext.Provider value={{ searchResults }}>
        <Sources />
        {message.content
          .filter((part: TMessageContentParts | undefined) => part)
          .map((part: TMessageContentParts | undefined, idx: number) => {
            if (!part) {
              return null;
            }
            return renderPart(part, idx);
          })}
        {message.unfinished === true && (
          <Suspense>
            <DelayedRender delay={250}>
              <UnfinishedMessage message={message} key={`unfinished-${messageId}`} />
            </DelayedRender>
          </Suspense>
        )}
      </SearchContext.Provider>
    );
  }

  return (
    <div
      className={cn(
        'markdown prose dark:prose-invert light w-full break-words',
        message.isCreatedByUser && !enableUserMsgMarkdown && 'whitespace-pre-wrap',
        message.isCreatedByUser ? 'dark:text-gray-20' : 'dark:text-gray-70',
      )}
      dir="auto"
    >
      <MarkdownLite content={message.text || ''} />
    </div>
  );
};

export default SearchContent;
