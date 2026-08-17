import { useState } from 'react';
import { Clipboard, CheckMark } from '@librechat/client';
import type { TMessage, TAttachment, SearchResultData } from 'librechat-data-provider';
import { useLocalize, useCopyToClipboard } from '~/hooks';

type THoverButtons = {
  message: TMessage;
  searchResults?: { [key: string]: SearchResultData };
};

export default function MinimalHoverButtons({ message, searchResults }: THoverButtons) {
  const localize = useLocalize();
  const [isCopied, setIsCopied] = useState(false);
  const copyToClipboard = useCopyToClipboard({
    text: message.text,
    content: message.content,
    messageId: message.messageId,
    searchResults,
  });

  return (
    <div className="visible mt-1 flex justify-center gap-1 self-end text-text-secondary-alt lg:justify-start">
      <button
        className="ml-0 flex h-7 w-7 items-center justify-center rounded-lg p-1.5 text-text-secondary-alt transition-colors duration-hover hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
        onClick={() => copyToClipboard(setIsCopied)}
        type="button"
        title={
          isCopied ? localize('com_ui_copied_to_clipboard') : localize('com_ui_copy_to_clipboard')
        }
      >
        {isCopied ? <CheckMark className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
      </button>
    </div>
  );
}
