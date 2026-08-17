import { useState, useEffect, memo, useCallback, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
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
  useToastContext,
} from '@librechat/client';
import {
  useFoldersQuery,
  useMoveConvoToFolderMutation,
  useCreateFolderMutation,
  useDeleteFolderMutation,
  useConversationsInfiniteQuery,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import Conversation from '~/components/Conversations/Convo';
import { CHAT_ROW_GAP } from '~/components/Conversations/rowSpacing';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Collapse from '~/components/ui/Collapse';
import {
  CONVO_DRAG_TYPE,
  CONVO_DRAG_FROM,
  convoDrag,
} from '~/components/Conversations/dragTypes';
import { cn } from '~/utils';
import { liquid, ease } from '~/utils/motion';
import store from '~/store';

import type { TFolder } from 'librechat-data-provider';

/** Folders shown before the rest go behind Show more. */
const VISIBLE_FOLDER_LIMIT = 5;

/**
 * Chats belonging to an expanded folder.
 *
 * Spec: height 30, radius 8, padding `0 9 0 31` (9 + 22 indent), gap 8,
 * title 12.5px, pin 13.
 */
function FolderChats({ folderId, onNavigate }: { folderId: string; onNavigate?: () => void }) {
  const reduceMotion = useReducedMotion();
  const { data, isLoading } = useConversationsInfiniteQuery(
    { folderId },
    { staleTime: 30000, cacheTime: 300000 },
  );

  const conversations = useMemo(
    () => (data ? data.pages.flatMap((page) => page.conversations) : []),
    [data],
  );

  /* No loading bar. It used to hold a skeleton line while the fetch ran, which
     made opening an EMPTY folder animate open to the height of a bar and then
     straight back down to nothing — a folder with nothing in it appeared to
     open and close itself. Nothing renders until there is something to render,
     so an empty folder moves only its chevron, and rows animate themselves in
     when they arrive (that arrival is the feedback the bar was standing in
     for). §10's skeleton rule is about a page opening, not a disclosure.

     An empty folder shows nothing at all: a placeholder line is a row that
     cannot be clicked, in a list of rows that can, and the folder's own
     emptiness is already visible from its chevron. */
  if (isLoading || conversations.length === 0) {
    return null;
  }

  /* The same row as a loose chat, just indented to the spec's 31px — a filed
     chat keeps its ⋯ menu, and keeps the pin's 26px slot so both lists truncate
     titles at the same point, but not the pin itself: filing and pinning both
     mean "keep this to hand", and a pin inside a folder silently reorders it.
     Rows animate in and out so filing one reads as a move rather than a
     redraw. */
  return (
    /* Same rhythm as the loose list, from the same constant. */
    <div className="flex flex-col" style={{ rowGap: CHAT_ROW_GAP }}>
    <AnimatePresence initial={false}>
      {conversations.map((convo) => (
        <motion.div
          key={convo.conversationId}
          className="overflow-hidden pl-[22px]"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={
            reduceMotion === true
              ? { duration: 0 }
              : {
                  height: liquid,
                  opacity: { duration: 0.18, ease },
                }
          }
        >
          <Conversation
            conversation={convo}
            retainView={() => undefined}
            toggleNav={onNavigate ?? (() => undefined)}
          />
        </motion.div>
      ))}
    </AnimatePresence>
    </div>
  );
}

function FolderItem({
  folder,
  isActive,
  isOpen,
  onToggle,
  onOpen,
  onDelete,
  onDropChat,
}: {
  folder: TFolder;
  isActive: boolean;
  isOpen: boolean;
  onToggle: (folderId: string) => void;
  onOpen: (folderId: string) => void;
  onDelete: (folder: TFolder) => void;
  onDropChat: (folderId: string, conversationId: string) => void;
}) {
  /* Folders take a dropped chat; date markers deliberately do not — a date is
     a record of when something happened, not a place you can file it. */
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (!isDragOver) {
      return;
    }
    const clear = () => setIsDragOver(false);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [isDragOver]);
  const Icon = isOpen || isActive ? FolderOpenIcon : FolderIcon;
  /* The row does two things at once, as in the reference: it opens the
     folder's own page in the main column AND drops its chats open beneath
     itself in the sidebar. The chevron alone toggles without navigating. */
  const open = () => {
    onOpen(folder.folderId);
    if (!isOpen) {
      onToggle(folder.folderId);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(CONVO_DRAG_TYPE)) {
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        const conversationId = e.dataTransfer.getData(CONVO_DRAG_TYPE);
        const from = e.dataTransfer.getData(CONVO_DRAG_FROM);
        setIsDragOver(false);
        if (!conversationId) {
          return;
        }
        e.preventDefault();
        /* Tell the row a folder took it, so its dragend does not then unfile
           the chat we just filed. */
        convoDrag.handled = true;
        /* Already in this folder — nothing to do. */
        if (from === folder.folderId) {
          return;
        }
        onDropChat(folder.folderId, conversationId);
      }}
      className={cn(
        'group flex h-[34px] w-full flex-shrink-0 items-center gap-[11px] rounded-[8px] px-[9px] text-left transition-colors',
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white',
        isDragOver || isActive ? 'bg-surface-hover text-text-primary' : 'hover:bg-surface-hover',
      )}
    >
      <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13.5px] leading-[20.25px] text-text-primary dark:text-text-secondary">
        {folder.name}
      </span>
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
      <button
        type="button"
        aria-label={folder.name}
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(folder.folderId);
        }}
        className="grid h-[22px] w-[14px] shrink-0 place-items-center text-text-secondary outline-none focus-visible:outline-none"
      >
        {/* The chevron turns on the same curve as the panel it controls. */}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-[380ms] ease-[cubic-bezier(.16,1,.3,1)]',
            isOpen && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

