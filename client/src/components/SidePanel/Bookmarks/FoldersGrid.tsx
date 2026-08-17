import { useNavigate } from 'react-router-dom';
import { BookmarkIcon, AlertCircle } from 'lucide-react';
import type { TSavedMessageFolder } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import FolderCard from './FolderCard';
import FolderMenu from './FolderMenu';
import { formatFolderAge } from './folderTime';

/** Three across on a wide screen, two on a medium one, one on a phone — with
 *  each card capped at the ~400 §13 asks for, so a wide window spaces them out
 *  rather than stretching them. */
const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

/**
 * F3 — the folder card's own geometry, block for block, so nothing shifts when
 * the data lands.
 *
 * It had drifted from the card it stands in for: a fixed 104 height where the
 * card is content-sized, a 31px tile at radius 9 against the card's 26 at
 * radius 8, and three hand-tuned `mt-` values instead of the card's single
 * 12px container gap. Everything here now mirrors FolderCard directly — same
 * padding, same gap, same three blocks at the same heights.
 */
function SkeletonGrid() {
  return (
    <div className={GRID} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex max-w-[400px] flex-col gap-3 nash-card rounded-[13px] p-4"
        >
          {/* header: 26 tile + title */}
          <div className="flex h-[26px] items-center gap-2">
            <div className="h-[26px] w-[26px] shrink-0 animate-pulse rounded-[8px] bg-surface-hover" />
            <div className="h-[12px] w-[42%] animate-pulse rounded-[5px] bg-surface-hover" />
          </div>
          {/* description: one clamped line at 20px */}
          <div className="flex h-[20px] items-center">
            <div className="h-[11px] w-[86%] animate-pulse rounded-[5px] bg-surface-hover" />
          </div>
          {/* derived row: "n saved · Updated today" at 17px */}
          <div className="flex h-[17px] items-center">
            <div className="h-[10px] w-[46%] animate-pulse rounded-[5px] bg-surface-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* DESIGN.md §4: "Empty vs error — they never share a layout." So they do not
   share a component either. Empty is a centred invitation with a next action;
   error is a left-aligned band that states the data is safe and offers Retry. */

export default function FoldersGrid({
  folders,
  hasUnfiled = false,
  isLoading,
  isError,
  onRetry,
  onOpenFolder,
  onRename,
  onEditDescription,
  onDelete,
}: {
  folders: TSavedMessageFolder[];
  /** Unfiled responses render beneath this grid; the page-level empty state
   *  belongs to the PAGE, so it only fires when both groups are empty. */
  hasUnfiled?: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenFolder: (folderId: string) => void;
  onRename: (folder: TSavedMessageFolder) => void;
  onEditDescription: (folder: TSavedMessageFolder) => void;
  onDelete: (folder: TSavedMessageFolder) => void;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();

  if (isLoading) {
    return <SkeletonGrid />;
  }

  /* F9 — "Reassures that nothing is lost, offers Retry. Distinct from empty:
     an error must never look like 'you have nothing'." */
  if (isError) {
    return (
      <div className="flex items-center gap-3 nash-card rounded-[13px] px-[18px] py-[16px]">
        <AlertCircle
          className="h-[17px] w-[17px] shrink-0 text-text-destructive"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium leading-[20px] text-text-primary">
            {localize('com_ui_bookmarks_load_failed')}
          </p>
          <p className="mt-[2px] text-[12.5px] leading-[19px] text-text-secondary">
            {localize('com_ui_bookmarks_load_failed_body')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="h-[34px] shrink-0 rounded-[9px] bg-surface-hover px-[15px] text-[12.5px] font-medium text-text-primary transition-colors hover:bg-surface-active"
        >
          {localize('com_ui_retry')}
        </button>
      </div>
    );
  }

  /* F2 — first run. Explains the hover-to-save gesture rather than just
     saying "empty", and sends you to a chat. */
  if (folders.length === 0 && !hasUnfiled) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-[68px] text-center">
        <span className="mb-4 grid h-[56px] w-[56px] place-items-center nash-card rounded-full text-text-secondary">
          <BookmarkIcon className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="text-[15px] font-medium leading-[22px] text-text-primary">
          {localize('com_ui_bookmarks_empty_title')}
        </p>
        <p className="mt-2 max-w-[420px] text-[13px] leading-[21px] text-text-secondary">
          {localize('com_ui_bookmarks_empty_body')}
        </p>
        {/* §4 `.ghost.outlined` — the secondary action in an empty state.
            Starting a chat is a way out of this screen, not the thing this
            screen is for, so it does not take the filled primary. */}
        <button
          type="button"
          onClick={() => navigate('/c/new')}
          className="mt-5 inline-flex h-10 items-center rounded-[10px] px-[18px] text-[13.5px] font-medium text-text-primary ring-1 ring-inset ring-border-light transition-colors hover:bg-surface-hover"
        >
          {localize('com_ui_bookmarks_empty_cta')}
        </button>
      </div>
    );
  }

  if (folders.length === 0) {
    return null;
  }

  return (
    <div className={GRID}>
      {folders.map((folder) => (
        <FolderCard
          key={folder.folderId}
          name={folder.name}
          description={folder.description}
          savedCount={folder.savedCount ?? 0}
          lastSavedAt={folder.lastSavedAt}
          onOpen={() => onOpenFolder(folder.folderId)}
          menu={
            /* Every card carries the ⋯. Unsorted's items are disabled rather
               than absent — a control that vanishes on one card reads as a
               missing feature (§4). */
            <FolderMenu
              label={localize('com_ui_bookmarks_folder_menu')}
              disabled={folder.virtual === true}
              disabledReason={
                folder.virtual === true
                  ? localize('com_ui_bookmarks_unsorted_locked')
                  : undefined
              }
              onRename={() => onRename(folder)}
              onEditDescription={() => onEditDescription(folder)}
              onDelete={() => onDelete(folder)}
            />
          }
          emptyDescription={localize('com_ui_bookmarks_default_description')}
          countLabel={localize('com_ui_bookmarks_saved_count', {
            count: folder.savedCount ?? 0,
          })}
          updatedLabel={
            formatFolderAge(folder.lastSavedAt) !== ''
              ? localize('com_ui_bookmarks_folder_updated', {
                  0: formatFolderAge(folder.lastSavedAt),
                })
              : undefined
          }
        />
      ))}
    </div>
  );
}
