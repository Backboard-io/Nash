import { useState, memo, useCallback, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useRecoilState } from 'recoil';
import { ChevronDown, ChevronRight, FolderIcon, FolderOpenIcon, Pin, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  TooltipAnchor,
} from '@librechat/client';
import {
  useFoldersQuery,
  useDeleteFolderMutation,
  useConversationsInfiniteQuery,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import CreateFolderModal from './CreateFolderModal';
import { cn } from '~/utils';
import store from '~/store';

import type { TFolder } from 'librechat-data-provider';

/**
 * Chats belonging to an expanded folder.
 *
 * Spec: height 30, radius 8, padding `0 9 0 31` (9 + 22 indent), gap 8,
 * title 12.5px, pin 13.
 */
function FolderChats({ folderId, onNavigate }: { folderId: string; onNavigate?: () => void }) {
  const localize = useLocalize();
  const { data, isLoading } = useConversationsInfiniteQuery(
    { folderId },
    { staleTime: 30000, cacheTime: 300000 },
  );

  const conversations = useMemo(
    () => (data ? data.pages.flatMap((page) => page.conversations) : []),
    [data],
  );

  if (isLoading) {
    return (
      <div className="flex h-[30px] items-center pl-[31px] pr-[9px] text-[12.5px] leading-[18.75px] text-text-secondary-alt">
        {localize('com_ui_loading')}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex h-[30px] items-center pl-[31px] pr-[9px] text-[12.5px] leading-[18.75px] text-text-secondary-alt">
        {localize('com_ui_folder_empty')}
      </div>
    );
  }

  return (
    <>
      {conversations.map((convo) => (
        <Link
          key={convo.conversationId}
          to={`/c/${convo.conversationId}`}
          onClick={onNavigate}
          title={convo.title ?? undefined}
          className="group flex h-[30px] w-full flex-shrink-0 items-center gap-2 rounded-[8px] pl-[31px] pr-[9px] transition-colors hover:bg-surface-hover"
        >
          <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[18.75px] text-text-primary dark:text-text-secondary">
            {convo.title || localize('com_ui_untitled')}
          </span>
          {(convo as { isPinned?: boolean }).isPinned === true && (
            <Pin size={13} className="shrink-0 text-text-secondary" aria-hidden="true" />
          )}
        </Link>
      ))}
    </>
  );
}

function FolderItem({
  folder,
  isActive,
  isOpen,
  onToggle,
  onDelete,
}: {
  folder: TFolder;
  isActive: boolean;
  isOpen: boolean;
  onToggle: (folderId: string) => void;
  onDelete: (folder: TFolder) => void;
}) {
  const Icon = isOpen || isActive ? FolderOpenIcon : FolderIcon;
  // Spec: the folder row is a disclosure — it expands to reveal the chats
  // inside it. It must NOT start a new conversation.
  const toggle = () => onToggle(folder.folderId);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      className={cn(
        'group flex h-[34px] w-full flex-shrink-0 items-center gap-[11px] rounded-[8px] px-[9px] text-left transition-colors',
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white',
        isActive ? 'bg-surface-active' : 'hover:bg-surface-hover',
      )}
    >
      <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13.5px] leading-[20.25px] text-text-primary dark:text-text-secondary">
        {folder.name}
      </span>
      {folder.sharedMemory ? null : (
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-tertiary opacity-0 group-hover:opacity-100">
          isolated
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(folder);
        }}
        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-surface-tertiary group-hover:opacity-100"
        aria-label="Delete folder"
      >
        <Trash2 className="h-3.5 w-3.5 text-text-secondary" />
      </button>
      <ChevronRight
        className={cn(
          'h-3.5 w-3.5 shrink-0 text-text-secondary transition-transform duration-200',
          isOpen && 'rotate-90',
        )}
        aria-hidden="true"
      />
    </div>
  );
}

interface FoldersListProps {
  toggleNav?: () => void;
}

const FoldersList = memo(({ toggleNav }: FoldersListProps) => {
  const localize = useLocalize();
  const [activeFolderId, setActiveFolderId] = useRecoilState(store.activeFolderId);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TFolder | null>(null);
  // Both disclosures persist per user (designer's rule card): the FOLDERS
  // header state, and each folder's own open state — so collapsing FOLDERS and
  // reopening RESTORES the folders that were open rather than resetting them.
  const [isExpanded, setIsExpandedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nashFoldersExpanded') !== 'false';
    } catch {
      return true;
    }
  });
  const setIsExpanded = useCallback((updater: boolean | ((prev: boolean) => boolean)) => {
    setIsExpandedState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem('nashFoldersExpanded', String(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const { data: folders } = useFoldersQuery();
  const deleteMutation = useDeleteFolderMutation();

  const [openFolderIds, setOpenFolderIds] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('nashOpenFolderIds') || '{}');
    } catch {
      return {};
    }
  });

  const handleToggleFolder = useCallback((folderId: string) => {
    setOpenFolderIds((prev) => {
      const next = { ...prev, [folderId]: !prev[folderId] };
      try {
        localStorage.setItem('nashOpenFolderIds', JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const handleDeleteRequest = useCallback((folder: TFolder) => {
    setDeleteTarget(folder);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) {
      return;
    }
    if (activeFolderId === deleteTarget.folderId) {
      setActiveFolderId(null);
    }
    deleteMutation.mutate(deleteTarget.folderId);
    setDeleteTarget(null);
  }, [deleteTarget, activeFolderId, setActiveFolderId, deleteMutation]);

  return (
    <div className="flex flex-col gap-[2px]">
      <div className="group relative flex h-8 flex-shrink-0 items-center">
        <button
          type="button"
          onClick={() => setIsExpanded((open) => !open)}
          aria-expanded={isExpanded}
          className="flex h-8 w-full items-center justify-between rounded-[8px] px-[9px] text-left outline-none transition-colors hover:bg-surface-hover focus-visible:outline-none"
        >
          <span className="select-none text-[11px] font-medium uppercase leading-[16.5px] text-text-secondary-alt max-md:text-[12px] max-md:normal-case max-md:leading-[18px]">
            {localize('com_folder_folders')}
          </span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-text-secondary transition-transform duration-200',
              isExpanded ? '' : '-rotate-90',
            )}
            aria-hidden="true"
          />
        </button>
        <TooltipAnchor description={localize('com_folder_create')} side="right">
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-[27px] top-1/2 h-6 w-6 -translate-y-1/2 p-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => setModalOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 text-text-secondary" />
          </Button>
        </TooltipAnchor>
      </div>

      {isExpanded &&
        folders?.map((folder) => (
          <Fragment key={folder.folderId}>
            <FolderItem
              folder={folder}
              isActive={activeFolderId === folder.folderId}
              isOpen={openFolderIds[folder.folderId] === true}
              onToggle={handleToggleFolder}
              onDelete={handleDeleteRequest}
            />
            {openFolderIds[folder.folderId] === true && (
              <FolderChats folderId={folder.folderId} onNavigate={toggleNav} />
            )}
          </Fragment>
        ))}

      <CreateFolderModal open={modalOpen} onOpenChange={setModalOpen} />

      <OGDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
          <OGDialogHeader>
            <OGDialogTitle>{localize('com_folder_delete')}</OGDialogTitle>
          </OGDialogHeader>
          <p className="text-sm text-text-secondary">
            {localize('com_folder_delete_confirm')}
          </p>
          {deleteTarget && (
            <p className="truncate text-sm font-medium text-text-primary">
              &ldquo;{deleteTarget.name}&rdquo;
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
});

FoldersList.displayName = 'FoldersList';
export default FoldersList;
