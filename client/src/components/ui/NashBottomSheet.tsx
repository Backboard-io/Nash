import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
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
 * Mobile bottom sheet from the Figma redesign (HiFi Chat Mobile canvas):
 * dim backdrop, panel anchored to the bottom edge — bg #0D0F12 (dark) /
 * #F6F6F7 (light), 1px #2E3036/#E7E8EA border, 20px top radius, 8px top
 * padding, optional 18px/600 title row with a 17px X close.
 */
export default function NashBottomSheet({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  className,
}: NashBottomSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
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

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-[120]"
      style={{ bottom: 'var(--nash-composer-h, 0px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          'absolute inset-0 h-full w-full cursor-default bg-black/60 transition-opacity duration-200',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-[20px]',
          'border border-b-0 border-[#E7E8EA] bg-[#F6F6F7] pt-2',
          'dark:border-[#2E3036] dark:bg-[#0D0F12]',
          'transition-transform duration-200 ease-out',
          shown ? 'translate-y-0' : 'translate-y-full',
          className,
        )}
      >
        {title != null && (
          <div className="flex h-11 items-center justify-between pl-4 pr-6">
            <span className="text-[18px] font-semibold leading-[27px] text-text-primary">
              {title}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-[25px] items-center justify-center rounded-[7px] text-text-secondary-alt transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
