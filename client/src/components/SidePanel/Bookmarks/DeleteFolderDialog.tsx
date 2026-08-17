import { useEffect, useState } from 'react';
import { OGDialog, OGDialogContent, OGDialogTitle } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type DeleteFolderOutcome = 'move' | 'purge';

/**
 * Deleting a folder [F8].
 *
 * "Never silently destroys content." Two explicit outcomes — move the saved
 * responses to Unsorted (default), or delete them too — and the count is
 * stated in the copy so the size of the decision is visible.
 */
export default function DeleteFolderDialog({
  open,
  onOpenChange,
  folderName,
  savedCount,
  isSubmitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  savedCount: number;
  isSubmitting?: boolean;
  onConfirm: (outcome: DeleteFolderOutcome) => void;
}) {
  const localize = useLocalize();
  const [outcome, setOutcome] = useState<DeleteFolderOutcome>('move');

  useEffect(() => {
    if (open) {
      setOutcome('move');
    }
  }, [open]);

  const Option = ({
    value,
    title,
    body,
  }: {
    value: DeleteFolderOutcome;
    title: string;
    body: string;
  }) => (
    <button
      type="button"
      role="radio"
      aria-checked={outcome === value}
      onClick={() => setOutcome(value)}
      className={cn(
        'flex w-full items-start gap-3 rounded-[10px] px-[13px] py-[11px] text-left transition-colors',
        outcome === value ? 'bg-surface-hover' : 'hover:bg-surface-secondary',
      )}
    >
      <span
        className={cn(
          'mt-[2px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full',
          outcome === value
            ? 'bg-brand-purple shadow-[inset_0_0_0_1.5px_var(--brand-purple)]'
            : 'shadow-[inset_0_0_0_1.5px_var(--border-heavy,#3E4148)]',
        )}
      >
        {outcome === value && <span className="h-[5px] w-[5px] rounded-full bg-white" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-[19px] text-text-primary">
          {title}
        </span>
        <span className="mt-[2px] block text-[12.5px] leading-[19px] text-text-secondary">
          {body}
        </span>
      </span>
    </button>
  );

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-[440px] max-w-[92vw] rounded-[14px]" showCloseButton>
        {/* §7.8: no icon beside a dialog's title — the title and a red Delete
            already carry it, and a badge on a routine confirm trains people to
            dismiss badges. §7 also fixes the title at 17/600. */}
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <OGDialogTitle className="text-[17px] font-semibold leading-[25px] tracking-[-0.2px] text-text-primary">
              {localize('com_ui_bookmarks_delete_folder_title', { 0: folderName })}
            </OGDialogTitle>
            <p className="mt-[6px] text-[13px] leading-[20px] text-text-secondary">
              {savedCount > 0
                ? localize('com_ui_bookmarks_delete_folder_body', { count: savedCount })
                : localize('com_ui_bookmarks_delete_folder_body_empty')}
            </p>
          </div>
        </div>

        {savedCount > 0 && (
          <div className="mt-4 flex flex-col gap-1" role="radiogroup">
            <Option
              value="move"
              title={localize('com_ui_bookmarks_delete_move_title')}
              body={localize('com_ui_bookmarks_delete_move_body', { count: savedCount })}
            />
            <Option
              value="purge"
              title={localize('com_ui_bookmarks_delete_purge_title')}
              body={localize('com_ui_bookmarks_delete_purge_body', { count: savedCount })}
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 items-center rounded-[10px] px-4 text-[13.5px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            {localize('com_ui_cancel')}
          </button>
          <button
            type="button"
            disabled={isSubmitting === true}
            onClick={() => onConfirm(savedCount > 0 ? outcome : 'move')}
            className="inline-flex h-10 items-center rounded-[10px] bg-surface-destructive px-[18px] text-[13.5px] font-medium text-white transition-colors hover:bg-surface-destructive-hover disabled:cursor-default disabled:opacity-[.42]"
          >
            {localize('com_ui_delete')}
          </button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
