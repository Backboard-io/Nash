import { TMessage } from 'librechat-data-provider';
import Files, { isRenderableImageFile } from './Files';
import ClampedMessage from './ClampedMessage';
import { cn } from '~/utils';

const Container = ({
  children,
  message,
  isCreatedByUser,
}: {
  children: React.ReactNode;
  message?: TMessage;
  isCreatedByUser?: boolean;
}) => {
  const isUser = (isCreatedByUser ?? message?.isCreatedByUser) === true;
  const asBubble = isCreatedByUser === true;
  const files = message?.isCreatedByUser === true ? (message.files ?? []) : [];
  const showFiles = files.length > 0;
  const imagesOnly = showFiles && files.every((file) => isRenderableImageFile(file));

  return (
    <div
      className={cn(
        'text-message flex min-h-[20px] flex-col gap-3 overflow-visible [.text-message+&]:mt-5',
        isUser ? 'items-end' : 'items-start',
      )}
      dir="auto"
    >
      {asBubble ? (
        <div
          className={cn(
            // Figma user bubble: 76% max, 18px radius, 16/18/13 padding.
            'flex w-fit max-w-[76%] flex-col gap-2 rounded-[18px] bg-surface-chat text-text-primary',
            showFiles
              ? imagesOnly
                ? 'p-1.5 pb-3'
                : 'p-2.5 pb-3'
              : 'px-[18px] pb-[13px] pt-4',
          )}
        >
          {showFiles && <Files message={message} />}
          {/* §9: only sent messages clamp — a reply is always shown in full. */}
          <ClampedMessage>{children}</ClampedMessage>
        </div>
      ) : (
        <>
          {showFiles && <Files message={message} />}
          {children}
        </>
      )}
    </div>
  );
};

export default Container;