interface FoldersListProps {
  toggleNav?: () => void;
}

const FoldersList = memo(({ toggleNav }: FoldersListProps) => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const navigate = useNavigate();
  const [activeFolderId, setActiveFolderId] = useRecoilState(store.activeFolderId);
  const [isAdding, setIsAdding] = useState(false);
  const [draftName, setDraftName] = useState('');

  const createMutation = useCreateFolderMutation({
    onSuccess: () => {
      setIsAdding(false);
      setDraftName('');
    },
    onError: () => {
      showToast({ message: localize('com_folder_create_failed'), status: 'error' });
      setIsAdding(false);
      setDraftName('');
    },
  });

  /* Blur and Enter share this, so a click elsewhere saves rather than
     silently discarding what was typed. An empty name just cancels. */
  const commitNewFolder = useCallback(() => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setIsAdding(false);
      setDraftName('');
      return;
    }
    if (createMutation.isLoading) {
      return;
    }
    createMutation.mutate({ name: trimmed, sharedMemory: false });
  }, [draftName, createMutation]);
  const [deleteTarget, setDeleteTarget] = useState<TFolder | null>(null);
  // Both disclosures persist per user (designer's rule card): the FOLDERS
  // header state, and each folder's own open state — so collapsing FOLDERS and
  // reopening RESTORES the folders that were open rather than resetting them.
  const [showAllFolders, setShowAllFolders] = useState(false);
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
  const moveConvoToFolder = useMoveConvoToFolderMutation();

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

  /* The folder's page lives on the landing route: ChatView renders
     FolderThreadsView when a folder is active and no conversation is open. */
  const handleOpenFolder = useCallback(
    (folderId: string) => {
      setActiveFolderId(folderId);
      navigate('/c/new');
      toggleNav?.();
    },
    [setActiveFolderId, navigate, toggleNav],
  );

  /* Filing a chat by dragging it onto a folder.
     This MUST go through moveConvoToFolder, not a folderId field update. The
     two list paths are asymmetric on the server: the main list hides anything
     with `folderId` set, but a folder's contents come from a separate
     membership record. Setting the field alone removed the chat from one list
     without adding it to the other — it vanished from the sidebar entirely. */
  const handleDropChat = useCallback(
    (targetFolderId: string, conversationId: string) => {
      setOpenFolderIds((prev) => {
        const next = { ...prev, [targetFolderId]: true };
        try {
          localStorage.setItem('nashOpenFolderIds', JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
        return next;
      });
      moveConvoToFolder.mutate(
        { conversationId, folderId: targetFolderId },
        {
          onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
        },
      );
    },
    [moveConvoToFolder, showToast, localize],
  );

  const handleDeleteRequest = useCallback((folder: TFolder) => {
    setDeleteTarget(folder);
  }, []);

  /* The sidebar shows five folders and puts the rest behind Show more. The
     folder list shares one scrolling region with the chats, so an unbounded
     list of folders pushes the chats off the bottom of the panel — the thing
     most people are actually reaching for. */
  const visibleFolders = useMemo(() => folders?.slice(0, VISIBLE_FOLDER_LIMIT) ?? [], [folders]);
  const overflowFolders = useMemo(() => folders?.slice(VISIBLE_FOLDER_LIMIT) ?? [], [folders]);

  const renderFolder = useCallback(
    (folder: TFolder) => (
      <Fragment key={folder.folderId}>
        <FolderItem
          folder={folder}
          isActive={activeFolderId === folder.folderId}
          isOpen={openFolderIds[folder.folderId] === true}
          onToggle={handleToggleFolder}
          onOpen={handleOpenFolder}
          onDelete={handleDeleteRequest}
          onDropChat={handleDropChat}
        />
        <Collapse open={openFolderIds[folder.folderId] === true}>
          <FolderChats folderId={folder.folderId} onNavigate={toggleNav} />
        </Collapse>
      </Fragment>
    ),
    [
      activeFolderId,
      openFolderIds,
      handleToggleFolder,
      handleOpenFolder,
      handleDeleteRequest,
      handleDropChat,
      toggleNav,
    ],
  );

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
      {/* Figma `.sechead.row`: the label takes the slack, then a 22px add
          button and the 14px chevron — both in flow and always visible, not
          revealed on hover. */}
      <div className="group mb-1 flex h-8 flex-shrink-0 items-center gap-[6px] rounded-[8px] px-[9px] transition-colors hover:bg-surface-hover">
        <button
          type="button"
          onClick={() => setIsExpanded((open) => !open)}
          aria-expanded={isExpanded}
          className="h-full flex-1 select-none text-left text-[11px] font-medium uppercase leading-[16.5px] tracking-[0.06em] text-text-secondary outline-none focus-visible:outline-none"
        >
          {localize('com_folder_folders')}
        </button>
        <TooltipAnchor description={localize('com_folder_create')} side="right">
          <button
            type="button"
            aria-label={localize('com_folder_create')}
            className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-[6px] text-text-secondary outline-none transition-colors hover:bg-surface-active hover:text-text-primary focus-visible:outline-none"
            onClick={() => {
              setIsExpanded(true);
              setDraftName('');
              setIsAdding(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipAnchor>
        <button
          type="button"
          aria-label={localize('com_folder_folders')}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((open) => !open)}
          className="grid h-[22px] w-[14px] flex-shrink-0 place-items-center text-text-secondary outline-none focus-visible:outline-none"
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-hover',
              isExpanded ? '' : '-rotate-90',
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* A folder is named in place, on the row it will occupy — no dialog.
          Enter or blur commits, Escape abandons it. The row grows into place
          rather than appearing. */}
      <Collapse open={isAdding}>
        <div className="flex h-[34px] flex-shrink-0 items-center gap-[11px] rounded-[8px] px-[9px] text-text-secondary">
          <FolderIcon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <input
            autoFocus
            value={draftName}
            placeholder={localize('com_folder_name_placeholder')}
            aria-label={localize('com_folder_create')}
            disabled={createMutation.isLoading}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitNewFolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitNewFolder();
              }
              if (e.key === 'Escape') {
                setIsAdding(false);
                setDraftName('');
              }
            }}
            // Firefox paints its own focus outline on a focused input; the
            // naming row is already obviously focused, so suppress it here
            // rather than framing the whole row in white.
            style={{ outline: 'none', boxShadow: 'none' }}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12.5px] text-text-primary outline-none ring-0 focus:outline-none focus-visible:outline-none placeholder:text-text-tertiary"
          />
        </div>
      </Collapse>

      {/* FOLDERS collapses the whole list; each folder collapses its own
          chats. Both travel rather than blinking in and out. */}
      <Collapse open={isExpanded}>
        {visibleFolders.map(renderFolder)}
        {/* The folders past the cap. §10: nothing opens or closes instantly,
            so they travel in on the same height-auto spring as every other
            disclosure here rather than appearing. */}
        <Collapse open={showAllFolders}>{overflowFolders.map(renderFolder)}</Collapse>
        {overflowFolders.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAllFolders((shown) => !shown)}
            aria-expanded={showAllFolders}
            /* Starts on the icon column, not the label column — it acts on the
               list as a whole rather than being another folder in it. --t4,
               a step below the folder names, for the same reason. */
            className="group flex h-[34px] w-full flex-shrink-0 items-center gap-[6px] rounded-[8px] px-[9px] text-left text-[12.5px] leading-[19px] text-text-tertiary outline-none transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
          >
            <span className="select-none">
              {showAllFolders ? localize('com_ui_show_less') : localize('com_ui_show_more')}
            </span>
            {/* §10 rule 4: the affordance moves with the disclosure — one
                chevron that rotates, never a second icon swapped in. */}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-[380ms] ease-[cubic-bezier(.16,1,.3,1)]',
                showAllFolders ? 'rotate-180' : '',
              )}
            />
          </button>
        )}
      </Collapse>


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
