import { forwardRef } from 'react';
import { Search, X } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The search field, everywhere. §6 `.msearch`: 40 tall, radius 10, on
 * --surface, 13px, no border and no focus ring — a field that already sits on
 * its own fill does not also need an outline to say where it is.
 *
 * One definition because the two that existed had drifted in exactly the way
 * two hand-written copies do: Bookmarks put a 16px magnifier at left 12,
 * Personas a 20px one, so the same control read as heavier on one page than the
 * other. The glyph is 16 in --t3, which is §12's size for an icon at rest.
 *
 * `onClear` is optional — pass it and an × appears once there is something to
 * clear, matching the padding on the right so text never runs under it.
 */
const SearchField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (next: string) => void;
    placeholder: string;
    /** Defaults to the placeholder, which is normally the right label. */
    ariaLabel?: string;
    onClear?: () => void;
    id?: string;
    /**
     * What the field is sitting on. §1 rule 2 — two neighbours never share a
     * step — so the fill is picked relative to its container, not fixed:
     *
     * - `page` (default): the page is --app, so the field is --surface.
     * - `card`: a --surface card, so the field rises to --elevated.
     * - `overlay`: a dialog or menu, which is already --elevated, so the field
     *   rises again to --hover. Passing `card` here is the bug this replaced —
     *   an --elevated field on an --elevated panel simply is not there.
     */
    on?: 'page' | 'card' | 'overlay';
    className?: string;
    /** Spread onto the input for the callers that need aria-describedby etc. */
    inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  }
>(({ value, onChange, placeholder, ariaLabel, onClear, id, on = 'page', className, inputProps }, ref) => {
  const localize = useLocalize();
  const showClear = onClear != null && value !== '';

  return (
    <div className={cn('relative grow', className)} role="search">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
        aria-hidden="true"
      />
      <input
        ref={ref}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoComplete="off"
        spellCheck="false"
        className={cn(
          'h-10 w-full rounded-[10px] pl-10 text-[13px] text-text-primary',
          on === 'overlay'
            ? 'bg-surface-active'
            : on === 'card'
              ? 'bg-surface-hover'
              /* A page search sits on white, where --surface is a heavy slab.
                 `--surface-control` is a rung lighter in light and identical in
                 dark. The sidebar's search is a different component and keeps
                 --surface: there, too light means invisible. */
              : 'bg-surface-control',
          'placeholder:text-text-tertiary focus:outline-none',
          showClear ? 'pr-10' : 'pr-3',
        )}
        {...inputProps}
      />
      {showClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={localize('com_ui_clear_search')}
          title={localize('com_ui_clear_search')}
          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-[7px] text-text-tertiary transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});

SearchField.displayName = 'SearchField';

export default SearchField;
