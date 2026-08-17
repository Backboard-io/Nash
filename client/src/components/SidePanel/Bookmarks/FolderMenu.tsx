import * as Ariakit from '@ariakit/react';
import { Pencil, FileText, Trash2, MoreVertical } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The folder card's ⋯ menu [F7].
 *
 * 186 wide, 37px rows. Delete is separated by a rule and coloured error —
 * it is destructive and must not sit flush with the two edits above it.
 */
const ROW =
  'flex h-[37px] w-full cursor-pointer items-center gap-[11px] rounded-[9px] px-[10px] text-[13px] leading-[19px] outline-none transition-colors';

export default function FolderMenu({
  label,
  disabled = false,
  disabledReason,
  onRename,
  onEditDescription,
  onDelete,
}: {
  label: string;
  /** Unsorted is a virtual bucket the server refuses to rename or delete. Its
   *  ⋯ still appears with the items disabled — §4: "Disabled means
   *  unreachable, not hidden. Never remove the control." */
  disabled?: boolean;
  disabledReason?: string;
  onRename: () => void;
  onEditDescription: () => void;
  onDelete: () => void;
}) {
  const localize = useLocalize();
  const rowState = disabled
    ? 'cursor-default opacity-[0.42]'
    : 'hover:bg-surface-active hover:text-text-primary';

  return (
    <Ariakit.MenuProvider placement="bottom-end">
      {/* The trigger lives inside the menu so it anchors itself; the card only
          has to stop the click from opening the folder underneath. */}
      <Ariakit.MenuButton
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] text-text-tertiary outline-none transition-colors hover:bg-surface-active hover:text-text-primary"
      >
        <MoreVertical className="h-[15px] w-[15px]" aria-hidden="true" />
      </Ariakit.MenuButton>
      <Ariakit.Menu
        portal
        modal={false}
        gutter={6}
        unmountOnHide
        className={cn(
          'z-[125] flex w-[186px] flex-col rounded-[14px] !border-0 p-1.5',
          'nash-menu',
          'animate-popover',
        )}
      >
        {disabled && disabledReason != null && (
          <p className="px-[10px] pb-[6px] pt-[4px] text-[11.5px] leading-[17px] text-text-tertiary">
            {disabledReason}
          </p>
        )}
        <Ariakit.MenuItem
          disabled={disabled}
          className={cn(ROW, 'text-text-secondary', rowState)}
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          <Pencil className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
          {localize('com_ui_rename')}
        </Ariakit.MenuItem>
        <Ariakit.MenuItem
          disabled={disabled}
          className={cn(ROW, 'text-text-secondary', rowState)}
          onClick={(e) => {
            e.stopPropagation();
            onEditDescription();
          }}
        >
          <FileText className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
          {localize('com_ui_bookmarks_edit_description')}
        </Ariakit.MenuItem>

        <div className="my-1.5 h-px bg-border-light" role="separator" />

        <Ariakit.MenuItem
          disabled={disabled}
          className={cn(
            ROW,
            'text-text-destructive',
            disabled
              ? 'cursor-default opacity-[0.42]'
              : 'hover:bg-surface-destructive-subtle',
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
          {localize('com_ui_bookmarks_delete_folder')}
        </Ariakit.MenuItem>
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
  );
}
