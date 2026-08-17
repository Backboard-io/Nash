import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaQuery, useToastContext } from '@librechat/client';
import { Constants } from 'librechat-data-provider';
import { Check, FolderOpen, X } from 'lucide-react';
import { ChatMenu } from './Menus';
import { useGetStartupConfig, useUpdateConversationMutation } from '~/data-provider';
import { useChatContext } from '~/Providers';
import useExportShareMenuItems from './ExportAndShareMenu';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

export default function Header() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();

  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;

  const { items: exportShareItems, dialogs: exportShareDialogs } = useExportShareMenuItems({
    isSharedButtonEnabled: startupConfig?.sharedLinksEnabled ?? false,
  });

  const updateConvoMutation = useUpdateConversationMutation(conversationId);
  const [renaming, setRenaming] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleRename = useCallback(() => {
    setTitleInput(conversation?.title ?? '');
    setRenaming(true);
  }, [conversation?.title]);

  const handleCancelRename = useCallback(() => {
    setRenaming(false);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (
      conversation?.conversationId == null ||
      conversation.conversationId === Constants.NEW_CONVO
    ) {
      setRenaming(false);
      return;
    }
    const newTitle = titleInput.trim() || localize('com_ui_untitled');
    if (newTitle === conversation.title) {
      setRenaming(false);
      return;
    }
    try {
      await updateConvoMutation.mutateAsync({
        conversationId: conversation.conversationId,
        title: newTitle,
      });
      setRenaming(false);
    } catch {
      showToast({
        message: localize('com_ui_rename_failed'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    }
  }, [conversation?.conversationId, conversation?.title, titleInput, updateConvoMutation, localize, showToast]);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  return (
    <div className="absolute top-0 z-10 flex h-[52px] w-full items-center bg-surface-primary px-[22px] font-semibold text-text-primary max-md:hidden">
      {!isSmallScreen && renaming && (
        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleRenameSubmit();
          }}
        >
          <FolderOpen className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
          <input
            ref={renameInputRef}
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleCancelRename();
              }
            }}
            aria-label={localize('com_ui_rename')}
            data-testid="chat-header-rename-input"
            className="w-48 truncate rounded-lg border border-border-medium bg-surface-primary px-2 py-1 text-sm font-semibold text-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            aria-label={localize('com_ui_save')}
            className="flex size-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleCancelRename}
            aria-label={localize('com_ui_cancel')}
            className="flex size-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      )}
      <div className="-mr-[9px] ml-auto flex items-center">
        <ChatMenu
          renameHandler={handleRename}
          prependItems={exportShareItems}
        />
      </div>
      {exportShareDialogs}
    </div>
  );
}
