import { useEffect, useRef, useState } from 'react';
import { OGDialog, OGDialogContent, OGDialogTitle } from '@librechat/client';
import { useLocalize } from '~/hooks';

/**
 * New folder [F6] and the two edits from the folder menu [F7].
 *
 * One sheet, two fields. The description is optional but prompted — the
 * placeholder tells you what it is for, because the description is what makes
 * a folder findable six weeks later.
 */
export default function FolderFormDialog({
  open,
  onOpenChange,
  title,
  initialName = '',
  initialDescription = '',
  /** Which field takes focus — Rename and Edit description open the same sheet. */
  focusField = 'name',
  submitLabel,
  isSubmitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialName?: string;
  initialDescription?: string;
  focusField?: 'name' | 'description';
  submitLabel: string;
  isSubmitting?: boolean;
  onSubmit: (values: { name: string; description: string }) => void;
}) {
  const localize = useLocalize();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(initialName);
    setDescription(initialDescription);
    const target = focusField === 'description' ? descriptionRef.current : nameRef.current;
    target?.focus();
    target?.select?.();
  }, [open, initialName, initialDescription, focusField]);

  const ready = name.trim().length > 0;
  const submit = () => {
    if (!ready || isSubmitting === true) {
      return;
    }
    onSubmit({ name: name.trim(), description: description.trim() });
  };

  const field =
    'w-full rounded-[9px] bg-surface-secondary px-[13px] text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none';

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-[420px] max-w-[92vw] rounded-[14px]" showCloseButton>
        <OGDialogTitle className="text-[15px] font-medium leading-[22px] text-text-primary">
          {title}
        </OGDialogTitle>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-[7px]">
            <label
              htmlFor="folder-name"
              className="text-[12.5px] font-medium leading-[18px] text-text-primary"
            >
              {localize('com_ui_name')}
            </label>
            <input
              id="folder-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={localize('com_folder_name_placeholder')}
              className={`${field} h-[43px]`}
            />
          </div>

          <div className="flex flex-col gap-[7px]">
            <label
              htmlFor="folder-description"
              className="text-[12.5px] font-medium leading-[18px] text-text-primary"
            >
              {localize('com_ui_bookmarks_description')}
            </label>
            <textarea
              id="folder-description"
              ref={descriptionRef}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={localize('com_ui_bookmarks_description_placeholder')}
              className={`${field} resize-none py-[11px] leading-[20px]`}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-[10px] px-4 text-[13.5px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            {localize('com_ui_cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready || isSubmitting === true}
            className="h-10 rounded-[10px] px-[18px] text-[13.5px] font-medium bg-text-primary text-surface-primary transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-[0.42]"
          >
            {submitLabel}
          </button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
