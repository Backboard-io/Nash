import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, MoreVertical } from 'lucide-react';
import { EditIcon, TrashIcon2 } from '~/components/svg/NashMemoriesIcons';
import { Trans } from 'react-i18next';
import { Label, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TUserMemory } from 'librechat-data-provider';
import { useDeleteMemoryMutation, useDeleteFolderMemoryMutation } from '~/data-provider';
import type { ScopedMemory } from './types';
import { useLocalize } from '~/hooks';
import { popMenu } from '~/utils/motion';
import { cn } from '~/utils';

interface MemoryCardActionsProps {
  memory: ScopedMemory;
  onEdit: () => void;
  onDeleteError?: (retry: () => void) => void;
}

export default function MemoryCardActions({ memory, onEdit, onDeleteError }: MemoryCardActionsProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_WIDTH = 186;

  /**
   * Portalled and `position: fixed`, per §7's flyout rule — and here for a
   * second reason: with memory switched off the list is rendered at
   * `opacity .6`, and opacity applies to a whole subtree, so a menu drawn
   * inside it came out faded too. An overlay never inherits the state of the
   * content it was opened from.
   */
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
    if (menuOpen) {
      place();
    }
  }, [menuOpen, place]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapRef.current?.contains(target) !== true &&
        menuRef.current?.contains(target) !== true
      ) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const onScroll = () => setMenuOpen(false);
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
  }, [menuOpen]);

  const { mutate: deleteMemory, isLoading: isDeleting } = useDeleteMemoryMutation();
  /* A workspace memory lives on its folder's assistant, so deleting it through
     the user's own endpoint would report success and remove nothing. */
  const { mutate: deleteFolderMemory, isLoading: isDeletingFolderMemory } =
    useDeleteFolderMemoryMutation(memory.folderId ?? '');
  const removeMemory = memory.folderId ? deleteFolderMemory : deleteMemory;
  const isRemoving = isDeleting || isDeletingFolderMemory;

  /* The Nash memory glyphs are plain function components, not lucide's
     forwardRef icons, so the parameter is typed by the shape both satisfy. */
  const item = (
    key: string,
    Icon: React.ComponentType<any>,
    label: string,
    action: () => void,
    destructive = false,
  ) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
        action();
      }}
      className={cn(
        'flex w-full items-center gap-[10px] rounded-[8px] px-[10px] py-[9px] text-left text-[13px] leading-[19px] transition-colors',
        destructive
          ? 'text-text-destructive hover:bg-surface-active'
          : 'text-text-secondary hover:bg-surface-active hover:text-text-primary',
      )}
    >
      <Icon size={15} aria-hidden="true" />
      {label}
    </button>
  );

  const confirmDelete = () => {
    const run = () =>
      removeMemory(memory.key, {
        onSuccess: () => {
          showToast({ message: localize('com_ui_deleted'), status: 'success' });
        },
        onError: () => {
          if (onDeleteError) {
            onDeleteError(() => run());
          } else {
            showToast({ message: localize('com_ui_error'), status: 'error' });
          }
        },
      });
    setDeleteOpen(false);
    run();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(memory.value);
      showToast({ message: localize('com_ui_copied'), status: 'success' });
    } catch {
      showToast({ message: localize('com_ui_error'), status: 'error' });
    }
  };

  return (
    <>
      {/* One ⋯, not three icons. Edit, delete and an overflow-with-one-item-in-it
          sat side by side, so the row carried three targets, three tooltips and
          a menu that existed to hold a single action. Same control, same corner
          and same order as the bookmark, persona and file menus. */}
      <div ref={wrapRef} className="relative shrink-0">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={localize('com_ui_more_options')}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className={cn(
            'grid size-7 place-items-center rounded-[7px] transition-colors',
            menuOpen
              ? 'bg-surface-active text-text-primary'
              : 'text-text-tertiary hover:bg-surface-active hover:text-text-primary',
          )}
        >
          {isRemoving ? (
            <Spinner className="size-4" />
          ) : (
            <MoreVertical className="h-[15px] w-[15px]" aria-hidden="true" />
          )}
        </button>

        {createPortal(
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                {...popMenu}
                ref={menuRef}
                role="menu"
                style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
                onClick={(e) => e.stopPropagation()}
                className="fixed z-[200] rounded-[12px] bg-surface-hover p-[6px] shadow-[0_10px_28px_rgba(16,18,24,0.14)] ring-1 ring-inset ring-border-light dark:shadow-[0_12px_34px_rgba(0,0,0,0.4)] dark:ring-0"
              >
              {item('edit', EditIcon, localize('com_ui_edit'), onEdit)}
              {item('copy', Copy, localize('com_ui_copy'), () => void handleCopy())}
              <div className="my-[5px] h-px bg-border-light" role="separator" />
              {item('delete', TrashIcon2, localize('com_ui_delete'), () => setDeleteOpen(true), true)}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </div>

      <OGDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <OGDialogTemplate
          title={localize('com_ui_delete_memory')}
          className="w-11/12 max-w-lg"
          main={
            <Label className="text-left text-[13.5px] font-normal leading-[20px] text-text-secondary">
              <Trans
                i18nKey="com_ui_delete_confirm_strong"
                values={{
                  title:
                    memory.value.length > 80 ? memory.value.slice(0, 80) + '…' : memory.value,
                }}
                components={{ strong: <strong /> }}
              />
            </Label>
          }
          selection={{
            selectHandler: confirmDelete,
            selectClasses: 'bg-surface-destructive hover:bg-surface-destructive-hover text-white',
            selectText: localize('com_ui_delete'),
          }}
        />
      </OGDialog>
    </>
  );
}
