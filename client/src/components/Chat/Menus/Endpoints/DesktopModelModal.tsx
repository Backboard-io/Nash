import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronDown, Search, SlidersHorizontal, X, Pin, PinOff } from 'lucide-react';
import type { Endpoint } from '~/common';
import { useModelSelectorContext } from './ModelSelectorContext';
import { tierOptions } from './utils';
import { useLocalize, useShowMarketplace, useFavorites } from '~/hooks';
import { cn } from '~/utils';
import { formatModelName } from '~/utils/modelDisplay';

type SortKey = 'newest' | 'name';

/**
 * Desktop "Select Model" modal (Figma "Model Selection — 04.08"): a centered
 * panel above the composer with search, tier filter chips, a sort control, a
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
  } = useModelSelectorContext();

  const [sort, setSort] = useState<SortKey>('newest');
  const [sortOpen, setSortOpen] = useState(false);
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
      setSortOpen(false);
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

  // Crossing into or out of a provider starts a fresh search: carrying the old
  // query over would silently filter the new list, often down to nothing.
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
    if (sort === 'name') {
      list.sort((a, b) =>
        (a.label ?? a.value ?? '').localeCompare(b.label ?? b.value ?? ''),
      );
    }
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
  }, [filteredMappedEndpoints, sort, searchValue, showMarketplace, localize]);

  /**
   * The drilled-in provider's models, filtered by the query. Without this the
   * search field sat above an unfiltered list and did nothing once you were
   * inside a provider.
   */
  const drillModels = useMemo(() => {
    const models = drill?.models ?? [];
    const q = searchValue.trim().toLowerCase();
    if (!q) {
      return models;
    }
    return models.filter((m: any) => String(m?.name ?? m).toLowerCase().includes(q));
  }, [drill, searchValue]);

  /** Favourited models, resolved back to their endpoint so they can be selected. */
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

  if (!open) {
    return null;
  }

  const modelNames = (endpoint: Endpoint) =>
    (endpoint.models ?? [])
      .slice(0, 3)
      .map((m: any) => formatModelName(String(m?.name ?? m)))
      .join(', ');

  const sectionLabel = 'px-1 text-[10.5px] font-medium uppercase leading-[16px] tracking-[0.04em] text-text-tertiary';
  const rowBase =
    'flex w-full items-center gap-3 rounded-[10px] px-4 text-left transition-colors hover:bg-surface-active';

  return createPortal(
    <div
      ref={panelRef}
      className="fixed inset-x-0 top-0 z-[120] flex items-end"
      style={{
        // Figma 'Model Selection': the panel's bottom edge sits 14px above the composer.
        bottom: 'calc(var(--nash-composer-top, var(--nash-composer-h, 0px)) + 14px)',
      }}
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
      <div
        style={{
          marginLeft: 'var(--nash-composer-left, 0px)',
          width: 'var(--nash-composer-w, 720px)',
        }}
        className="relative flex h-[520px] max-h-[calc(100%-1rem)] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-hidden rounded-[16px] border border-border-medium bg-surface-secondary py-4 pl-[18px] pr-[18px] shadow-[0_12px_34px_rgba(0,0,0,0.14)]"
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
              <h2 className="truncate text-[20px] font-semibold leading-[30px] text-text-primary">
                {drill ? (drill.label ?? drill.value) : localize('com_ui_select_model_short')}
              </h2>
            </div>
            <p className="text-[12.5px] leading-[18.75px] text-text-secondary-alt">
              {drill
                ? localize('com_ui_x_models', { 0: String(drill.models?.length ?? 0) })
                : `${totals.models}+ models · ${totals.providers} providers`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={localize('com_ui_close')}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-hover text-text-secondary transition-colors hover:bg-surface-active hover:text-text-primary"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0">
          <div className="relative">
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
              className="h-11 w-full rounded-[10px] bg-surface-hover pl-11 pr-4 text-[13.5px] leading-[20px] text-text-primary placeholder:text-text-secondary-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        {/* Filter chips + sort */}
        {!drill && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="mr-1 text-[12.5px] leading-[18.75px] text-text-secondary-alt">
              {localize('com_ui_filter')}
            </span>
            <Chip label={localize('com_ui_all_proper')} active={activeTier === null} onClick={() => setActiveTier(null)} />
            {tierOptions.map((tier) => (
              <Chip
                key={tier.value}
                label={tier.label}
                active={activeTier === tier.value}
                onClick={() => setActiveTier(tier.value)}
              />
            ))}
            <div className="relative ml-auto">
              <button
                type="button"
                onClick={() => setSortOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={sortOpen}
                className="flex h-[30px] items-center gap-2 rounded-full border border-border-light px-3 text-[12.5px] leading-[18.75px] text-text-secondary-alt transition-colors hover:bg-surface-hover"
              >
                <SlidersHorizontal size={13} aria-hidden="true" />
                <span>{localize('com_ui_sort')}</span>
                <span className="font-medium text-text-primary">
                  {sort === 'newest' ? localize('com_ui_newest') : localize('com_ui_name')}
                </span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {sortOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[34px] z-10 w-40 overflow-hidden rounded-[10px] border border-border-light bg-surface-secondary py-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
                >
                  {(['newest', 'name'] as SortKey[]).map((key) => (
                    <button
                      key={key}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setSort(key);
                        setSortOpen(false);
                      }}
                      className={cn(
                        'flex h-8 w-full items-center px-3 text-[12.5px] transition-colors hover:bg-surface-hover',
                        sort === key ? 'text-text-primary' : 'text-text-secondary',
                      )}
                    >
                      {key === 'newest' ? localize('com_ui_newest') : localize('com_ui_name')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2 [&::-webkit-scrollbar-thumb]:rounded-[2px] [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-[3px]">
          {drill ? (
            <div className="flex flex-col gap-0.5">
              {drillModels.length === 0 && (
                <div className="px-3 py-6 text-center text-[13px] text-text-secondary-alt">
                  {localize('com_files_no_results')}
                </div>
              )}
              {drillModels.map((m: any) => {
                const name = String(m?.name ?? m);
                const isFav = isFavoriteModel(name, drill.value);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      handleSelectModel(drill, name);
                      onClose();
                    }}
                    className={cn(rowBase, 'h-11')}
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px] leading-[21px] text-text-primary">
                      {formatModelName(name)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={localize(isFav ? 'com_ui_unpin' : 'com_ui_pin')}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavoriteModel({ model: name, endpoint: drill.value ?? '' });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavoriteModel({ model: name, endpoint: drill.value ?? '' });
                        }
                      }}
                      className="shrink-0 text-text-secondary-alt transition-colors hover:text-text-primary"
                    >
                      {isFav ? <PinOff size={14} /> : <Pin size={14} />}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <>
                  <div className={cn(sectionLabel, 'pb-1')}>{localize('com_ui_pinned')}</div>
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
                          className="shrink-0 text-text-secondary-alt transition-colors hover:text-text-primary"
                        >
                          <PinOff size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {showMarketplace && (
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

              <div className={cn(sectionLabel, 'pb-1')}>{localize('com_ui_providers_most_used')}</div>
              <div className="flex flex-col gap-0.5">
                {providers.map((endpoint) => (
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
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium leading-[21px] text-text-primary">
                          {endpoint.label ?? endpoint.value}
                        </span>
                        <span className="shrink-0 rounded-[5px] bg-surface-active px-1.5 text-[11px] leading-[17px] text-text-secondary-alt">
                          {endpoint.models?.length ?? 0}
                        </span>
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
      </div>
    </div>,
    document.body,
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-[30px] shrink-0 rounded-full px-3.5 text-[12.5px] leading-[18.75px] transition-colors',
        active
          ? 'bg-brand-purple font-medium text-white'
          : 'border border-border-light text-text-secondary hover:bg-surface-hover',
      )}
    >
      {label}
    </button>
  );
}
