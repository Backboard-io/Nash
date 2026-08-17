import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { popMenu } from '~/utils/motion';
import { cn } from '~/utils';

/**
 * The ⋯ on a file row — the same control BookmarkRowMenu and AgentCardMenu are.
 *
 * It replaces three always-rendered icon buttons (preview, download, delete).
 * A row of icons costs a fixed slice of every row's width, needs a tooltip each
 * to be readable, and put an irreversible action one stray click from a
 * download. Preview is gone from it entirely: clicking the filename is the
 * preview, so the icon was a second way to do the row's default action.
 *
 * **Portalled and `position: fixed`**, per §7's flyout rule. The table cell
 * this sits in carries `overflow-hidden` and the table scrolls horizontally
 * inside `overflow-x-auto`, so an absolutely-positioned menu was clipped away
 * to nothing — the button appeared to do nothing at all when pressed. Measure
 * the trigger, draw over everything.
 */
export default function FileRowMenu({
  onRename,
  onDownload,
  onDelete,
  disabled = false,
}: {
  onRename: () => void;
  onDownload?: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_WIDTH = 186;

  /** Right-align the menu under the trigger, flipping up near the viewport floor. */
  const place = useCallback(() => {
    const trigger = wrapRef.current;
    if (trigger == null) {
      return;
    }
    const r = trigger.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 150;
    const below = r.bottom + 6;
    const flip = below + height > window.innerHeight - 8;
    setPos({
      top: flip ? Math.max(8, r.top - 6 - height) : below,
      left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) {
      place();
    }
  }, [open, place]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapRef.current?.contains(target) !== true &&
        menuRef.current?.contains(target) !== true
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    /* A fixed menu does not travel with its row, so any scroll closes it —
       §7 lists scroll as a dismissal for menus for exactly this reason. */
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const item = (
    key: string,
    Icon: typeof Pencil,
    label: string,
    action?: () => void,
    destructive = false,
  ) =>
    action == null ? null : (
      <button
        key={key}
        type="button"
        role="menuitem"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          action();
        }}
        className={cn(
          'flex w-full items-center gap-[10px] rounded-[8px] px-[10px] py-[9px] text-left text-[13px] leading-[19px] transition-colors',
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
    <div ref={wrapRef} className="relative flex justify-end">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={localize('com_ui_more_options')}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          'grid size-7 place-items-center rounded-[7px] transition-colors disabled:opacity-[.42]',
          open
            ? 'bg-surface-active text-text-primary'
            : 'text-text-tertiary hover:bg-surface-active hover:text-text-primary',
        )}
      >
        <MoreVertical className="h-[15px] w-[15px]" aria-hidden="true" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              {...popMenu}
              ref={menuRef}
              role="menu"
              style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
              onClick={(e) => e.stopPropagation()}
              className="fixed z-[200] rounded-[12px] bg-surface-hover p-[6px] shadow-[0_10px_28px_rgba(16,18,24,0.14)] ring-1 ring-inset ring-border-light dark:shadow-[0_12px_34px_rgba(0,0,0,0.4)] dark:ring-0"
            >
              {item('rename', Pencil, localize('com_ui_rename'), onRename)}
              {item('download', Download, localize('com_ui_download'), onDownload)}
              <div className="my-[5px] h-px bg-border-light" role="separator" />
              {item('delete', Trash2, localize('com_ui_delete'), onDelete, true)}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
