import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Search, BookmarkIcon } from 'lucide-react';
import { matchSorter } from 'match-sorter';
import { useToastContext } from '@librechat/client';
import type { TSavedMessage, TSavedMessageFolder } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import {
  useSavedMessagesQuery,
  useUnsaveMessageMutation,
  useSaveMessageMutation,
  useUpdateSavedMessageFolderMutation,
  useDeleteSavedMessageFolderMutation,
} from '~/data-provider';
import { dataService } from 'librechat-data-provider';
import BookmarkRow from './BookmarkRow';
import BookmarkRowMenu from './BookmarkRowMenu';
import EditNoteDialog from './EditNoteDialog';
import MoveBookmarkDialog from './MoveBookmarkDialog';
import FolderMenu from './FolderMenu';
import FolderFormDialog from './FolderFormDialog';
import DeleteFolderDialog from './DeleteFolderDialog';
import type { DeleteFolderOutcome } from './DeleteFolderDialog';
import {
  ViewToggle,
  SortMenu,
  bookmarkListClass,
  sortSavedMessages,
  KindFilterPills,
  filterByKind,
  type BookmarkView,
  type BookmarkSort,
  type KindFilter,
} from './BookmarkControls';

/**
 * Inside a folder [I1, I3].
 *
 * One full-width column: breadcrumb, folder name + description, search, then
 * the list. There was a 320px detail rail beside it; the row's ⋯ menu carries
 * everything it offered — open, edit the note, move, copy, remove — without
 * spending a third of the page on a second copy of a response you can already
 * read in the row.
 */
