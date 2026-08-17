import { memo, Suspense, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import { DelayedRender } from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import type { TMessageContentProps, TDisplayProps } from '~/common';
import Error from '~/components/Messages/Content/Error';
import { useMessageContext } from '~/Providers';
import MarkdownLite from './MarkdownLite';
import EditMessage from './EditMessage';
import Thinking from './Parts/Thinking';
import GeneratedMedia from './GeneratedMedia';
import GeneratingImagePlaceholder from './GeneratingImagePlaceholder';
import ToolStatusIndicator from './ToolStatusIndicator';
import { useLocalize } from '~/hooks';
import Container from './Container';
import Markdown from './Markdown';
import { cn } from '~/utils';
import store from '~/store';

const ERROR_CONNECTION_TEXT = 'Error connecting to server, try refreshing the page.';
const DELAYED_ERROR_TIMEOUT = 5500;
const UNFINISHED_DELAY = 250;

const parseThinkingContent = (text: string) => {
  const thinkingMatch = text.match(/:::thinking([\s\S]*?):::/);
  return {
    thinkingContent: thinkingMatch ? thinkingMatch[1].trim() : '',
    regularContent: thinkingMatch ? text.replace(/:::thinking[\s\S]*?:::/, '').trim() : text,
  };
};

const LoadingFallback = () => (
  <div className="text-message mb-[0.625rem] flex min-h-[20px] flex-col items-start gap-3 overflow-visible">
    <div className="markdown prose dark:prose-invert light w-full break-words dark:text-gray-100">
      <div className="absolute">
        <p className="submitting relative">
          <span className="result-thinking" />
        </p>
      </div>
    </div>
  </div>
);

const ErrorBox = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    role="alert"
    aria-live="assertive"
    className={cn(
      'flex w-full items-start gap-2.5 rounded-[10px] px-3.5 py-3',
      'bg-surface-destructive-subtle text-[13px] leading-[19.5px] text-text-destructive ',
      className,
    )}
  >
    <AlertCircle className="mt-px h-[18px] w-[18px] shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

const ConnectionError = ({ message }: { message?: TMessage }) => {
  const localize = useLocalize();

  return (
    <Suspense fallback={<LoadingFallback />}>
      <DelayedRender delay={DELAYED_ERROR_TIMEOUT}>
        <Container message={message}>
          <ErrorBox className="mt-2">{localize('com_ui_error_connection')}</ErrorBox>
        </Container>
      </DelayedRender>
    </Suspense>
  );
};

export const ErrorMessage = ({
  text,
  message,
  className = '',
}: Pick<TDisplayProps, 'text' | 'className'> & { message?: TMessage }) => {
  if (text === ERROR_CONNECTION_TEXT) {
    return <ConnectionError message={message} />;
  }

  return (
    <Container message={message}>
      <ErrorBox className={className}>
        <Error text={text} />
      </ErrorBox>
    </Container>
  );
};

const DisplayMessage = ({ text, isCreatedByUser, message, showCursor }: TDisplayProps) => {
  const { isSubmitting = false, isLatestMessage = false } = useMessageContext();
  const enableUserMsgMarkdown = useRecoilValue(store.enableUserMsgMarkdown);

  const showCursorState = useMemo(
    () => showCursor === true && isSubmitting,
    [showCursor, isSubmitting],
  );

  const content = useMemo(() => {
    if (!isCreatedByUser) {
      return <Markdown content={text} isLatestMessage={isLatestMessage} />;
    }
    if (enableUserMsgMarkdown) {
      return <MarkdownLite content={text} />;
    }
    return <>{text}</>;
  }, [isCreatedByUser, enableUserMsgMarkdown, text, isLatestMessage]);

  /* An uncaptioned attachment renders as the bubble's files alone — an empty
   * text body would just add a blank line under the image. A reply keeps its
   * body even while empty: that div carries the streaming cursor. */
  const hasTextBody = text.length > 0 || !isCreatedByUser;

  return (
    <Container message={message} isCreatedByUser={isCreatedByUser}>
      {hasTextBody && (
        <div
          className={cn(
            'markdown prose message-content dark:prose-invert light break-words text-text-primary',
            isCreatedByUser ? 'max-w-full' : 'w-full',
            isSubmitting && 'submitting',
            showCursorState && text.length > 0 && 'result-streaming',
            isCreatedByUser && !enableUserMsgMarkdown && 'whitespace-pre-wrap',
          )}
        >
          {content}
        </div>
      )}
    </Container>
  );
};

export const UnfinishedMessage = ({ message }: { message: TMessage }) => (
  <ErrorMessage
    message={message}
    text="The response is incomplete; it's either still processing, was cancelled, or censored. Refresh or try a different prompt."
  />
);

const MessageContent = ({
  text,
  edit,
  error,
  unfinished,
  isSubmitting,
  isLast,
  ...props
}: TMessageContentProps) => {
  const { message } = props;
  const { messageId } = message;

  const { thinkingContent, regularContent } = useMemo(() => parseThinkingContent(text), [text]);
  const showRegularCursor = useMemo(() => isLast && isSubmitting, [isLast, isSubmitting]);

  const unfinishedMessage = useMemo(
    () =>
      !isSubmitting && unfinished ? (
        <Suspense>
          <DelayedRender delay={UNFINISHED_DELAY}>
            <UnfinishedMessage message={message} />
          </DelayedRender>
        </Suspense>
      ) : null,
    [isSubmitting, unfinished, message],
  );

  if (error) {
    return <ErrorMessage message={message} text={text} />;
  }

  if (edit) {
    return <EditMessage text={text} isSubmitting={isSubmitting} {...props} />;
  }

  const showOnlyGeneratingPlaceholder =
    !message.isCreatedByUser && regularContent.length === 0 && isLast && isSubmitting;
  /* A sent message with attachments but no caption still has to render. `Files`
   * lives inside `Container`, which lives inside `DisplayMessage`, so skipping
   * the message here hides the attachment itself — the image only reappeared on
   * reload, once the server had backfilled an "Uploaded 1 file(s)" caption that
   * made the text non-empty. `DisplayMessage` drops the empty text body instead. */
  const shouldRenderDisplayMessage = !showOnlyGeneratingPlaceholder;

  return (
    <>
      {thinkingContent.length > 0 && (
        <Thinking key={`thinking-${messageId}`}>{thinkingContent}</Thinking>
      )}
      {shouldRenderDisplayMessage && (
        <DisplayMessage
          key={`display-${messageId}`}
          showCursor={showRegularCursor}
          text={regularContent}
          {...props}
        />
      )}
      <GeneratedMedia message={message} />
      <GeneratingImagePlaceholder message={message} />
      {/* Only while no reply text has streamed yet — keeps the status transient. */}
      {showOnlyGeneratingPlaceholder && <ToolStatusIndicator message={message} />}
      {unfinishedMessage}
    </>
  );
};

export default memo(MessageContent);
