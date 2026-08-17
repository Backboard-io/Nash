import { useState } from 'react';
import { OGDialogTemplate, OGDialog, OGDialogTrigger } from '@librechat/client';
import ArchivedChatsTable from './ArchivedChatsTable';
import { useLocalize } from '~/hooks';

export default function ArchivedChats() {
  const localize = useLocalize();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex items-center justify-between">
      <div>{localize('com_nav_archived_chats')}</div>
      <OGDialog open={isOpen} onOpenChange={setIsOpen}>
        <OGDialogTrigger asChild>
          {/* §4 `.ghost.outlined` — a secondary action beside a label. It was
              a filled light button, which read as the page's primary. */}
          <button
            type="button"
            aria-label={localize('com_nav_archived_chats')}
            className="inline-flex h-[34px] shrink-0 items-center rounded-[8px] px-[16px] text-[13px] font-medium text-text-primary ring-1 ring-inset ring-border-light transition-colors hover:bg-surface-active focus:outline-none focus-visible:ring-border-heavy"
          >
            {localize('com_ui_manage')}
          </button>
        </OGDialogTrigger>
        <OGDialogTemplate
          title={localize('com_nav_archived_chats')}
          className="max-w-[1000px]"
          showCancelButton={false}
          main={<ArchivedChatsTable isOpen={isOpen} onOpenChange={setIsOpen} />}
        />
      </OGDialog>
    </div>
  );
}
