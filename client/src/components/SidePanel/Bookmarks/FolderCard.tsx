import { FolderIcon } from 'lucide-react';
import { cn } from '~/utils';

/**
 * A folder card from the Figma "Folders — Default" board [F1].
 *
 * 352 × 142, radius 13, padding 16 / 15 / 14. The description is the point of
 * the card — it is what tells you which folder a thing belongs in six weeks
 * later — so it holds a fixed two lines and truncates, and the card's height
 * never varies with copy length (DESIGN.md §3).
 */
export default function FolderCard({
  name,
  description,
  savedCount,
  lastSavedAt,
  onOpen,
  menu,
  emptyDescription,
  countLabel,
  updatedLabel,
}: {
  name: string;
  description?: string;
  savedCount: number;
  lastSavedAt?: string;
  onOpen: () => void;
  /** The ⋯ menu, passed in so the card stays presentational. */
  menu?: React.ReactNode;
  /** Shown in the description slot when a folder has none, so the card keeps
   *  its height and the gap reads as intentional rather than broken. */
  emptyDescription: string;
  countLabel: string;
  updatedLabel?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        /* §3: a card is sized by its content, not stretched to a number. This
           was a fixed 142 holding a 40px slot open for a description whether or
           not there was one, which is most of why the grid felt loose. Padding
           16 and one 12px gap on the container — the rhythm §3 gives every
           card — and short cards are now short. */
        'group flex max-w-[400px] cursor-pointer flex-col gap-3 nash-card rounded-[13px] p-4',
        'transition-colors hover:bg-surface-hover',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="flex h-[26px] items-center gap-2">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-surface-hover text-text-secondary group-hover:bg-surface-active">
          <FolderIcon className="h-[14px] w-[14px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-[21px] text-text-primary">
          {name}
        </span>
        {menu}
      </div>

      {/* One line, and none at all when there is none (§3: empty content
          collapses). One tone either way. The fallback is the same general line a new
          folder is created with, so rendering it dimmer made two cards with
          identical words look like different kinds of thing. */}
      <p className="line-clamp-1 text-[12.5px] leading-[20px] text-text-secondary">
        {description != null && description !== '' ? description : emptyDescription}
      </p>

      <div className="flex h-[17px] items-center gap-2 text-[12px] leading-[17px]">
        <span className="text-text-secondary">{countLabel}</span>
        {updatedLabel != null && updatedLabel !== '' && (
          <>
            <span className="text-text-tertiary" aria-hidden="true">
              ·
            </span>
            <span className="truncate text-text-tertiary">{updatedLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
