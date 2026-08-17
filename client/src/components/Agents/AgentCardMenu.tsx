import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { popMenu } from '~/utils/motion';
import { cn } from '~/utils';

/**
 * The ⋯ on a persona the user owns — the same control BookmarkRowMenu is, at
 * the same corner, so the two cards behave alike.
 *
 * It replaces a bare trash icon. A lone destructive glyph in a card corner is
 * the one action you least want to be the easiest to hit, and it left Edit
 * competing with Use down in the action row, where §4 wants a single primary.
 */
export default function AgentCardMenu({
  onEdit,
  editDisabledHint,
  onDuplicate,
  onDelete,
}: {
  onEdit?: () => void;
  /**
   * Present when Edit exists but is not available to this user. §4: disabled
   * means unreachable, not hidden — a menu that silently drops Edit reads as a
   * menu that never had one, and leaves you wondering where editing lives.
   * The hint is the tooltip, and it says what to do instead.
   */
  editDisabledHint?: string;
  onDuplicate?: () => void;
  onDelete?: () => void;
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

  const item = (
    key: string,
    Icon: typeof Copy,
    label: string,
    action?: () => void,
    destructive = false,
    disabledHint?: string,
  ) => {
    const disabled = disabledHint != null;
    if (action == null && !disabled) {
      return null;
    }
    const button = (
      <button
        key={key}
        type="button"
        role="menuitem"
        /* aria-disabled, not `disabled`: a natively disabled button swallows
           its own mouse events, so the tooltip explaining why it is disabled
           would never appear. */
        aria-disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) {
            return;
          }
          setOpen(false);
          action?.();
        }}
        className={cn(
          'flex w-full items-center gap-[10px] rounded-[8px] px-[10px] py-[9px] text-left text-[13px] leading-[19px] transition-colors',
          disabled
            ? 'cursor-default text-text-secondary opacity-[.42]'
            : destructive
              ? 'text-text-destructive hover:bg-surface-active'
              : 'text-text-secondary hover:bg-surface-active hover:text-text-primary',
        )}
      >
        <Icon className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
        {label}
      </button>
    );
    return disabled ? (
      <TooltipAnchor key={key} description={disabledHint} side="right" className="block w-full">
        {button}
      </TooltipAnchor>
    ) : (
      button
    );
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={localize('com_ui_more_options')}
        onClick={(e) => {
          e.preventDefault();
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

      <AnimatePresence>
        {open && (
          <motion.div
            {...popMenu}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-[34px] z-[30] w-[186px] rounded-[12px] bg-surface-hover p-[6px] shadow-[0_10px_28px_rgba(16,18,24,0.14)] ring-1 ring-inset ring-border-light dark:shadow-[0_12px_34px_rgba(0,0,0,0.4)] dark:ring-0"
          >
            {item('edit', Pencil, localize('com_ui_edit'), onEdit, false, editDisabledHint)}
            {item('duplicate', Copy, localize('com_ui_duplicate'), onDuplicate)}
            {onDelete && <div className="my-[5px] h-px bg-border-light" role="separator" />}
            {item('delete', Trash2, localize('com_ui_delete'), onDelete, true)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
