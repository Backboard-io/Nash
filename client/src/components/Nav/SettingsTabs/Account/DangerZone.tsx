import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Button,
  Spinner,
  OGDialog,
  OGDialogContent,
  OGDialogTrigger,
  OGDialogHeader,
  OGDialogTitle,
  useToastContext,
} from '@librechat/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, request, apiBaseUrl } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

const useDeleteChatDataMutation = () => {
  const queryClient = useQueryClient();
  return useMutation(
    () => request.delete(`${apiBaseUrl()}/api/user/chat-data`) as Promise<{ message: string }>,
    {
      onSuccess: () => {
        queryClient.removeQueries([QueryKeys.allConversations]);
        queryClient.removeQueries([QueryKeys.memories]);
        queryClient.setQueryData([QueryKeys.files], []);
      },
    },
  );
};

export default function DangerZone() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [open, setOpen] = useState(false);
  const { mutate: deleteChatData, isLoading } = useDeleteChatDataMutation();

  const handleConfirm = () => {
    deleteChatData(undefined, {
      onSuccess: () => {
        showToast({ message: 'Chat history and memories cleared.', status: 'success' });
        setOpen(false);
      },
      onError: () => {
        showToast({ message: localize('com_ui_error'), status: 'error' });
      },
    });
  };

  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
      <h3 className="mb-3 text-sm font-semibold text-rose-600 dark:text-rose-400">Danger Zone</h3>
      <OGDialog open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Clear chat history & memories</p>
            <p className="mt-0.5 text-xs text-text-secondary">
              Permanently delete all your conversations, documents, and AI memories. This cannot be undone.
            </p>
          </div>
          <OGDialogTrigger asChild>
            <Button variant="destructive" className="ml-4 shrink-0" onClick={() => setOpen(true)}>
              <Trash2 className="mr-1.5 size-4" aria-hidden="true" />
              Clear data
            </Button>
          </OGDialogTrigger>
        </div>
        <OGDialogContent className="w-11/12 max-w-md">
          <OGDialogHeader>
            <OGDialogTitle className="text-lg font-medium leading-6">
              Clear chat history, documents, & memories?
            </OGDialogTitle>
          </OGDialogHeader>
          <div className="space-y-3 py-2 text-sm text-text-primary">
            <p>This will permanently delete:</p>
            <ul className="list-disc space-y-1 pl-5 font-medium text-rose-600 dark:text-rose-400">
              <li>All your conversation history</li>
              <li>All AI memories stored about you</li>
              <li>All your uploaded documents</li>
            </ul>
            <p className="text-text-secondary">This action cannot be undone.</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={isLoading}>
              {isLoading ? (
                <Spinner className="size-4" />
              ) : (
                <>
                  <Trash2 className="mr-1.5 size-4" aria-hidden="true" />
                  Yes, clear everything
                </>
              )}
            </Button>
          </div>
        </OGDialogContent>
      </OGDialog>
    </div>
  );
}
