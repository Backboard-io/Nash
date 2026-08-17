import { useEffect, useState } from 'react';
import { MessageSquare, Check, Loader2 } from 'lucide-react';
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
          <OGDialogTitle className="flex items-center gap-2">
            <MessageSquare className="size-4 text-text-secondary" aria-hidden />
            {title}
          </OGDialogTitle>
        </OGDialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner className="size-5 text-text-tertiary" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-2.5">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                Folder context (always prepended)
              </p>
              <p className="text-sm text-text-primary">{contextText}</p>
            </div>

            <div>
              <label
                htmlFor="folder-assistant-prompt"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-tertiary"
              >
                Additional prompt (editable)
              </label>
              <textarea
                id="folder-assistant-prompt"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Optional custom instructions for this folder assistant..."
                className="min-h-[180px] w-full resize-y rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              {saved && (
                <span className="flex items-center gap-1 text-sm text-brand-purple dark:text-violet-400">
                  <Check className="size-4" aria-hidden />
                  Saved
                </span>
              )}
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={!isDirty || updateMutation.isLoading}
              >
                {updateMutation.isLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
