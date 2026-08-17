import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import type { TSavedMessage } from 'librechat-data-provider';
import FilterPill from '~/components/ui/FilterPill';
import { savedKinds, type SavedKind } from './savedContent';
import { useLocalize } from '~/hooks';
import { popMenu } from '~/utils/motion';
import { cn } from '~/utils';

export type BookmarkView = 'list' | 'grid';
export type BookmarkSort = 'recent' | 'oldest' | 'chat';

/**
 * The list/grid switch and the sort, shared by the Bookmarks page and the
 * inside of a folder. One definition of each, so the two screens cannot end up
 * offering different orderings of the same things.
 */

/** Class for the row container, so a list and a grid are one prop apart. */
export function bookmarkListClass(view: BookmarkView) {
  return view === 'grid'
    ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'
    : 'flex flex-col gap-2';
}

export function sortSavedMessages(rows: TSavedMessage[], sort: BookmarkSort) {
  const time = (r: TSavedMessage) => new Date(r.createdAt ?? 0).getTime();
  const copy = [...rows];
  if (sort === 'oldest') {
    return copy.sort((a, b) => time(a) - time(b));
  }
  if (sort === 'chat') {
    return copy.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  }
  return copy.sort((a, b) => time(b) - time(a));
}

export function ViewToggle({
  view,
  onChange,
}: {
  view: BookmarkView;
  onChange: (next: BookmarkView) => void;
}) {
  const localize = useLocalize();
  const button = (value: BookmarkView, Icon: typeof List, label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-label={label}
      aria-pressed={view === value}
      className={cn(
        'grid size-8 place-items-center rounded-[8px] transition-colors',
        view === value
          ? 'bg-surface-hover text-text-primary'
          : 'text-text-tertiary hover:text-text-primary',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  return (
    /* A segmented pair on one fill, so it reads as one control with two
       states rather than two buttons that happen to be adjacent. */
    <div className="flex shrink-0 items-center gap-1 rounded-[10px] bg-surface-secondary p-1">
      {button('list', List, localize('com_ui_bookmarks_view_list'))}
      {button('grid', LayoutGrid, localize('com_ui_bookmarks_view_grid'))}
    </div>
  );
}

/**
 * The standard sort control (§5): the current value on the face, never the word
 * "Sort" — a control labelled "Sort" makes you open it to find out what the
 * list is doing.
 *
 * Generic over its option set so every page uses this one rather than reaching
 * for a plain dropdown.
 */
export function SortMenu<T extends string>({
  sort,
  onChange,
  options: providedOptions,
}: {
  sort: T;
  onChange: (next: T) => void;
  options?: Array<{ key: T; label: string }>;
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

  const options: Array<{ key: T; label: string }> =
    providedOptions ??
    ([
      { key: 'recent', label: localize('com_ui_bookmarks_sort_recent') },
      { key: 'oldest', label: localize('com_ui_bookmarks_sort_oldest') },
      { key: 'chat', label: localize('com_ui_bookmarks_sort_chat') },
    ] as Array<{ key: T; label: string }>);
  const current = options.find((o) => o.key === sort) ?? options[0];

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 rounded-[10px] bg-surface-secondary px-[14px] text-[13px] leading-[19px] text-text-primary transition-colors hover:bg-surface-hover"
      >
        <SlidersHorizontal className="h-[15px] w-[15px] text-text-tertiary" aria-hidden="true" />
        {current.label}
        <ChevronDown className="h-[15px] w-[15px] text-text-tertiary" aria-hidden="true" />
      </button>

      {/* §10 Popups: `popMenu`, inside AnimatePresence so the close animates. */}
      <AnimatePresence>
        {open && (
          <motion.div
            {...popMenu}
            role="menu"
            className="nash-menu absolute right-0 top-[46px] z-[30] w-[186px] rounded-[12px] p-[6px]"
          >
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  onChange(option.key);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-[9px] rounded-[8px] px-[10px] py-[9px] text-left text-[13px] leading-[19px] transition-colors hover:bg-surface-active hover:text-text-primary',
                  sort === option.key ? 'text-text-primary' : 'text-text-secondary',
                )}
              >
                {option.label}
                {sort === option.key && (
                  <Check className="ml-auto h-4 w-4 text-text-primary" aria-hidden="true" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type KindFilter = 'all' | SavedKind;

/** Which kinds are actually present, so the strip can be built from the data. */
export function availableKinds(rows: TSavedMessage[]): SavedKind[] {
  const order: SavedKind[] = ['response', 'code', 'image', 'file', 'table'];
  const found = new Set<SavedKind>();
  for (const row of rows) {
    for (const kind of savedKinds(row.text)) {
      found.add(kind);
    }
  }
  return order.filter((kind) => found.has(kind));
}

export function filterByKind(rows: TSavedMessage[], kind: KindFilter) {
  if (kind === 'all') {
    return rows;
  }
  return rows.filter((row) => savedKinds(row.text).has(kind));
}

/**
 * The kind filter — §5 pills.
 *
 * Renders nothing at all when there is nothing to filter, and only the pills
 * whose kind is present. A strip of eight pills over four saved responses is
 * seven invitations to empty a list.
 */
export function KindFilterPills({
  rows,
  active,
  onChange,
}: {
  rows: TSavedMessage[];
  active: KindFilter;
  onChange: (next: KindFilter) => void;
}) {
  const localize = useLocalize();
  const kinds = availableKinds(rows);

  /* Nothing saved: the strip stays, inactive. §4 — disabled means unreachable,
     not hidden. A control that vanishes when a page is empty makes the empty
     page look like a different screen, and you cannot learn that filtering
     exists from a screen that never shows it. */
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[12.5px] leading-[19px] text-text-secondary-alt">
          {localize('com_ui_filter')}
        </span>
        <FilterPill selected disabled>
          {localize('com_ui_all_proper')}
        </FilterPill>
      </div>
    );
  }

  const label: Record<SavedKind, string> = {
    response: localize('com_ui_bookmarks_kind_responses'),
    code: localize('com_ui_bookmarks_kind_code'),
    image: localize('com_ui_bookmarks_kind_images'),
    file: localize('com_ui_bookmarks_kind_files'),
    table: localize('com_ui_bookmarks_kind_tables'),
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* The strip says what it is. Without the label a row of pills reads as
          tabs — something you are inside of — rather than a narrowing of the
          list below it. Same treatment as the model picker's filter bar. */}
      <span className="shrink-0 text-[12.5px] leading-[19px] text-text-secondary-alt">
        {localize('com_ui_filter')}
      </span>
      <FilterPill selected={active === 'all'} onClick={() => onChange('all')}>
        {localize('com_ui_all_proper')}
      </FilterPill>
      {kinds.map((kind) => (
        <FilterPill
          key={kind}
          selected={active === kind}
          count={filterByKind(rows, kind).length}
          onClick={() => onChange(kind)}
        >
          {label[kind]}
        </FilterPill>
      ))}
    </div>
  );
}
