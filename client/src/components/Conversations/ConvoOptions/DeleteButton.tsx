import React, { useCallback } from 'react';
import { Trans } from 'react-i18next';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Button,
  Spinner,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import { useDeleteConversationMutation } from '~/data-provider';
import { useLocalize, useNewConvo } from '~/hooks';
import { NotificationSeverity } from '~/common';

type DeleteButtonProps = {
  conversationId: string;
  retainView: () => void;
  title: string;
  showDeleteDialog?: boolean;
  setShowDeleteDialog?: (value: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement>;
  setMenuOpen?: (open: boolean) => void;
};

export function DeleteConversationDialog({
  setShowDeleteDialog,
  conversationId,
  setMenuOpen,
  retainView,
  title,
}: {
  setMenuOpen?: (open: boolean) => void;
  setShowDeleteDialog: (value: boolean) => void;
  conversationId: string;
  retainView: () => void;
  title: string;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const { newConversation } = useNewConvo();
  const { conversationId: currentConvoId } = useParams();

  const deleteMutation = useDeleteConversationMutation({
    onSuccess: () => {
      setShowDeleteDialog(false);
      if (currentConvoId === conversationId || currentConvoId === 'new') {
        newConversation();
        navigate('/c/new', { replace: true });
      }
      setMenuOpen?.(false);
      retainView();
      showToast({
        message: localize('com_ui_convo_delete_success'),
        severity: NotificationSeverity.SUCCESS,
        showIcon: true,
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_convo_delete_error'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    },
  });

  const confirmDelete = useCallback(() => {
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, conversationId]);
    const thread_id = messages?.[messages.length - 1]?.thread_id;
    const endpoint = messages?.[messages.length - 1]?.endpoint;

    deleteMutation.mutate({ conversationId, thread_id, endpoint, source: 'button' });
  }, [conversationId, deleteMutation, queryClient]);

  return (
    <OGDialogContent
      className="w-11/12 max-w-md"
      aria-describedby="delete-conversation-description"
    >
      <OGDialogHeader>
        <OGDialogTitle>{localize('com_ui_delete_conversation')}</OGDialogTitle>
      </OGDialogHeader>
      <div id="delete-conversation-description" className="w-full truncate">
        <Trans
          i18nKey="com_ui_delete_confirm_strong"
          values={{ title }}
          components={{ strong: <strong /> }}
        />
      </div>
      {/* §7 "Confirming something destructive": ghost Cancel, filled --err
          confirm that names its verb. This had an outlined Cancel and a
          different red from the folder confirm. */}
      <div className="mt-2 flex items-center justify-end gap-2">
        <OGDialogClose asChild>
          <button
            type="button"
            aria-label="cancel"
            className="inline-flex h-10 items-center rounded-[10px] px-4 text-[13.5px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            {localize('com_ui_cancel')}
          </button>
        </OGDialogClose>
        <button
          type="button"
          onClick={confirmDelete}
          disabled={deleteMutation.isLoading}
          className="inline-flex h-10 items-center rounded-[10px] bg-surface-destructive px-[18px] text-[13.5px] font-medium text-white transition-colors hover:bg-surface-destructive-hover disabled:cursor-default disabled:opacity-[.42]"
        >
          {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
        </button>
      </div>
    </OGDialogContent>
  );
}

export default function DeleteButton({
  conversationId,
  retainView,
  title,
  setMenuOpen,
  showDeleteDialog,
  setShowDeleteDialog,
  triggerRef,
}: DeleteButtonProps) {
  if (showDeleteDialog === undefined || setShowDeleteDialog === undefined) {
    return null;
  }

  if (!conversationId) {
    return null;
  }

  return (
    <OGDialog open={showDeleteDialog!} onOpenChange={setShowDeleteDialog!} triggerRef={triggerRef}>
      <DeleteConversationDialog
        setShowDeleteDialog={setShowDeleteDialog}
        conversationId={conversationId}
        setMenuOpen={setMenuOpen}
        retainView={retainView}
        title={title}
      />
    </OGDialog>
  );
}
