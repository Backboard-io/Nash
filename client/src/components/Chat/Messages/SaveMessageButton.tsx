import { useCallback, useMemo, useRef, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { useToastContext } from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import { useSavedMessagesQuery, useUnsaveMessageMutation } from '~/data-provider';
import SaveToBookmarksDialog from './SaveToBookmarksDialog';
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
  const { showToast } = useToastContext();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: savedData } = useSavedMessagesQuery();
  const existing = useMemo(
    () => savedData?.find((saved) => saved.messageId === message.messageId),
    [savedData, message.messageId],
  );

  const unsave = useUnsaveMessageMutation({
    onError: () =>
      showToast({ message: localize('com_ui_bookmark_save_error'), status: 'error' }),
  });

  /* The save confirmation goes through the one shared Toast (DESIGN.md §8) —
   * nothing renders its own variant. §8 gives a toast a single action, and it
   * goes to Undo: this is the only way back out of a save from inside the chat,
   * where View was merely a shortcut to a page the sidebar already links.
   * Offered only on a fresh save — after an edit, unsaving would delete the
   * whole row rather than reverse the edit. §8.3 holds it for 5 seconds. */
  const handleSaved = useCallback(
    (folderName: string, { created }: { created: boolean }) =>
      showToast({
        message: localize('com_ui_saved_to_folder', { folder: folderName }),
        status: 'success',
        duration: 5000,
        action: created
          ? { label: localize('com_ui_undo'), onClick: () => unsave.mutate(message.messageId) }
          : undefined,
      }),
    [showToast, localize, unsave, message.messageId],
  );

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
        icon={<Bookmark size={15} className={existing != null ? 'fill-current' : undefined} />}
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
    </>
  );
}
