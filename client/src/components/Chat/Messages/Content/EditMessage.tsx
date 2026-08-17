import { useRef, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { useRecoilValue } from 'recoil';
import { TextareaAutosize, TooltipAnchor } from '@librechat/client';
import type { TEditProps } from '~/common';
import { useMessagesOperations, useMessagesConversation } from '~/Providers';
import { useGetAddedConvo } from '~/hooks/Chat';
import { cn, removeFocusRings } from '~/utils';
import { primaryAction, ghostAction } from '~/components/ui/actionButton';
import { useLocalize } from '~/hooks';
import Container from './Container';
import store from '~/store';

const EditMessage = ({
  text,
  message,
  isSubmitting,
  ask,
  enterEdit,
  siblingIdx,
  setSiblingIdx,
}: TEditProps) => {
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const { conversation } = useMessagesConversation();
  const { getMessages, setMessages } = useMessagesOperations();

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const { conversationId, parentMessageId, messageId } = message;
  const localize = useLocalize();

  const chatDirection = useRecoilValue(store.chatDirection).toLowerCase();
  const isRTL = chatDirection === 'rtl';

  const getAddedConvo = useGetAddedConvo();

  const { register, handleSubmit, setValue } = useForm({
    defaultValues: {
      text: text ?? '',
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
    if (message.isCreatedByUser) {
      ask(
        {
          text: data.text,
          parentMessageId,
          conversationId,
        },
        {
          overrideFiles: message.files,
          addedConvo: getAddedConvo() || undefined,
        },
      );

      setSiblingIdx((siblingIdx ?? 0) - 1);
    } else {
      const messages = getMessages();
      const parentMessage = messages?.find((msg) => msg.messageId === parentMessageId);

      if (!parentMessage) {
        return;
      }
      ask(
        { ...parentMessage },
        {
          editedText: data.text,
          editedMessageId: messageId,
          isRegenerate: true,
          isEdited: true,
          addedConvo: getAddedConvo() || undefined,
        },
      );

      setSiblingIdx((siblingIdx ?? 0) - 1);
    }

    enterEdit(true);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitButtonRef.current?.click();
      }
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
      {/* Same card as EditTextPart — the two edit surfaces must not diverge. */}
      <div className="relative mt-2 flex w-full flex-grow flex-col overflow-hidden rounded-[20px] bg-surface-secondary pb-2 text-text-primary">
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
          aria-label={localize('com_ui_message_input')}
          dir={isRTL ? 'rtl' : 'ltr'}
        />
        {/* Inside the card, at its end — §4's one primary, with the keyboard
            shortcuts kept on their tooltips. */}
        <div className="flex items-center justify-end gap-2 px-3 pb-1 md:px-4">
          <TooltipAnchor
            description="Esc"
            render={
              <button
                type="button"
                className={cn(ghostAction, 'h-[34px] px-[14px]')}
                onClick={() => enterEdit(true)}
              >
                {localize('com_ui_cancel')}
              </button>
            }
          />
          <TooltipAnchor
            description="Send — saves and asks again · Ctrl + Enter"
            render={
              <button
                ref={submitButtonRef}
                type="button"
                className={cn(primaryAction, 'h-[34px] px-[14px]')}
                disabled={isSubmitting}
                onClick={handleSubmit(resubmitMessage)}
              >
                {localize('com_ui_save_resend')}
              </button>
            }
          />
        </div>
      </div>
    </Container>
  );
};

export default EditMessage;
