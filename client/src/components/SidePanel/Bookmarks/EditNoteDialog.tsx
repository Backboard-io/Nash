import { useEffect, useState } from 'react';
import {
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { TSavedMessage } from 'librechat-data-provider';
import { useSaveMessageMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * Edit the note on a saved response.
 *
 * The save endpoint is idempotent on `messageId` and keeps everything it is
 * not given, so writing the note back through it is an update rather than a
 * second row — the same call the toast's Undo uses to restore one.
 */
export default function EditNoteDialog({
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
  const save = useSaveMessageMutation();
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setNote(saved?.note ?? '');
    }
  }, [open, saved?.note]);

  if (!saved) {
    return null;
  }

  const commit = () => {
    save.mutate(
      {
        messageId: saved.messageId,
        conversationId: saved.conversationId,
        text: saved.text,
        title: saved.title,
        model: saved.model,
        endpoint: saved.endpoint,
        context: saved.context,
        note: note.trim(),
        folderId: saved.folderId,
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
      },
    );
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-[520px]">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_bookmarks_edit_note')}</OGDialogTitle>
        </OGDialogHeader>

        <div className="px-1 pb-1">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder={localize('com_ui_bookmarks_no_note')}
            /* Fixed height, scroll past it — the box does not grow. A field
               that resizes as you type pushes the dialog's buttons down and
               moves the target you were reaching for. */
            className="h-[132px] w-full resize-none overflow-y-auto rounded-[10px] bg-surface-secondary px-3 py-[10px] text-[13px] leading-[20px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-10 items-center rounded-[10px] px-4 text-[13.5px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              {localize('com_ui_cancel')}
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={save.isLoading}
              className="inline-flex h-10 items-center rounded-[10px] px-[18px] text-[13.5px] font-medium bg-text-primary text-surface-primary transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-[.42]"
            >
              {localize('com_ui_save')}
            </button>
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
