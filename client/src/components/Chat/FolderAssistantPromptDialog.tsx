import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  Button,
  Spinner,
  useToastContext,
} from '@librechat/client';
import {
  useFolderAssistantPromptQuery,
  useUpdateFolderAssistantPromptMutation,
} from '~/data-provider';
import { primaryAction } from '~/components/ui/actionButton';

interface FolderAssistantPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  folderName?: string;
}

export default function FolderAssistantPromptDialog({
  open,
  onOpenChange,
  folderId,
  folderName,
}: FolderAssistantPromptDialogProps) {
  const { showToast } = useToastContext();
  const { data, isLoading } = useFolderAssistantPromptQuery(folderId, { enabled: open && !!folderId });
  const updateMutation = useUpdateFolderAssistantPromptMutation(folderId, {
    onSuccess: () => {
      showToast({ message: 'Folder assistant prompt saved.', status: 'success' });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    },
    onError: () => {
      showToast({ message: 'Failed to save folder assistant prompt.', status: 'error' });
    },
  });

  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.system_prompt !== undefined) {
      setValue(data.system_prompt);
    }
  }, [data?.system_prompt]);

  const isDirty = value !== (data?.system_prompt ?? '');

  const handleSave = () => {
    if (!isDirty || updateMutation.isLoading) {
      return;
    }
    updateMutation.mutate({ system_prompt: value });
  };

  const title = folderName ? `${folderName} — Assistant Prompt` : 'Folder Assistant Prompt';
  const contextText =
    data?.folder_context ??
    `you are assistant working in ${folderName ?? 'this'} folder.`;

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-xl" showCloseButton>
        <OGDialogHeader>
          <OGDialogTitle className="text-[17px] font-semibold leading-[25px] tracking-[-0.2px]">
            {title}
          </OGDialogTitle>
        </OGDialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner className="size-5 text-text-tertiary" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* What the folder always sends, shown as a quote rather than a
                field: it is not editable, so a bordered box that looks exactly
                like the textarea below it invites you to try. */}
            <div>
              <p className="mb-1.5 text-[12.5px] leading-[18px] text-text-secondary-alt">
                Always prepended
              </p>
              <p className="border-l-2 border-border-light pl-3 text-[13.5px] leading-[20px] text-text-primary">
                {contextText}
              </p>
            </div>

            <div>
              {/* Sentence case, --t3. These were uppercase and letter-spaced,
                  which §2 reserves for section headers over a list — as labels
                  on two consecutive fields they shouted the least useful words
                  in the dialog. */}
              <label
                htmlFor="folder-assistant-prompt"
                className="mb-1.5 block text-[12.5px] leading-[18px] text-text-secondary-alt"
              >
                Additional instructions
              </label>
              {/* §6: the fill says "field" — no border, no focus ring — and it
                  is a fixed box that scrolls rather than a hand-resizable one. */}
              <textarea
                id="folder-assistant-prompt"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Optional instructions for this folder's assistant…"
                rows={7}
                className="w-full resize-none overflow-y-auto rounded-[10px] bg-surface-secondary px-3 py-2.5 text-[13.5px] leading-[20px] text-text-primary placeholder:text-text-tertiary scrollbar-hover focus:outline-none"
              />
            </div>

            <div className="flex h-[30px] items-center justify-end gap-2">
              {saved && (
                <span className="flex items-center gap-1.5 text-[12.5px] leading-[18px] text-text-secondary">
                  <Check size={14} aria-hidden="true" />
                  Saved
                </span>
              )}
              {/* §4: the dialog's confirm is its primary. */}
              <button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || updateMutation.isLoading}
                className={primaryAction}
              >
                {updateMutation.isLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
