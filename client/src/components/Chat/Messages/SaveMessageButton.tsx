import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { useToastContext } from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import { useSavedMessagesQuery, useUnsaveMessageMutation } from '~/data-provider';
import SaveToBookmarksDialog from './SaveToBookmarksDialog';
import SavedResponseToast from './SavedResponseToast';
import { HoverButton } from './HoverButtons';
import { useLocalize } from '~/hooks';

type SaveMessageButtonProps = {
  message: TMessage;
  conversationId: string;
  /** Source conversation title — shown on the saved card; without it every card reads "Untitled". */
  conversationTitle?: string;
  isLast?: boolean;
};

/**
 * Figma C1/C4 — the bookmark action in the assistant hover toolbar, its save modal and the
 * confirmation toast. Already-saved responses reopen the modal in edit mode (C4).
 */
export default function SaveMessageButton({
  message,
  conversationId,
  conversationTitle,
  isLast,
}: SaveMessageButtonProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  /** `created` is false for edits of an existing bookmark, where Undo would delete the row. */
  const [toast, setToast] = useState<{ folder: string; created: boolean } | null>(null);

  const { data: savedMessages = [] } = useSavedMessagesQuery();
  const existing = useMemo(
    () => savedMessages.find((saved) => saved.messageId === message.messageId),
    [savedMessages, message.messageId],
  );

  const unsave = useUnsaveMessageMutation({
    onError: () =>
      showToast({ message: localize('com_ui_bookmark_save_error'), status: 'error' }),
  });

  const handleSaved = useCallback(
    (folderName: string, { created }: { created: boolean }) =>
      setToast({ folder: folderName, created }),
    [],
  );
  const dismissToast = useCallback(() => setToast(null), []);
  const handleView = useCallback(() => {
    setToast(null);
    navigate('/bookmarks');
  }, [navigate]);

  /** Only offered on a fresh save: unsaving after an edit would delete the whole row. */
  const handleUndo = useCallback(() => {
    setToast(null);
    unsave.mutate(message.messageId);
  }, [unsave, message.messageId]);

  // The popover anchors to this button: Figma C2 places the panel just under
  // the message's action row, not centred over the page.
  // NB: the wrapper must generate a box — `display: contents` would make
  // getBoundingClientRect() return zeros and fling the panel to (0,0).
  const triggerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={triggerRef} className="inline-flex">
      <HoverButton
        onClick={() => setIsDialogOpen(true)}
        title={
          existing != null ? localize('com_ui_saved_to_bookmarks') : localize('com_ui_save_to_bookmarks')
        }
        icon={<Bookmark size={16} className={existing != null ? 'fill-current' : undefined} />}
        isActive={existing != null}
        isLast={isLast}
      />
      </div>
      <SaveToBookmarksDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        anchorRef={triggerRef}
        messageId={message.messageId}
        conversationId={conversationId}
        title={conversationTitle}
        text={message.text}
        model={message.model ?? undefined}
        endpoint={message.endpoint ?? undefined}
        existing={existing}
        onSaved={handleSaved}
      />
      {toast != null && (
        <SavedResponseToast
          folderName={toast.folder}
          onView={handleView}
          onUndo={toast.created ? handleUndo : undefined}
          onDismiss={dismissToast}
        />
      )}
    </>
  );
}
