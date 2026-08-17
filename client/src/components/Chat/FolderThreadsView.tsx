import { memo, useState, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpenIcon, MessageSquare, Trash2, Import, BrainCircuit } from 'lucide-react';
import { QueryKeys } from 'librechat-data-provider';
import {
  Button,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  TooltipAnchor,
} from '@librechat/client';
import type { TMessage, TConversation, ConversationListResponse } from 'librechat-data-provider';
import { useConversationsInfiniteQuery, useFoldersQuery, useDeleteConversationMutation } from '~/data-provider';
import { useLocalize, useNewConvo, useNavigateToConvo } from '~/hooks';
import FolderMemoryImportDialog from './FolderMemoryImportDialog';
import FolderMemoryBrowserDialog from './FolderMemoryBrowserDialog';
import FolderAssistantPromptDialog from './FolderAssistantPromptDialog';
import ChatForm from './Input/ChatForm';

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function FolderThreadsView({ folderId, index = 0 }: { folderId: string; index?: number }) {
  const navigate = useNavigate();
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { conversationId: currentConvoId } = useParams();
  const { newConversation } = useNewConvo(index);
  const { navigateToConvo } = useNavigateToConvo(index);
  const { data: folders } = useFoldersQuery();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [browserDialogOpen, setBrowserDialogOpen] = useState(false);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);

  const folder = useMemo(
    () => folders?.find((f) => f.folderId === folderId),
    [folders, folderId],
  );

  const { data, isLoading } = useConversationsInfiniteQuery(
    { folderId },
    { enabled: !!folderId },
  );

  const conversations = useMemo(
    () => (data ? data.pages.flatMap((page: ConversationListResponse) => page.conversations) : []),
    [data],
  );

  const deleteMutation = useDeleteConversationMutation({
    onSuccess: () => {
      setDeleteTarget(null);
      if (currentConvoId === deleteTarget?.id) {
        newConversation({ template: { folderId } });
        navigate('/c/new', { replace: true });
      }
    },
  });

  const handleConvoClick = useCallback(
    (convo: TConversation) => {
      navigateToConvo(convo, { currentConvoId });
    },
    [navigateToConvo, currentConvoId],
  );

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) {
      return;
    }
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, deleteTarget.id]);
    const thread_id = messages?.[messages.length - 1]?.thread_id;
    const endpoint = messages?.[messages.length - 1]?.endpoint;
    deleteMutation.mutate({ conversationId: deleteTarget.id, thread_id, endpoint, source: 'button' });
  }, [deleteTarget, deleteMutation, queryClient]);

  return (
    <div className="relative flex h-full w-full flex-col items-center overflow-y-auto">
      <div className="w-full max-w-3xl px-6 pb-8 pt-20">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-hover">
            <FolderOpenIcon className="h-5 w-5 text-text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">
            {folder?.name ?? localize('com_folder_folders')}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <TooltipAnchor
              description="Browse folder memories"
              side="bottom"
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 bg-transparent"
                  aria-label="Browse folder memories"
                  onClick={() => setBrowserDialogOpen(true)}
                >
                  <BrainCircuit className="size-4" aria-hidden="true" />
                </Button>
              }
            />
            <TooltipAnchor
              description="Edit folder assistant prompt"
              side="bottom"
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 bg-transparent"
                  aria-label="Edit folder assistant prompt"
                  onClick={() => setPromptDialogOpen(true)}
                >
                  <MessageSquare className="size-4" aria-hidden="true" />
                </Button>
              }
            />
            <FolderMemoryImportDialog
              open={importDialogOpen}
              onOpenChange={setImportDialogOpen}
              folderId={folderId}
              folderName={folder?.name}
            >
              <TooltipAnchor
                description="Import memories into this folder"
                side="bottom"
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 bg-transparent"
                    aria-label="Import memories into folder"
                    onClick={() => setImportDialogOpen(true)}
                  >
                    <Import className="size-4" aria-hidden="true" />
                  </Button>
                }
              />
            </FolderMemoryImportDialog>
          </div>

          <FolderMemoryBrowserDialog
            open={browserDialogOpen}
            onOpenChange={setBrowserDialogOpen}
            folderId={folderId}
            folderName={folder?.name}
          />
          <FolderAssistantPromptDialog
            open={promptDialogOpen}
            onOpenChange={setPromptDialogOpen}
            folderId={folderId}
            folderName={folder?.name}
          />
        </div>

        <div className="mb-6">
          <ChatForm index={index} />
        </div>

        <div className="flex flex-col">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-text-tertiary">
            {localize('com_folder_chats')}
          </h2>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-text-tertiary">{localize('com_ui_loading')}</div>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <MessageSquare className="mb-3 h-8 w-8 text-text-tertiary" />
              <p className="text-sm text-text-secondary">
                {localize('com_folder_no_chats')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-px">
              {conversations.map((convo) => (
                <div
                  key={convo.conversationId as string}
                  className="group flex w-full items-center rounded-lg transition-colors hover:bg-surface-hover"
                >
                  <button
                    type="button"
                    onClick={() => handleConvoClick(convo as TConversation)}
                    className="flex min-w-0 flex-1 items-center justify-between px-3 py-3.5 text-left"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-text-primary">
                      {(convo.title as string) || localize('com_ui_new_chat')}
                    </span>
                    <span className="ml-4 shrink-0 text-xs text-text-tertiary">
                      {formatRelativeDate(
                        (convo.updatedAt as string) ?? (convo.createdAt as string),
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({
                      id: convo.conversationId as string,
                      title: (convo.title as string) || localize('com_ui_new_chat'),
                    })}
                    className="mr-2 shrink-0 rounded p-1.5 opacity-0 transition-opacity hover:bg-surface-tertiary group-hover:opacity-100"
                    aria-label={localize('com_folder_delete_thread')}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-text-secondary" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      <OGDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
          <OGDialogHeader>
            <OGDialogTitle>{localize('com_folder_delete_thread')}</OGDialogTitle>
          </OGDialogHeader>
          <p className="text-sm text-text-secondary">
            {localize('com_folder_delete_thread_confirm')}
          </p>
          {deleteTarget && (
            <p className="truncate text-sm font-medium text-text-primary">
              &ldquo;{deleteTarget.title}&rdquo;
            </p>
          )}
          <div className="flex justify-end gap-4 pt-4">
            <OGDialogClose asChild>
              <Button variant="outline">{localize('com_ui_cancel')}</Button>
            </OGDialogClose>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteMutation.isLoading}
            >
              {localize('com_ui_delete')}
            </Button>
          </div>
        </OGDialogContent>
      </OGDialog>
    </div>
  );
}

export default memo(FolderThreadsView);
