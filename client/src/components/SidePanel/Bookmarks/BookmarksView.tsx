import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { matchSorter } from 'match-sorter';
import { TooltipAnchor, Button, useMediaQuery, useToastContext } from '@librechat/client';
import { PermissionTypes, Permissions, QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TConversationTag,
  TSavedMessage,
  TSavedMessageFolder,
} from 'librechat-data-provider';
import type { ContextType } from '~/common';
import {
  useConversationTagsQuery,
  useSavedMessagesQuery,
  useSavedMessageFoldersQuery,
  useCreateSavedMessageFolderMutation,
  useUpdateSavedMessageFolderMutation,
  useDeleteSavedMessageFolderMutation,
  useUnsaveMessageMutation,
  useSaveMessageMutation,
} from '~/data-provider';
import SearchField from '~/components/ui/SearchField';
import { useDocumentTitle, useHasAccess, useLocalize } from '~/hooks';
import { SidePanelProvider, useChatContext } from '~/Providers';
import { BookmarkContext } from '~/Providers/BookmarkContext';
import { SidePanelGroup } from '~/components/SidePanel';
import CollapsedNavRail from '~/components/Nav/CollapsedNavRail';
import FoldersGrid from './FoldersGrid';
import BookmarkRowMenu from './BookmarkRowMenu';
import EditNoteDialog from './EditNoteDialog';
import MoveBookmarkDialog from './MoveBookmarkDialog';
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
import BookmarkRow from './BookmarkRow';
import FolderContents from './FolderContents';
import FolderFormDialog from './FolderFormDialog';
import DeleteFolderDialog, { type DeleteFolderOutcome } from './DeleteFolderDialog';
import { clearMessagesCache, cn } from '~/utils';

const pageSize = 12;

/**
 * Full-page Bookmarks experience (Figma teal redesign, frames 30/55-58).
 *
 * Mirrors the persona Marketplace shell (SidePanelProvider > SidePanelGroup >
 * main) but is wired to conversation-tag bookmarks. Per the "real fields only"
 * mandate it renders only fields that exist on TConversationTag (tag, count,
 * description, createdAt) — no fabricated content-type / TL;DR / source. The
 * content-type filter tabs surface the honest category-empty state since
 * conversation tags carry no content-type classification.
 */
