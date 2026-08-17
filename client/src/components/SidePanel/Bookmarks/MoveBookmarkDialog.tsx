import { Check, FolderIcon, FolderMinus } from 'lucide-react';
import {
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { TSavedMessage } from 'librechat-data-provider';
import { useSavedMessageFoldersQuery, useSaveMessageMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Move a saved response into a folder, or back out of one.
 *
 * Same idempotent save call as the note editor — it keeps every field it is
 * not given, so changing `folderId` moves the row rather than duplicating it.
 * Unsorted is deliberately not in this list. It is not a destination — it is
 * what a response is when it belongs to no folder — so the list offers the real
 * folders, plus a way to remove one when it has one.
 */
export default function MoveBookmarkDialog({
  saved,
  open,
  onOpenChange,
}: {
  saved?: TSavedMessage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: folders } = useSavedMessageFoldersQuery();
  const save = useSaveMessageMutation();

  if (!saved) {
    return null;
  }

  const moveTo = (folderId: string | null) => {
    save.mutate(
      {
        messageId: saved.messageId,
        conversationId: saved.conversationId,
        text: saved.text,
        title: saved.title,
        model: saved.model,
        endpoint: saved.endpoint,
        context: saved.context,
        note: saved.note,
        folderId,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          showToast({ message: localize('com_ui_bookmarks_moved'), status: 'success' });
        },
        onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
      },
    );
  };

  const current = saved.folderId ?? null;
  const rowClass =
    'flex w-full items-center gap-[10px] rounded-[10px] px-3 py-[10px] text-left text-[13px] leading-[20px] transition-colors hover:bg-surface-hover';

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-[420px]">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_bookmarks_move_to_folder')}</OGDialogTitle>
        </OGDialogHeader>

        <div className="max-h-[320px] overflow-y-auto px-1 pb-2">
          {/* Not "move to Unsorted" — Unsorted is not a place, it is what a
              response is when it is in no folder. So this is the absence being
              offered, and only when there is something to undo: a response that
              is already unfiled has nothing to be removed from. */}
          {current != null && (
            <button type="button" onClick={() => moveTo(null)} className={rowClass}>
              <FolderMinus className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-text-primary">
                {localize('com_ui_bookmarks_remove_from_folder')}
              </span>
            </button>
          )}

          {/* The folders query appends a virtual "unsorted" entry so the grid
              can show it as a card. It is already the first row here, so it
              would otherwise appear twice. */}
          {(folders ?? [])
            .filter((folder) => folder.virtual !== true)
            .map((folder) => (
            <button
              key={folder.folderId}
              type="button"
              onClick={() => moveTo(folder.folderId)}
              className={cn(rowClass)}
            >
              <FolderIcon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-text-primary">{folder.name}</span>
              {current === folder.folderId && (
                <Check className="h-4 w-4 shrink-0 text-text-primary" aria-hidden="true" />
                )}
              </button>
            ))}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
