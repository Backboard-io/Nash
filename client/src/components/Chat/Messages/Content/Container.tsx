import { TMessage } from 'librechat-data-provider';
import Files, { isRenderableImageFile } from './Files';
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
            'flex w-fit max-w-[80%] flex-col gap-2 rounded-[16px] bg-surface-chat text-text-primary',
            showFiles ? (imagesOnly ? 'p-1.5 pb-3' : 'p-2.5 pb-3') : 'px-4 py-3',
          )}
        >
          {showFiles && <Files message={message} />}
          {children}
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
