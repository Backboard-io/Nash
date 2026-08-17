import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Check, Search, X, Pin } from 'lucide-react';
import type { Endpoint } from '~/common';
import { useModelSelectorContext } from './ModelSelectorContext';
import { tierOptions } from './utils';
import { useLocalize, useShowMarketplace, useFavorites } from '~/hooks';
import { cn } from '~/utils';
import { popDialog, popMenu, popScrim } from '~/utils/motion';
import { AnimatePresence, motion } from 'framer-motion';
import { pinButtonClass, PIN_GLYPH_SIZE } from '~/components/ui/pinStyles';
import { formatModelName } from '~/utils/modelDisplay';
import { modelNames, sectionLabel } from './modelPickerStyles';


/**
 * Desktop "Select Model" modal (Figma "Model Selection — 04.08"): a centered
 * panel above the composer with search, tier filter chips, a
 * pinned section, the Personas entry, and provider rows carrying model counts
 * and a sample of their models. All selection/search/tier logic is reused from
 * ModelSelectorContext — this component only owns presentation.
 */
export default function DesktopModelModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const showMarketplace = useShowMarketplace();
  const { favorites, isFavoriteModel, toggleFavoriteModel } = useFavorites();

  const {
    mappedEndpoints,
    filteredMappedEndpoints,
    agentsMap,
    searchValue,
    setSearchValue,
    activeTier,
    setActiveTier,
    handleSelectModel,
    handleSelectEndpoint,
    selectedValues,
  } = useModelSelectorContext();

  const [drill, setDrill] = useState<Endpoint | null>(null);
  /**
   * What the user has typed, updated on every keystroke.
   *
   * The context's setSearchValue is debounced by 200ms. Binding the input's
   * `value` straight to the debounced state made it uncontrollable: each
   * keystroke re-rendered with the stale value and reverted the character, so
   * typing "claude" left a single letter behind. The input is driven from this
   * immediate state; the debounced setter still feeds the filtering below.
   */
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSearchValue(query);
  }, [query, setSearchValue]);

  useEffect(() => {
    if (!open) {
      setDrill(null);
      setQuery('');
      setSearchValue('');
    }
  }, [open, setSearchValue]);

  /**
   * Keep focus inside the panel while it is open.
   *
   * react-hook-form re-focuses the composer's textarea when the form re-renders,
   * which happens right after this panel mounts. autoFocus alone lost the race —
   * the caret ended up in the chat box and keystrokes never reached the search
   * field. This is what role="dialog" implies anyway: focus belongs to the
   * dialog until it closes.
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    const raf = window.requestAnimationFrame(() => searchRef.current?.focus());
    const onFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      const target = event.target as Node | null;
      if (panel && target && !panel.contains(target)) {
        searchRef.current?.focus();
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  // Crossing into or out of a provider starts clean: carrying the old query
  // over would silently filter the new list, often down to nothing.
  useEffect(() => {
    setQuery('');
    setSearchValue('');
  }, [drill, setSearchValue]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        drill ? setDrill(null) : onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, drill]);

  const totals = useMemo(() => {
    const models = mappedEndpoints.reduce((n, e) => n + (e.models?.length ?? 0), 0);
    return { models, providers: mappedEndpoints.length };
  }, [mappedEndpoints]);

  /** Flat model results for a search query: every model whose raw id or
   * short display name matches, grouped by provider, capped for the 22k
   * model library. Search selects MODELS, not providers. */
  const modelResults = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) {
      return null;
    }
    const out: Array<{ endpoint: Endpoint; name: string }> = [];
    for (const endpoint of filteredMappedEndpoints ?? []) {
      for (const m of endpoint.models ?? []) {
        const raw = String((m as any)?.name ?? m);
        if (
          raw.toLowerCase().includes(q) ||
          formatModelName(raw).toLowerCase().includes(q)
        ) {
          out.push({ endpoint, name: raw });
          if (out.length >= 60) {
            return out;
          }
        }
      }
    }
    return out;
  }, [filteredMappedEndpoints, searchValue]);

  const providers = useMemo(() => {
    const list = [...(filteredMappedEndpoints ?? [])];
    const personasLabel = localize('com_ui_personas').toLowerCase();
    const deduped = showMarketplace
      ? list.filter((e) => (e.label ?? e.value ?? '').toLowerCase() !== personasLabel)
      : list;
    const q = searchValue.trim().toLowerCase();
    if (!q) {
      return deduped;
    }
    return deduped.filter((e) => {
      const label = (e.label ?? e.value ?? '').toLowerCase();
      return (
        label.includes(q) ||
        (e.models ?? []).some((m: any) => {
          const raw = String(m?.name ?? m).toLowerCase();
          return raw.includes(q) || formatModelName(raw).toLowerCase().includes(q);
        })
      );
    });
  }, [filteredMappedEndpoints, searchValue, showMarketplace, localize]);

  /**
   * The drilled-in provider's models, filtered by the query. Without this the
   * search field sat above an unfiltered list and did nothing once you were
   * inside a provider.
   */
  const drillModels = useMemo(() => {
    let models = drill?.models ?? [];
    /* A tier chosen at the root still applies in here, off the models' own
       `tiers`. The pills are not drawn in this view, but dropping the filter
       on the way in would silently widen the list you had just narrowed. */
    if (activeTier != null) {
      models = models.filter((m: any) => m?.tiers?.includes(activeTier));
    }
    const q = searchValue.trim().toLowerCase();
    if (q) {
      models = models.filter((m: any) => String(m?.name ?? m).toLowerCase().includes(q));
    }
    return models;
  }, [drill, searchValue, activeTier]);

  /** Favourited models, resolved back to their endpoint so they can be selected. */
  const [pinnedFilter, setPinnedFilter] = useState(false);

  const pinned = useMemo(() => {
    const out: Array<{ endpoint: Endpoint; model: string }> = [];
    for (const fav of favorites ?? []) {
      if (!fav.model || !fav.endpoint) {
        continue;
      }
      const endpoint = mappedEndpoints.find((e) => e.value === fav.endpoint);
      if (endpoint) {
        out.push({ endpoint, model: fav.model });
      }
    }
    return out;
  }, [favorites, mappedEndpoints]);

  const personaCount = useMemo(() => Object.keys(agentsMap ?? {}).length, [agentsMap]);

  /* A provider's own pinned models sit above its full list, under their own
     heading — the same shape the root uses, so drilling in does not change how
     the list is organised. */
  const drillPinned = useMemo(
    () =>
      drillModels.filter((m: any) =>
        isFavoriteModel(String(m?.name ?? m), drill?.value ?? ''),
      ),
    [drillModels, drill, isFavoriteModel],
  );


  const trimmedQuery = query.trim();
  const showPinnedOnly = activeTier === null && pinnedFilter;
  const activeTierLabel = tierOptions.find((t) => t.value === activeTier)?.label;
  const isNarrowed = trimmedQuery !== '' || activeTier !== null;
  const clearAll = () => {
    setQuery('');
    setActiveTier(null);
  };

  /* One row shape for a model, used by both the pinned group and the full
     list — they were two copies of the same markup, which is how a pin ends up
     behaving differently depending on which group it is in. The tick marks the
     model currently in use, as §13 does for a chosen row. */
  const renderModelRow = (m: any) => {
    const name = String(m?.name ?? m);
    const endpoint = drill as Endpoint;
    const isFav = isFavoriteModel(name, endpoint.value ?? '');
    const isCurrent =
      selectedValues?.model === name && selectedValues?.endpoint === endpoint.value;
    return (
      <button
        key={name}
        type="button"
        onClick={() => {
          handleSelectModel(endpoint, name);
          onClose();
        }}
        className={cn(rowBase, 'group h-11')}
      >
        <span className="min-w-0 flex-1 truncate text-[13.5px] leading-[20px] text-text-primary">
          {formatModelName(name)}
        </span>
        {isCurrent && <Check size={16} className="shrink-0 text-text-primary" aria-hidden="true" />}
        <span
          role="button"
          tabIndex={0}
          aria-label={localize(isFav ? 'com_ui_unpin' : 'com_ui_pin')}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavoriteModel({ model: name, endpoint: endpoint.value ?? '' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              toggleFavoriteModel({ model: name, endpoint: endpoint.value ?? '' });
            }
          }}
          className={pinButtonClass(isFav)}
        >
          <Pin size={PIN_GLYPH_SIZE} aria-hidden="true" />
        </span>
      </button>
    );
  };

  /* §11.11: an empty state names the cause and offers to clear search AND
     filters in one action. A bare "No results" leaves you to work out which of
     the two is hiding everything. */
  const Empty = () => (
    <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
      <b className="text-[13.5px] font-medium text-text-primary">
        {trimmedQuery !== ''
          ? localize('com_ui_no_models_match_query', { 0: trimmedQuery })
          : localize('com_ui_no_models_match')}
      </b>
      <p className="text-[12.5px] leading-[19px] text-text-secondary-alt">
        {activeTier !== null && activeTierLabel != null
          ? localize('com_ui_filter_narrowing', { 0: activeTierLabel })
          : localize('com_ui_try_shorter_search')}
      </p>
      {isNarrowed && (
        <button
          type="button"
          onClick={clearAll}
          className="mt-1.5 rounded-[8px] px-3 py-2 text-[12.5px] font-medium text-brand-purple transition-colors hover:bg-surface-active"
        >
          {localize('com_ui_clear_search_and_filters')}
        </button>
      )}
    </div>
  );
  const rowBase =
    'flex w-full items-center gap-3 rounded-[10px] px-4 text-left transition-colors hover:bg-surface-active';

  return createPortal(
    /* §10 Popups: the panel rises 10px into the middle of the screen on
       `popDialog` and the scrim only fades, both inside AnimatePresence so the
       close animates too. Without that wrapper it faded in and then vanished.
       §14: 472 wide, min(620px, 82vh), centred over the scrim — it used to sit
       above the composer at the composer's width, which is the MOBILE
       placement applied on every screen. §7 layers: scrim 60, panel above. */
    <AnimatePresence>
      {open && (
    <motion.div
      {...popScrim}
      className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(16,18,24,0.42)] dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={localize('com_ui_select_model_short')}
    >
      <button
        type="button"
        aria-label={localize('com_ui_close')}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-transparent"
      />
      <motion.div
        ref={panelRef}
        {...popDialog}
        /* §7: no border in dark — the shadow does the work — and light adds the
           inset hairline, because a shadow alone is too weak on white. §1: the
           panel is --elevated and the field inside it is --surface; those two
           were the wrong way round, so the search sat a step ABOVE the panel
           holding it. */
        className="relative z-[61] flex h-[min(620px,82vh)] w-[472px] max-w-[calc(100vw-48px)] flex-col gap-3 overflow-hidden rounded-[16px] bg-white dark:bg-surface-hover py-4 pl-[18px] pr-[18px] shadow-[0_6px_16px_rgba(16,18,24,0.08),0_2px_6px_rgba(16,18,24,0.05)] ring-1 ring-inset ring-border-light dark:shadow-[0_12px_34px_rgba(0,0,0,0.4)] dark:ring-0"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              {drill && (
                <button
                  type="button"
                  onClick={() => setDrill(null)}
                  aria-label={localize('com_ui_back')}
                  className="text-text-secondary transition-colors hover:text-text-primary"
                >
                  <ChevronRight size={18} className="rotate-180" aria-hidden="true" />
                </button>
              )}
              {/* §2: a dialog title is 17/600 at -.2px. 20 is the page-title
                  size and made this panel read as a screen. */}
              <h2 className="truncate text-[17px] font-semibold leading-[25px] tracking-[-0.2px] text-text-primary">
                {drill ? (drill.label ?? drill.value) : localize('com_ui_select_model_short')}
              </h2>
            </div>
            <p className="text-[12px] leading-[18px] text-text-secondary-alt">
              {drill
                ? localize('com_ui_x_models', { 0: String(drill.models?.length ?? 0) })
                : `${totals.models}+ models · ${totals.providers} providers`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={localize('com_ui_close')}
            /* §4 `.iconbtn`: 32px, no fill at rest — a filled circle at rest
               reads as a primary action sitting in the corner of the header. */
            className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-text-secondary-alt transition-colors hover:bg-surface-active hover:text-text-primary"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-[10px]">
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary-alt"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                drill
                  ? `${localize('com_ui_search')} ${drill.label ?? drill.value}...`
                  : `${localize('com_ui_search')} ${totals.models}+ models...`
              }
              aria-label={localize('com_endpoint_search_models')}
              /* §6 `.msearch`: 42 tall on --surface. It was 44 on --elevated,
                 the same step as the panel, so the field disappeared into it
                 (§1 rule 2). No focus ring — §6 gives that to `.inp`, not to
                 a search field. */
              className="h-[42px] w-full rounded-[10px] bg-surface-secondary pl-11 pr-4 text-[13.5px] leading-[20px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
          </div>
        </div>

        {/* Filter pills — the root only. Inside a provider you are already
            narrowed to one, so the pills there would be a second, quieter
            way of doing what the back arrow does. */}
        {!drill && (
          /* §3 puts 20–24 between sections. The panel's own 12px gap is the
             rhythm *within* the header; the strip and the list it filters are
             two different things and were reading as one block. */
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <span className="mr-1 text-[12.5px] leading-[18.75px] text-text-secondary-alt">
              {localize('com_ui_filter')}
            </span>
            <Chip
              label={localize('com_ui_all_proper')}
              active={activeTier === null && !pinnedFilter}
              onClick={() => {
                setActiveTier(null);
                setPinnedFilter(false);
              }}
            />
            {pinned.length > 0 && (
              <Chip
                label={localize('com_ui_pinned')}
                active={showPinnedOnly}
                onClick={() => {
                  setActiveTier(null);
                  setPinnedFilter((v) => !v);
                }}
              />
            )}
            {tierOptions.map((tier) => (
              <Chip
                key={tier.value}
                label={tier.label}
                active={activeTier === tier.value}
                onClick={() => {
                  setPinnedFilter(false);
                  setActiveTier(tier.value);
                }}
              />
            ))}
          </div>
        )}

        {/* Body */}
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2 [&::-webkit-scrollbar-thumb]:rounded-[2px] [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-[3px]">
          {drill ? (
            <>
              {drillModels.length === 0 && <Empty />}
              {showPinnedOnly && drillPinned.length === 0 && drillModels.length > 0 && <Empty />}
              {showPinnedOnly
                ? drillPinned.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      {drillPinned.map((m: any) => renderModelRow(m))}
                    </div>
                  )
                : drillModels.length > 0 && (
                    <>
                      <div className={cn(sectionLabel, 'pb-1')}>
                        {localize('com_ui_all_models')}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {drillModels.map((m: any) => renderModelRow(m))}
                      </div>
                    </>
                  )}
            </>
          ) : (
            <>
              {/* Personas first, then Pinned. Personas is a way into another
                  list; pinned models are picks out of this one, and a heading
                  above the only unlabelled row on the panel read as though the
                  row belonged to it. */}
              {showMarketplace && personaCount > 0 && (
                <button
                  type="button"
                  data-testid="model-modal-personas"
                  onClick={() => {
                    onClose();
                    navigate('/agents');
                  }}
                  className="mb-3 flex h-[62px] w-full items-center gap-3 rounded-[10px] bg-surface-hover px-4 text-left transition-colors hover:bg-surface-active"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-medium leading-[21px] text-text-primary">
                      {localize('com_ui_personas')}
                    </span>
                    <span className="truncate text-[12px] leading-[18px] text-text-secondary-alt">
                      {localize('com_ui_x_saved_presets', { 0: String(personaCount) })}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-text-secondary" aria-hidden="true" />
                </button>
              )}

              {showPinnedOnly && pinned.length > 0 && (
                <>
                  <div className="mb-3 flex flex-col gap-0.5">
                    {pinned.map(({ endpoint, model }) => (
                      <button
                        key={`${endpoint.value}-${model}`}
                        type="button"
                        onClick={() => {
                          handleSelectModel(endpoint, model);
                          onClose();
                        }}
                        className={cn(rowBase, 'h-[52px]')}
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[14px] font-medium leading-[21px] text-text-primary">
                            {formatModelName(model)}
                          </span>
                          <span className="truncate text-[12px] leading-[18px] text-text-secondary-alt">
                            {endpoint.label ?? endpoint.value}
                          </span>
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={localize('com_ui_unpin')}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavoriteModel({ model, endpoint: endpoint.value ?? '' });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleFavoriteModel({ model, endpoint: endpoint.value ?? '' });
                            }
                          }}
                          className={pinButtonClass(true)}
                        >
                          <Pin size={PIN_GLYPH_SIZE} aria-hidden="true" />
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {modelResults != null && (
                <div className="mb-3">
                  <div className={cn(sectionLabel, 'pb-1')}>{localize('com_ui_models')}</div>
                  {modelResults.length === 0 ? (
                    <div className="px-1 py-2 text-[13px] text-text-secondary-alt">
                      {localize('com_ui_nothing_found')}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {modelResults.map(({ endpoint, name }) => (
                        <button
                          key={`search-${endpoint.value}-${name}`}
                          type="button"
                          onClick={() => {
                            handleSelectModel(endpoint, name);
                            onClose();
                          }}
                          className={cn(rowBase, 'h-[52px]')}
                        >
                          <span className="flex min-w-0 flex-1 flex-col text-left">
                            <span className="truncate text-[14px] font-medium leading-[21px] text-text-primary">
                              {formatModelName(name)}
                            </span>
                            <span className="truncate text-[12px] leading-[18px] text-text-secondary-alt">
                              {endpoint.label ?? endpoint.value}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* One heading over the provider list, guarded on the list
                  being non-empty. The panel used to print two in a row, the
                  second an unconditional "most used first" that was not true
                  of any order it actually used. */}
              {!showPinnedOnly && providers.length > 0 && (
                <div className={cn(sectionLabel, 'pb-1')}>
                  {localize('com_ui_providers')}
                </div>
              )}
              {showPinnedOnly && pinned.length === 0 && <Empty />}
              {!showPinnedOnly && providers.length === 0 && pinned.length === 0 && <Empty />}
              <div className="flex flex-col gap-0.5">
                {!showPinnedOnly && providers.map((endpoint) => (
                  <button
                    key={endpoint.value}
                    type="button"
                    onClick={() => {
                      if ((endpoint.models?.length ?? 0) > 0) {
                        setDrill(endpoint);
                      } else {
                        handleSelectEndpoint(endpoint);
                        onClose();
                      }
                    }}
                    className={cn(rowBase, 'h-[62px]')}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px] font-medium leading-[21px] text-text-primary">
                        {endpoint.label ?? endpoint.value}
                      </span>
                      <span className="truncate text-[12px] leading-[18px] text-text-secondary-alt">
                        {modelNames(endpoint)}
                      </span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-text-secondary" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      /* §5, counted from this panel rather than from the page: the panel is
         --elevated, so the chip starts two rungs above that. An --elevated chip
         in here would be invisible. */
      className={cn(
        'shrink-0 rounded-[9px] px-[15px] py-[7px] text-[12.5px] font-medium leading-[17px] transition-colors',
        active
          ? 'bg-border-light text-text-primary hover:bg-border-heavy'
          : 'bg-transparent text-text-secondary-alt hover:bg-surface-active hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}
