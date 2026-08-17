import { memo, useMemo, ReactElement } from 'react';
import { useRecoilValue } from 'recoil';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import Markdown from '~/components/Chat/Messages/Content/Markdown';
import useProgressiveText from '~/hooks/useProgressiveText';
import { useMessageContext } from '~/Providers';
import { cn } from '~/utils';
import store from '~/store';

type TextPartProps = {
  text: string;
  showCursor: boolean;
  isCreatedByUser: boolean;
};

type ContentType =
  | ReactElement<React.ComponentProps<typeof Markdown>>
  | ReactElement<React.ComponentProps<typeof MarkdownLite>>
  | ReactElement;

const TextPart = memo(({ text, isCreatedByUser, showCursor }: TextPartProps) => {
  const { isSubmitting = false, isLatestMessage = false } = useMessageContext();
  const enableUserMsgMarkdown = useRecoilValue(store.enableUserMsgMarkdown);
  const showCursorState = useMemo(() => showCursor && isSubmitting, [showCursor, isSubmitting]);

  const isAssistantStreaming = !isCreatedByUser && isSubmitting && isLatestMessage;
  const displayText = useProgressiveText(text, isAssistantStreaming);

  const content: ContentType = useMemo(() => {
    if (!isCreatedByUser) {
      return <Markdown content={displayText} isLatestMessage={isLatestMessage} />;
    } else if (enableUserMsgMarkdown) {
      return <MarkdownLite content={displayText} />;
    } else {
      return <>{displayText}</>;
    }
  }, [isCreatedByUser, enableUserMsgMarkdown, displayText, isLatestMessage]);

  return (
    <div
      className={cn(
        isSubmitting ? 'submitting' : '',
        showCursorState && !!text.length ? 'result-streaming' : '',
        'markdown prose message-content dark:prose-invert light break-words text-text-primary',
        isCreatedByUser ? 'max-w-full' : 'w-full',
        isCreatedByUser && !enableUserMsgMarkdown && 'whitespace-pre-wrap',
      )}
    >
      {content}
    </div>
  );
});

export default TextPart;
