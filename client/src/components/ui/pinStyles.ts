import { cn } from '~/utils';

/**
 * The pin control, wherever it appears — a chat row in the sidebar, a model in
 * the picker. One definition so the two cannot drift: they were written twice
 * and had already diverged into a 26px box against a bare glyph, and a filled
 * pin against a second `PinOff` icon.
 *
 * §4 `.pin`: a 26px target, no fill until hovered.
 * §12: state is carried by fill, not by a second glyph — a pin is filled when
 * pinned and outline when not, and hovering a filled one hollows it to preview
 * the unpin. A slashed variant was tried and rejected.
 * §10.2: unpinned, it holds its slot at `opacity 0` so the title beside it
 * truncates at the same point whether or not the row is hovered.
 */
export const pinButtonClass = (isPinned: boolean, alwaysVisible = false) =>
  cn(
    'nash-pin flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[7px] transition-colors',
    'hover:bg-surface-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isPinned
      ? 'text-text-secondary opacity-100 [&>svg]:fill-current hover:[&>svg]:fill-transparent'
      : cn(
          'text-text-tertiary [&>svg]:fill-transparent',
          alwaysVisible
            ? 'opacity-100'
            : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
        ),
  );

/**
 * The glyph size that goes with it.
 *
 * 12 — a step under §12's 13–15 band for a row glyph, by eye rather than by
 * rule: the pin sits beside 12.5px text and at 13 it still read as the loudest
 * thing on a row it is only annotating. The 26px target stays, so the smaller
 * glyph costs nothing to hit; §4 asks for a hit box at least 8px larger than
 * the glyph, which 26 against 12 clears twice over.
 */
export const PIN_GLYPH_SIZE = 12;
