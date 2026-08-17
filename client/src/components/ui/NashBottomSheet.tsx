import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { ease } from '~/utils/motion';
import { cn } from '~/utils';

interface NashBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel: string;
  children: React.ReactNode;
  /** Extra classes for the sheet panel (e.g. height/padding overrides). */
  className?: string;
}

/**
 * The sheet currently on screen, if any.
 *
 * §7 rule 3: one overlay at a time per surface — opening the model picker
 * closes Add to Chat, and the other way round. The two sheets are owned by
 * different components with no state between them, so the rule lives here,
 * where every composer sheet already passes through. A module-level slot
 * rather than a context because there is only ever one composer.
 */
let openSheetClose: (() => void) | null = null;

export default function NashBottomSheet({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  className,
}: NashBottomSheetProps) {
  /* onClose is usually a fresh closure each render; the registry needs a
     stable handle so it can still close this sheet later. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => closeRef.current();
    const previous = openSheetClose;
    if (previous != null && previous !== close) {
      previous();
    }
    openSheetClose = close;
    return () => {
      if (openSheetClose === close) {
        openSheetClose = null;
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const panel = { duration: 0.28, ease };
  const fade = { duration: 0.24, ease };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          /* `pointer-events-none` on the container. It is `inset-0`, and an
             invisible div still swallows clicks — so this was sitting on top
             of the composer and eating every tap, including the one on the −
             that closes the sheet. Each child turns pointer events back on for
             itself. Not `aria-modal` either: the composer below stays live and
             typable, so claiming the rest of the page is inert would be a lie
             to a screen reader. */
          className="pointer-events-none fixed inset-0 z-[120]"
          role="dialog"
          aria-label={ariaLabel}
        >
          <motion.button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
            style={{ bottom: 'var(--nash-composer-top, var(--nash-composer-h, 0px))' }}
            className="pointer-events-auto absolute inset-x-0 top-0 w-full cursor-default"
          />

          <div
            style={{
              bottom: 'calc(var(--nash-composer-top, var(--nash-composer-h, 0px)) + 20px)',
            }}
            className="pointer-events-none absolute inset-x-0 flex justify-center px-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={panel}
              style={{
                width: 'var(--nash-composer-w, 100%)',
                maxWidth: '100%',
                maxHeight:
                  'calc(100dvh - var(--nash-composer-top, var(--nash-composer-h, 0px)) - 40px)',
              }}
              className={cn(
                'pointer-events-auto flex flex-col overflow-hidden rounded-[20px] pt-5',
                'bg-surface-dialog',
                'ring-1 ring-inset ring-border-light dark:ring-0',
                'shadow-[0_16px_40px_rgba(16,18,24,0.18)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.55)]',
                className,
              )}
            >
              {title != null && (
                <div className="flex items-center justify-between px-4 pb-3 pt-2 sm:px-5">
                  <span className="text-[17px] font-semibold leading-[25px] tracking-[-0.2px] text-text-primary">
                    {title}
                  </span>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="grid size-8 place-items-center rounded-[8px] text-text-secondary-alt transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
