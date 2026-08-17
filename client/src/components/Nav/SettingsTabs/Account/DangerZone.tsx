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
    /* §1: tokens, and never a surface faked with opacity — this was
       `border-rose-500/30` over `bg-rose-500/5`, two raw palette colours at
       fractional alpha. §3: a card is radius 13 with 16 of padding. */
    <div className="rounded-[13px] border border-border-destructive bg-surface-destructive-subtle p-4">
      <h3 className="mb-3 text-[13.5px] font-semibold leading-[20px] text-text-destructive">
        Danger Zone
      </h3>
      <OGDialog open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13.5px] font-medium leading-[20px] text-text-primary">
              Clear chat history &amp; memories
            </p>
            <p className="mt-0.5 text-[12.5px] leading-[18px] text-text-secondary-alt">
              Permanently delete all your conversations, documents, and AI memories. This cannot be undone.
            </p>
          </div>
          <OGDialogTrigger asChild>
            {/* §7: the destructive confirm's own button is red; the trigger
                that opens it does not need to be. It is a `.ghost.outlined`
                that turns red under the pointer. */}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="ml-4 inline-flex h-[30px] shrink-0 items-center gap-[6px] rounded-[8px] px-[14px] text-[12.5px] font-medium text-text-primary ring-1 ring-inset ring-border-destructive transition-colors hover:bg-surface-destructive hover:text-white focus:outline-none"
            >
              <Trash2 className="size-[13px]" aria-hidden="true" />
              Clear data
            </button>
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
            <ul className="list-disc space-y-1 pl-5 font-medium text-text-destructive">
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