export default function BookmarksView() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { conversation, newConversation } = useChatContext();

  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();

  const { data, isLoading, isError, refetch } = useConversationTagsQuery();
  // Bookmarked assistant replies. Until this was wired the page listed only
  // conversation tags, so a saved response was stored and shown nowhere — and
  // the "Responses" tab below rendered a permanent empty state.
  const { data: savedData, isLoading: savedLoading } = useSavedMessagesQuery();

  const [searchQuery, setSearchQuery] = useState('');
  const [noteTarget, setNoteTarget] = useState<TSavedMessage | null>(null);
  const [moveTarget, setMoveTarget] = useState<TSavedMessage | null>(null);
  const [view, setView] = useState<BookmarkView>('list');
  const [sort, setSort] = useState<BookmarkSort>('recent');
  const [kind, setKind] = useState<KindFilter>('all');
  const unsave = useUnsaveMessageMutation();
  const resave = useSaveMessageMutation();

  /* The same two actions the folder page offers, so a response behaves
     identically whichever list you found it in. */
  const handleCopyResponse = async (saved: TSavedMessage) => {
    try {
      await navigator.clipboard.writeText(saved.text ?? '');
      showToast({ message: localize('com_ui_copied'), status: 'success' });
    } catch {
      showToast({ message: localize('com_ui_error'), status: 'error' });
    }
  };

  const handleRemoveBookmark = (removed: TSavedMessage) => {
    unsave.mutate(removed.messageId, {
      onSuccess: () =>
        showToast({
          message: localize('com_ui_bookmarks_removed'),
          status: 'success',
          duration: 6000,
          action: {
            label: localize('com_ui_undo'),
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
                folderId: removed.folderId,
              }),
          },
        }),
      onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
    });
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useDocumentTitle(`${localize('com_ui_bookmarks')} | Nash`);

  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    if (!hasAccessToBookmarks) {
      timeoutId = setTimeout(() => navigate('/c/new'), 1000);
    }
    return () => clearTimeout(timeoutId);
  }, [hasAccessToBookmarks, navigate]);

  /* [F1] The page is a grid of FOLDERS now, not a list of tags. The folders
     endpoint already returns name, description, savedCount and lastSavedAt —
     exactly the card — plus a trailing virtual "unsorted" row. */
  const {
    data: foldersData,
    isLoading: foldersLoading,
    isError: foldersError,
    refetch: refetchFolders,
  } = useSavedMessageFoldersQuery();

  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  /* One sheet serves New folder, Rename and Edit description — they differ
     only in which field takes focus and what the primary button says. */
  const [editing, setEditing] = useState<{
    folder?: TSavedMessageFolder;
    focus: 'name' | 'description';
  } | null>(null);
  const [deleting, setDeleting] = useState<TSavedMessageFolder | null>(null);

  const createFolder = useCreateSavedMessageFolderMutation();
  const updateFolder = useUpdateSavedMessageFolderMutation();
  const deleteFolder = useDeleteSavedMessageFolderMutation();
  const { folderId } = useParams<{ folderId?: string }>();
  const openFolder = useMemo(
    () => (Array.isArray(foldersData) ? foldersData : []).find((f) => f.folderId === folderId),
    [foldersData, folderId],
  );

  /* Unsorted is NOT a folder — it is the absence of one. It never takes a
     card; its contents are listed beneath the grid (DESIGN.md §13). */
  const visibleFolders = useMemo(() => {
    const list = (Array.isArray(foldersData) ? foldersData : []).filter(
      (f) => f.virtual !== true,
    );
    if (!searchQuery) {
      return list;
    }
    return matchSorter(list, searchQuery, {
      keys: ['name', 'description'],
      threshold: matchSorter.rankings.CONTAINS,
    });
  }, [foldersData, searchQuery]);

  /* Only what is in no folder. A filed response lives inside its folder and
     nowhere else, so this list and the cards can never double-count. */
  const { data: unfiledData, isLoading: unfiledLoading } = useSavedMessagesQuery('unsorted');
  const unfiled = useMemo(() => {
    const list = Array.isArray(unfiledData) ? unfiledData : [];
    if (!searchQuery) {
      return sortSavedMessages(list, sort);
    }
    return sortSavedMessages(
      matchSorter(list, searchQuery, {
        keys: ['text', 'note', 'title', 'model'],
        threshold: matchSorter.rankings.CONTAINS,
      }),
      sort,
    );
  }, [unfiledData, searchQuery, sort]);

  /* Built from the searched rows, before the kind filter — see FolderContents. */
  const unfiledByKind = useMemo(() => filterByKind(unfiled, kind), [unfiled, kind]);

  /* A heading separates one group from another. With only one group on the
     page there is nothing to separate, so neither heading appears. */
  const showHeadings = visibleFolders.length > 0 && unfiled.length > 0;

  const bookmarks: TConversationTag[] = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    // Dedup by tag name: it is the per-user unique key (DynamoDB sk = TAG#{tag}).
    // The Flask /api/tags payload carries no `_id`, so keying on `_id` here would
    // collapse the whole list to a single row.
    const seen = new Set<string>();
    return list.filter((bookmark) => {
      if (seen.has(bookmark.tag)) {
        return false;
      }
      seen.add(bookmark.tag);
      return true;
    });
  }, [data]);

  const filteredBookmarks = useMemo(() => {
    if (!searchQuery) {
      return bookmarks;
    }
    return matchSorter(bookmarks, searchQuery, {
      keys: ['tag', 'description'],
      threshold: matchSorter.rankings.CONTAINS,
    });
  }, [bookmarks, searchQuery]);


  const savedResponses: TSavedMessage[] = useMemo(() => {
    const list = savedData ?? [];
    if (!searchQuery) {
      return list;
    }
    return matchSorter(list, searchQuery, {
      keys: ['text', 'note', 'title', 'model'],
      threshold: matchSorter.rankings.CONTAINS,
    });
  }, [savedData, searchQuery]);

  const goToChats = () => navigate('/c/new');

  if (!hasAccessToBookmarks) {
    return null;
  }

  return (
    <BookmarkContext.Provider value={{ bookmarks }}>
      <div className="relative flex w-full grow overflow-hidden bg-presentation">
        <SidePanelProvider>
          <SidePanelGroup>
            <main className="flex h-full flex-col overflow-hidden" role="main">
              <div
                ref={scrollContainerRef}
                className={cn(
                  'scrollbar-gutter-stable relative flex h-full flex-col overflow-x-hidden',
                  folderId != null ? 'overflow-y-hidden' : 'overflow-y-auto',
                )}
              >
                {/* Top nav controls (only when the left sidebar is hidden) */}
                {!isSmallScreen && (
                  <div className="sticky top-0 z-20 flex items-start justify-between bg-presentation px-2 pt-4 md:min-h-14">
                    <div className="mx-1 flex items-center gap-2">
                      {!navVisible ? (
                        <CollapsedNavRail setNavVisible={setNavVisible} />
                      ) : (
                        <div className="h-8 w-8" />
                      )}
                    </div>
                  </div>
                )}

                {/* Inside a folder the page is a split: list beside a fixed
                    320 detail rail, each scrolling on its own. */}
                {folderId != null ? (
                  <div className="flex min-h-0 flex-1">
                    <FolderContents folderId={folderId} folder={openFolder} />
                  </div>
                ) : (
                /* §13 page chrome: 34 / 40 / 60 desktop, 6 / 16 / 44 mobile. */
                <div className="w-full px-4 pb-[44px] pt-[6px] md:px-[40px] md:pb-[60px] md:pt-[2px]">

                  {/* [F1] Header: 30/600 title over a 13.5 sub, with New
                      folder hard right at 39 tall. */}
                  <header className="flex flex-row items-start justify-between gap-4">

                    <div className="min-w-0">
                      <h1 className="text-[30px] font-semibold leading-[38px] tracking-[-0.5px] text-text-primary">
                        {localize('com_ui_bookmarks')}
                      </h1>
                      <p className="mt-[7px] max-w-2xl text-[13.5px] leading-[20px] text-text-secondary-alt">
                        {localize('com_ui_bookmarks_subtitle')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-start">
                      {/* Icon only. The label lives in the tooltip and the
                          aria-label — a page has one create action and a `+` at
                          the top right is where every other page puts it, so
                          the word was restating the position. */}
                      <TooltipAnchor
                        description={localize('com_ui_bookmarks_new_folder')}
                        side="left"
                        render={
                          <button
                            type="button"
                            onClick={() => setEditing({ focus: 'name' })}
                            aria-label={localize('com_ui_bookmarks_new_folder')}
                            className="grid size-[39px] shrink-0 place-items-center rounded-[10px] bg-text-primary text-surface-primary transition-opacity hover:opacity-90 focus:outline-none"
                          >
                            <Plus size={17} aria-hidden="true" />
                          </button>
                        }
                      />
                    </div>
                  </header>

                  {/* Search · sort · view. All three control the list below
                      them, so they sit on the list's own row — the toggle was up
                      in the header beside "New folder", which is a page action,
                      not a way of looking at the results. */}
                  <div className="flex items-center gap-[10px] pt-[20px]">
                    <SearchField
                      value={searchQuery}
                      onChange={setSearchQuery}
                      onClear={() => setSearchQuery('')}
                      placeholder={localize('com_ui_search_bookmarks')}
                    />
                    <SortMenu sort={sort} onChange={setSort} />
                    <ViewToggle view={view} onChange={setView} />
                  </div>

                  <div className="pb-1 pt-4 empty:hidden">
                    <KindFilterPills rows={unfiled} active={kind} onChange={setKind} />
                  </div>

                  {/* [F1/F2/F3/F9] Folders, then whatever is in none of them. */}
                  <div className="pt-[22px]">
                    {showHeadings && (
                      <h2 className="mb-2 flex h-8 items-center gap-[7px] px-[2px] text-[11px] font-medium uppercase leading-[16.5px] tracking-[0.06em] text-text-secondary">
                        {localize('com_ui_bookmarks_folders')}
                        <span className="text-text-tertiary">·</span>
                        <span className="text-text-tertiary">{visibleFolders.length}</span>
                      </h2>
                    )}
                    <FoldersGrid
                      folders={visibleFolders}
                      hasUnfiled={unfiled.length > 0}
                      isLoading={foldersLoading || unfiledLoading}
                      isError={foldersError}
                      onRetry={() => refetchFolders()}
                      onOpenFolder={(id) => navigate(`/bookmarks/${id}`)}
                      onRename={(folder) => setEditing({ folder, focus: 'name' })}
                      onEditDescription={(folder) =>
                        setEditing({ folder, focus: 'description' })
                      }
                      onDelete={(folder) => setDeleting(folder)}
                    />

                    {unfiled.length > 0 && !foldersLoading && !unfiledLoading && (
                      <>
                        {showHeadings && (
                          <h2 className="mb-2 mt-[26px] flex h-8 items-center gap-[7px] px-[2px] text-[11px] font-medium uppercase leading-[16.5px] tracking-[0.06em] text-text-secondary">
                            {localize('com_ui_bookmarks_unsorted')}
                            <span className="text-text-tertiary">·</span>
                            <span className="text-text-tertiary">{unfiledByKind.length}</span>
                          </h2>
                        )}
                        <div className={bookmarkListClass(view)}>
                          {unfiledByKind.map((saved) => (
                            <BookmarkRow
                              key={saved.messageId}
                              saved={saved}
                              isSelected={false}
                              onSelect={() =>
                                saved.conversationId != null &&
                                navigate(`/c/${saved.conversationId}`)
                              }
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
                                  onOpenInChat={() =>
                                    saved.conversationId != null &&
                                    navigate(`/c/${saved.conversationId}`)
                                  }
                                  onEditNote={() => setNoteTarget(saved)}
                                  onMoveToFolder={() => setMoveTarget(saved)}
                                  onCopy={() => handleCopyResponse(saved)}
                                  onRemove={() => handleRemoveBookmark(saved)}
                                />
                              }
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                )}
              </div>

              <FolderFormDialog
                open={editing != null}
                onOpenChange={(next) => !next && setEditing(null)}
                title={
                  editing?.folder == null
                    ? localize('com_ui_bookmarks_new_folder_title')
                    : editing.focus === 'description'
                      ? localize('com_ui_bookmarks_edit_description')
                      : localize('com_ui_bookmarks_rename_folder')
                }
                initialName={editing?.folder?.name ?? ''}
                initialDescription={editing?.folder?.description ?? ''}
                focusField={editing?.focus ?? 'name'}
                submitLabel={
                  editing?.folder == null
                    ? localize('com_ui_create')
                    : localize('com_ui_save')
                }
                isSubmitting={createFolder.isLoading || updateFolder.isLoading}
                onSubmit={({ name, description }) => {
                  const done = (message: string) => {
                    setEditing(null);
                    showToast({ message, status: 'success' });
                  };
                  const fail = () =>
                    showToast({ message: localize('com_ui_error'), status: 'error' });

                  if (editing?.folder == null) {
                    createFolder.mutate(
                      {
                        name,
                        /* Never created blank (DESIGN.md §10.13) — a folder
                           with no description is the state the rule exists to
                           prevent. It is an ordinary editable value from here:
                           no badge, no regeneration, no prompt to confirm it. */
                        description:
                          description || localize('com_ui_bookmarks_default_description'),
                      },
                      {
                        onSuccess: () => done(localize('com_ui_bookmarks_folder_created')),
                        onError: fail,
                      },
                    );
                    return;
                  }
                  updateFolder.mutate(
                    { folderId: editing.folder.folderId, name, description },
                    {
                      onSuccess: () => done(localize('com_ui_bookmarks_folder_updated_toast')),
                      onError: fail,
                    },
                  );
                }}
              />

              <DeleteFolderDialog
                open={deleting != null}
                onOpenChange={(next) => !next && setDeleting(null)}
                folderName={deleting?.name ?? ''}
                savedCount={deleting?.savedCount ?? 0}
                isSubmitting={deleteFolder.isLoading}
                onConfirm={(outcome: DeleteFolderOutcome) => {
                  if (deleting == null) {
                    return;
                  }
                  const folderId = deleting.folderId;
                  const finish = () =>
                    deleteFolder.mutate(folderId, {
                      onSuccess: () => {
                        setDeleting(null);
                        showToast({
                          message: localize('com_ui_bookmarks_folder_deleted'),
                          status: 'success',
                        });
                      },
                      onError: () =>
                        showToast({ message: localize('com_ui_error'), status: 'error' }),
                    });

                  if (outcome !== 'purge') {
                    /* The server reparents members to Unsorted on delete, which
                       IS the "keep the responses" outcome. */
                    finish();
                    return;
                  }

                  /* "Delete everything in it" has no server-side equivalent —
                     the endpoint always reparents — so the contents are removed
                     first, and the folder only goes if that succeeded. Failing
                     the other way round would silently keep the responses. */
                  void (async () => {
                    try {
                      const rows = await dataService.getSavedMessages(folderId);
                      await Promise.all(
                        (Array.isArray(rows) ? rows : []).map((row) =>
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
            </main>
          </SidePanelGroup>
        </SidePanelProvider>
      </div>
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
    </BookmarkContext.Provider>
  );
}
