import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { TextareaAutosize } from '@librechat/client';
import { ContentTypes } from 'librechat-data-provider';
import { Lightbulb, MessageSquare } from 'lucide-react';
import type { Agents } from 'librechat-data-provider';
import type { TEditProps } from '~/common';
import { useMessagesOperations, useMessagesConversation } from '~/Providers';
import Container from '~/components/Chat/Messages/Content/Container';
import { useGetAddedConvo } from '~/hooks/Chat';
import { cn, removeFocusRings } from '~/utils';
import { primaryAction, ghostAction } from '~/components/ui/actionButton';
import { useLocalize } from '~/hooks';
import store from '~/store';

const EditTextPart = ({
  part,
  index,
  messageId,
  isSubmitting,
  enterEdit,
}: Omit<TEditProps, 'message' | 'ask' | 'text'> & {
  index: number;
  messageId: string;
  part: Agents.MessageContentText | Agents.ReasoningDeltaUpdate;
}) => {
  const localize = useLocalize();
  const { conversation } = useMessagesConversation();
  const { ask, getMessages } = useMessagesOperations();

  const { conversationId = '' } = conversation ?? {};
  const message = useMemo(
    () => getMessages()?.find((msg) => msg.messageId === messageId),
    [getMessages, messageId],
  );

  const chatDirection = useRecoilValue(store.chatDirection);

  const getAddedConvo = useGetAddedConvo();

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const isRTL = chatDirection?.toLowerCase() === 'rtl';

  const { register, handleSubmit, setValue } = useForm({
    defaultValues: {
      text: (ContentTypes.THINK in part ? part.think : part.text) || '',
    },
  });

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (textArea) {
      const length = textArea.value.length;
      textArea.focus();
      textArea.setSelectionRange(length, length);
    }
  }, []);

  const resubmitMessage = (data: { text: string }) => {
    const messages = getMessages();
    const parentMessage = messages?.find((msg) => msg.messageId === message?.parentMessageId);

    const editedContent =
      part.type === ContentTypes.THINK
        ? {
            index,
            type: ContentTypes.THINK as const,
            [ContentTypes.THINK]: data.text,
          }
        : {
            index,
            type: ContentTypes.TEXT as const,
            [ContentTypes.TEXT]: data.text,
          };

    if (!parentMessage) {
      return;
    }
    ask(
      { ...parentMessage },
      {
        editedContent,
        editedMessageId: messageId,
        isRegenerate: true,
        isEdited: true,
        addedConvo: getAddedConvo() || undefined,
      },
    );

    enterEdit(true);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        enterEdit(true);
      }
    },
    [enterEdit],
  );

  const { ref, ...registerProps } = register('text', {
    required: true,
    onChange: (e) => {
      setValue('text', e.target.value, { shouldValidate: true });
    },
  });

  return (
    <Container message={message}>
      {part.type === ContentTypes.THINK && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
          <span className="flex gap-2 rounded-lg bg-surface-tertiary px-1.5 py-1 font-medium">
            <Lightbulb className="size-3.5" aria-hidden="true" />
            {localize('com_ui_thoughts')}
          </span>
        </div>
      )}
      {part.type !== ContentTypes.THINK && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
          <span className="flex gap-2 rounded-lg bg-surface-tertiary px-1.5 py-1 font-medium">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {localize('com_ui_response')}
          </span>
        </div>
      )}
      {/* One filled card holding the message and its actions, rather than an
          outlined box with three buttons floating underneath it. The actions
          belong to the text they act on, so they sit inside it. */}
      <div className="relative flex w-full flex-grow flex-col overflow-hidden rounded-[20px] bg-surface-secondary pb-2 text-text-primary">
        <TextareaAutosize
          {...registerProps}
          ref={(e) => {
            ref(e);
            textAreaRef.current = e;
          }}
          onKeyDown={handleKeyDown}
          data-testid="message-text-editor"
          className={cn(
            'markdown prose dark:prose-invert light whitespace-pre-wrap break-words pl-3 md:pl-4',
            'm-0 w-full resize-none border-0 bg-transparent py-[10px]',
            'placeholder-text-secondary focus:ring-0 focus-visible:ring-0 md:py-3.5',
            isRTL ? 'text-right' : 'text-left',
            'max-h-[65vh] pr-3 md:max-h-[75vh] md:pr-4',
            removeFocusRings,
          )}
          aria-label={localize('com_ui_editable_message')}
          dir={isRTL ? 'rtl' : 'ltr'}
        />
        {/* Cancel and Send. There used to be a third — "Save", which edited
            the message without asking again — but two buttons both beginning
            "Save" read as one action beside a variant of itself, and the
            distinction was not worth the confusion. Editing a message now
            always asks again, which is what people expect it to do. */}
        <div className="flex items-center justify-end gap-2 px-3 pb-1 md:px-4">
          <button
            type="button"
            className={cn(ghostAction, 'h-[34px] px-[14px]')}
            onClick={() => enterEdit(true)}
          >
            {localize('com_ui_cancel')}
          </button>
          <button
            type="button"
            className={cn(primaryAction, 'h-[34px] px-[14px]')}
            disabled={isSubmitting}
            onClick={handleSubmit(resubmitMessage)}
          >
            {localize('com_ui_save_resend')}
          </button>
        </div>
      </div>
    </Container>
  );
};

export default EditTextPart;