export default function FolderContents({
  folderId,
  folder,
}: {
  folderId: string;
  folder?: TSavedMessageFolder;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const [query, setQuery] = useState('');
  const [noteTarget, setNoteTarget] = useState<TSavedMessage | null>(null);
  const [moveTarget, setMoveTarget] = useState<TSavedMessage | null>(null);
  const [view, setView] = useState<BookmarkView>('list');
  const [sort, setSort] = useState<BookmarkSort>('recent');
  const [kind, setKind] = useState<KindFilter>('all');
  const [editingFolder, setEditingFolder] = useState<'name' | 'description' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading } = useSavedMessagesQuery(folderId);
  const unsave = useUnsaveMessageMutation();
  const resave = useSaveMessageMutation();
  const updateFolder = useUpdateSavedMessageFolderMutation();
  const deleteFolder = useDeleteSavedMessageFolderMutation();

  const searched: TSavedMessage[] = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    /* Search covers the response text AND your note — the spec treats a match
       in a note as a different kind of hit, so both are keys here. Sorting is
       applied after, so the chosen order holds whether or not you searched. */
    const found = !query
      ? list
      : matchSorter(list, query, {
          keys: ['text', 'note', 'title', 'model'],
          threshold: matchSorter.rankings.CONTAINS,
        });
    return sortSavedMessages(found, sort);
  }, [data, query, sort]);

  /* The strip is built from the searched rows, not the filtered ones — built
     from the filtered set, choosing "Code" would leave Code as the only pill
     and strand you there. */
  const rows = useMemo(() => filterByKind(searched, kind), [searched, kind]);

  const handleRemove = (removed: TSavedMessage) => {
    /* Single item = act now, undo in the toast. Confirm dialogs are for
       folders (many items), not single rows. */
    unsave.mutate(removed.messageId, {
      onSuccess: () => {
        showToast({
          message: localize('com_ui_bookmarks_removed'),
          status: 'success',
          duration: 6000,
          action: {
            label: localize('com_ui_undo'),
            /* Re-save restores the row: the endpoint is idempotent on
               messageId and keeps note, folder and createdAt. */
            onClick: () =>
              resave.mutate({
                messageId: removed.messageId,
                conversationId: removed.conversationId,
                text: removed.text,
                title: removed.title,
                model: removed.model,
                endpoint: removed.endpoint,
                context: removed.context,
                note: removed.note,
                folderId: removed.folderId ?? folderId,
              }),
          },
        });
      },
      onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
    });
  };

  const handleOpenInChat = (saved: TSavedMessage) => {
    if (saved.conversationId != null) {
      navigate(`/c/${saved.conversationId}`);
    }
  };

  const handleCopy = async (saved: TSavedMessage) => {
    try {
      await navigator.clipboard.writeText(saved.text ?? '');
      showToast({ message: localize('com_ui_copied'), status: 'success' });
    } catch {
      showToast({ message: localize('com_ui_error'), status: 'error' });
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-[44px] pt-[6px] md:px-[40px] md:pb-[60px] md:pt-[2px]">
        <button
          type="button"
          onClick={() => navigate('/bookmarks')}
          className="mb-[8px] inline-flex h-[19px] w-fit items-center gap-2 text-[13px] leading-[19px] text-text-tertiary transition-colors hover:text-text-primary"
        >
          <ChevronLeft className="h-[15px] w-[15px]" aria-hidden="true" />
          <span>{localize('com_ui_bookmarks')}</span>
          <span aria-hidden="true">/</span>
          <span className="truncate text-text-secondary">{folder?.name ?? ''}</span>
        </button>

        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[30px] font-semibold leading-[38px] tracking-[-0.5px] text-text-primary">
              {folder?.name ?? ''}
            </h1>
            {folder?.description != null && folder.description !== '' && (
              <p className="mt-[7px] line-clamp-2 max-w-[520px] text-[13.5px] leading-[20px] text-text-secondary-alt">
                {folder.description}
              </p>
            )}
          </div>
          {/* The folder's own actions live beside its name, which is the only
              place on this screen that is about the folder rather than about
              what is in it. Same ⋯ as the folder card in the grid. */}
          <div className="flex shrink-0 items-center gap-2">
            <ViewToggle view={view} onChange={setView} />
            <FolderMenu
              label={folder?.name ?? ''}
              onRename={() => setEditingFolder('name')}
              onEditDescription={() => setEditingFolder('description')}
              onDelete={() => setConfirmDelete(true)}
            />
          </div>
        </header>

        <div className="mt-[18px] flex items-center gap-[10px]">
          <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={localize('com_ui_search_bookmarks')}
            aria-label={localize('com_ui_search_bookmarks')}
              className="h-10 w-full rounded-[10px] bg-surface-secondary pl-[38px] pr-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
          </div>
          <SortMenu sort={sort} onChange={setSort} />
        </div>

        <div className="mb-1 mt-4 empty:hidden">
          <KindFilterPills rows={searched} active={kind} onChange={setKind} />
        </div>

        <div className={cn('mt-[18px]', bookmarkListClass(view))}>
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              /* BookmarkRow's own shell — radius 13 on --surface at 15/13
                 padding, with a meta line and two body lines. A blank 110px
                 block is a different height and a different shape from the row
                 it stands in for, so the list jumped when the data landed. */
              <div
                key={i}
                className="flex flex-col gap-[10px] nash-card rounded-[13px] px-[15px] py-[13px]"
                aria-hidden="true"
              >
                <div className="flex h-[17px] items-center gap-[8px]">
                  <div className="h-[13px] w-[13px] shrink-0 animate-pulse rounded-[4px] bg-surface-hover" />
                  <div className="h-[10px] w-[34%] animate-pulse rounded-[5px] bg-surface-hover" />
                  <div className="ml-auto h-[10px] w-[16%] animate-pulse rounded-[5px] bg-surface-hover" />
                </div>
                <div className="h-[11px] w-[92%] animate-pulse rounded-[5px] bg-surface-hover" />
                <div className="h-[11px] w-[64%] animate-pulse rounded-[5px] bg-surface-hover" />
              </div>
            ))}

          {!isLoading &&
            rows.map((saved) => (
              <BookmarkRow
                key={saved.messageId}
                saved={saved}
                isSelected={false}
                onSelect={() => handleOpenInChat(saved)}
                noteLabel={localize('com_ui_bookmarks_note')}
                chatLabel={localize('com_ui_bookmarks_from_chat')}
                untitledLabel={localize('com_ui_untitled')}
                openHintLabel={localize('com_ui_bookmarks_open_in_chat')}
                imageLabel={localize('com_ui_bookmarks_image')}
                imagesLabel={localize('com_ui_bookmarks_images')}
                tableLabel={localize('com_ui_bookmarks_table')}
                deletedLabel={localize('com_ui_bookmarks_chat_deleted_chip')}
                timestamp={
                  saved.createdAt != null && saved.createdAt !== ''
                    ? new Date(saved.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    : ''
                }
                menu={
                  <BookmarkRowMenu
                    onOpenInChat={() => handleOpenInChat(saved)}
                    onEditNote={() => setNoteTarget(saved)}
                    onMoveToFolder={() => setMoveTarget(saved)}
                    onCopy={() => handleCopy(saved)}
                    onRemove={() => handleRemove(saved)}
                  />
                }
              />
            ))}

          {/* [I3] The folder exists but is empty — offer the gesture that
              fills it rather than only stating the absence. */}
          {!isLoading && rows.length === 0 && (
            /* No fill. A filled slab is how this page draws a bookmark, so an
               empty folder was drawing one large bookmark-shaped thing to say
               it has none. The words carry it. */
            <div className="flex flex-col items-center justify-center px-6 py-[64px] text-center">
              <span className="mb-4 grid h-[56px] w-[56px] place-items-center rounded-full bg-surface-hover text-text-secondary">
                <BookmarkIcon className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="text-[15px] font-medium leading-[22px] text-text-primary">
                {query !== ''
                  ? localize('com_ui_bookmarks_no_results')
                  : localize('com_ui_bookmarks_folder_empty')}
              </p>
              <p className="mt-2 max-w-[420px] text-[13px] leading-[20px] text-text-secondary">
                {query !== ''
                  ? localize('com_ui_bookmarks_no_results_body')
                  : localize('com_ui_bookmarks_folder_empty_body')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Rename / edit description / delete — the same dialogs the folder card
          in the grid opens, so the folder behaves identically wherever you act
          on it. Delete always confirms: §11.10's act-now-and-undo is for a
          single row, not for a container and everything in it. */}
      <FolderFormDialog
        open={editingFolder != null}
        onOpenChange={(next) => !next && setEditingFolder(null)}
        title={localize('com_ui_bookmarks_rename_folder')}
        initialName={folder?.name ?? ''}
        initialDescription={folder?.description ?? ''}
        focusField={editingFolder ?? 'name'}
        submitLabel={localize('com_ui_save')}
        isSubmitting={updateFolder.isLoading}
        onSubmit={({ name, description }) =>
          updateFolder.mutate(
            { folderId, name, description },
            {
              onSuccess: () => {
                setEditingFolder(null);
                showToast({
                  message: localize('com_ui_bookmarks_folder_updated_toast'),
                  status: 'success',
                });
              },
              onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
            },
          )
        }
      />
      <DeleteFolderDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        folderName={folder?.name ?? ''}
        savedCount={rows.length}
        isSubmitting={deleteFolder.isLoading}
        onConfirm={(outcome: DeleteFolderOutcome) => {
          const finish = () =>
            deleteFolder.mutate(folderId, {
              onSuccess: () => {
                setConfirmDelete(false);
                showToast({
                  message: localize('com_ui_bookmarks_folder_deleted'),
                  status: 'success',
                });
                navigate('/bookmarks');
              },
              onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
            });

          if (outcome !== 'purge') {
            /* The server reparents members to Unsorted on delete, which IS the
               "keep the responses" outcome. */
            finish();
            return;
          }
          /* "Delete everything in it" has no server-side equivalent, so the
             contents go first and the folder only follows if that worked —
             the other order would silently keep the responses. */
          void (async () => {
            try {
              const members = await dataService.getSavedMessages(folderId);
              await Promise.all(
                (Array.isArray(members) ? members : []).map((row) =>
                  dataService.deleteSavedMessage(row.messageId),
                ),
              );
              finish();
            } catch {
              showToast({ message: localize('com_ui_error'), status: 'error' });
            }
          })();
        }}
      />

      <EditNoteDialog
        saved={noteTarget ?? undefined}
        open={noteTarget != null}
        onOpenChange={(next) => !next && setNoteTarget(null)}
      />
      <MoveBookmarkDialog
        saved={moveTarget ?? undefined}
        open={moveTarget != null}
        onOpenChange={(next) => !next && setMoveTarget(null)}
      />
    </div>
  );
}
