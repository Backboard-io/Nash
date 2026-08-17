import { cn } from '~/utils';

/**
 * One tab in a filter strip — §5 `.fpill`.
 *
 * A strip is tabs, not pills: only the selected one wears a chip, the rest are
 * plain labels. Selection is a lift in the surface ladder rather than a hue —
 * filling five of these with a surface and one with purple made the strip the
 * loudest thing on a page and put it in competition with the primary button.
 * Raising one step and brightening its text says *this one* quietly enough.
 *
 * Radius 9, a rounded rect: fully-round belongs to `.pill`, which is a control.
 * This is a choice among peers.
 */
export default function FilterPill({
  selected,
  count,
  onCard = false,
  children,
  className,
  ...props
}: {
  selected: boolean;
  count?: number;
  /** On a card the chip lifts one step further, so it still separates from the
   *  surface it sits on. */
  onCard?: boolean;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-[9px] border-0 px-[15px] py-[7px]',
        'text-[12.5px] font-medium leading-[18.75px] transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        /* §4: disabled means unreachable, not hidden. */
        'disabled:cursor-default disabled:opacity-[.42]',
        /* §5. The chip is counted in rungs up from whatever is directly
           behind the strip, not from the page — an --elevated chip inside the
           --elevated model panel disappears while looking correct in a mock.
           So `onCard` shifts the whole set two rungs up.

           Rest is a bare label; hovering an unselected one previews the chip it
           would get, one rung below the real thing, because text-only labels
           give no other clue that they are clickable. Hovering the selected one
           brightens a rung without previewing a second selection. */
        selected
          ? cn(
              onCard ? 'bg-border-light hover:bg-border-heavy' : 'bg-surface-hover hover:bg-surface-active',
              'text-text-primary',
            )
          : cn(
              'bg-transparent text-text-secondary-alt',
              onCard
                ? 'hover:bg-surface-active hover:text-text-primary'
                : 'hover:bg-surface-secondary hover:text-text-primary',
            ),
        className,
      )}
      {...props}
    >
      {children}
      {count != null && (
        <span
          className={cn(
            'ml-[7px] text-[11px] leading-[16.5px]',
            /* The count is on every tab, selected or not — one that disappears
               when you pick it reads as a bug. */
            selected ? 'text-text-secondary-alt' : 'text-text-tertiary',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
