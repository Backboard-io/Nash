import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MoreVertical, ExternalLink, Pencil, FolderInput, Copy, Trash2 } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { popMenu } from '~/utils/motion';
import { cn } from '~/utils';

/**
 * The ⋯ on a saved response.
 *
 * §12: a row takes the horizontal mark and a card the vertical one — but this
 * sits at the top-right corner of a tall block with height around it, which is
 * the card case, so it is `dots` vertical.
 *
 * Remove is last and separated, and it is the only red thing here (§1: red is
 * for the action, not the container, and only on hover at rest).
 */
export default function BookmarkRowMenu({
  onOpenInChat,
  onEditNote,
  onMoveToFolder,
  onCopy,
  onRemove,
}: {
  onOpenInChat: () => void;
  onEditNote: () => void;
  onMoveToFolder: () => void;
  onCopy: () => void;
  onRemove: () => void;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current != null && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const row =
    'flex w-full items-center gap-[10px] rounded-[8px] px-[10px] py-[9px] text-left text-[13px] leading-[19px] transition-colors';

  const item = (
    key: string,
    Icon: typeof Copy,
    label: string,
    action: () => void,
    destructive = false,
  ) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        action();
      }}
      className={cn(
        row,
        destructive
          ? 'text-text-destructive hover:bg-surface-active'
          : 'text-text-secondary hover:bg-surface-active hover:text-text-primary',
      )}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={localize('com_ui_more_options')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          'grid size-7 place-items-center rounded-[7px] transition-colors',
          open
            ? 'bg-surface-active text-text-primary'
            : 'text-text-tertiary hover:bg-surface-active hover:text-text-primary',
        )}
      >
        <MoreVertical className="h-[15px] w-[15px]" aria-hidden="true" />
      </button>

      {/* §10 Popups: `popMenu` — falls 6px from the control that opened it, and
          closes the same way inside AnimatePresence. */}
      <AnimatePresence>
        {open && (
          <motion.div
            {...popMenu}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="nash-menu absolute right-0 top-[34px] z-[30] w-[206px] rounded-[12px] p-[6px]"
          >
            {item('open', ExternalLink, localize('com_ui_bookmarks_open_in_chat'), onOpenInChat)}
            {item('note', Pencil, localize('com_ui_bookmarks_edit_note'), onEditNote)}
            {item('move', FolderInput, localize('com_ui_bookmarks_move_to_folder'), onMoveToFolder)}
            <div className="my-[5px] h-px bg-border-light" role="separator" />
            {item('copy', Copy, localize('com_ui_bookmarks_copy_response'), onCopy)}
            {item(
              'remove',
              Trash2,
              localize('com_ui_bookmarks_remove_bookmark'),
              onRemove,
              true,
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
