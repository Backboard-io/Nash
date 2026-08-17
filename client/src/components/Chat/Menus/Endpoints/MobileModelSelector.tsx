import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  EarthIcon,
  Lock,
  Pin,
  SettingsIcon,
  X,
} from 'lucide-react';
import { Spinner } from '@librechat/client';
import { EModelEndpoint, isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type { TModelSpec } from 'librechat-data-provider';
import type { Endpoint } from '~/common';
import { useModelSelectorContext } from './ModelSelectorContext';
import { collectCustomGroups } from './components';
import { filterModels, tierOptions } from './utils';
import GroupIcon from './components/GroupIcon';
import SpecIcon from './components/SpecIcon';
import { useFavorites, useLocalize, useShowMarketplace } from '~/hooks';
import { cn } from '~/utils';
import { formatModelName } from '~/utils/modelDisplay';
import { modelNames, sectionLabel } from './modelPickerStyles';
import SearchField from '~/components/ui/SearchField';
import FilterPill from '~/components/ui/FilterPill';
import { pinButtonClass, PIN_GLYPH_SIZE } from '~/components/ui/pinStyles';

const VIRTUALIZATION_THRESHOLD = 50;
const MOBILE_ITEM_HEIGHT = 48;

interface MobileModelSelectorProps {
  open: boolean;
  onClose: () => void;
}

type DrillTarget = { kind: 'endpoint'; value: string } | { kind: 'group'; name: string } | null;

function rowKeyDown(handler: () => void) {
  return (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  };
}

function MobileCloseButton({ onClick }: { onClick: () => void }) {
  const localize = useLocalize();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={localize('com_ui_close')}
      /* §4 `.iconbtn`: 30 on mobile, radius 7, no fill at rest. It was a
         filled circle, which made the dismiss the heaviest thing in the
         header — §7 gives the × no fill precisely so it does not compete
         with the title beside it. Neutral focus ring, never accent. */
      className="grid size-[30px] shrink-0 place-items-center rounded-[7px] text-text-secondary-alt transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-heavy"
    >
      <X size={16} aria-hidden="true" />
    </button>
  );
}

/**
 * §6: the Bookmarks field is the standard everywhere, so this is that
 * component — it was a bespoke 42-tall radius-12 field with a 15px glyph, which
 * is a fourth search box in an app that is supposed to have one. `on="card"`
 * because it sits on the panel's --surface list card (§1 rule 2).
 */
function MobileSearchField({
  value,
  onValueChange,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <SearchField
      on="overlay"
      className="shrink-0 grow-0"
      value={value}
      onChange={onValueChange}
      onClear={() => onValueChange('')}
      placeholder={placeholder}
    />
  );
}

/**
 * §5 pills, via the shared component. This was its own chip with a
 * `bg-brand-purple` active state — accent marks state, but the selected filter
 * pill has its own defined fill (§5) that the rest of the app already uses, and
 * a purple pill in here was the one saturated thing on the screen.
 */
function MobileTierChip({
  label,
  isActive,
  onClick,
  description,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  description?: string;
}) {
  return (
    <FilterPill selected={isActive} onClick={onClick} onCard title={description}>
      {label}
    </FilterPill>
  );
}

function MobileSpecRow({
  spec,
  isSelected,
  onSelect,
}: {
  spec: TModelSpec;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { endpointsConfig } = useModelSelectorContext();
  const { showIconInMenu = true } = spec;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={rowKeyDown(onSelect)}
      className={cn(
        'flex min-h-[46px] w-full shrink-0 cursor-pointer items-center justify-between gap-2 rounded-[8px] px-2 outline-none transition-colors',
        isSelected && 'bg-surface-hover',
      )}
    >
      <div
        className={cn(
          'flex w-full min-w-0 gap-2 py-1',
          spec.description ? 'items-start' : 'items-center',
        )}
      >
        {showIconInMenu && (
          <div className="flex-shrink-0">
            <SpecIcon currentSpec={spec} endpointsConfig={endpointsConfig} />
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-left text-[14px] leading-[21px] text-text-primary">
            {spec.label}
          </span>
          {spec.description && (
            <span className="break-words text-[12px] font-normal leading-[18px] text-text-secondary-alt">
              {spec.description}
            </span>
          )}
        </div>
      </div>
      {isSelected && (
        <Check size={16} className="shrink-0 self-center text-text-primary" aria-hidden="true" />
      )}
    </div>
  );
}

function MobileModelRow({
  endpoint,
  modelId,
  isSelected,
  onSelect,
}: {
  endpoint: Endpoint;
  modelId: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const localize = useLocalize();
  const { isFavoriteModel, toggleFavoriteModel, isFavoriteAgent, toggleFavoriteAgent } =
    useFavorites();

  let isGlobal = false;
  let modelName = formatModelName(modelId);
  const avatarUrl = endpoint?.modelIcons?.[modelId] || null;

  if (isAgentsEndpoint(endpoint.value) && endpoint.agentNames?.[modelId]) {
    modelName = endpoint.agentNames[modelId];

    const modelInfo = endpoint?.models?.find((m) => m.name === modelId);
    isGlobal = modelInfo?.isGlobal ?? false;
  } else if (isAssistantsEndpoint(endpoint.value) && endpoint.assistantNames?.[modelId]) {
    modelName = endpoint.assistantNames[modelId];
  }

  const isAgent = isAgentsEndpoint(endpoint.value);
  const isFavorite = isAgent
    ? isFavoriteAgent(modelId)
    : isFavoriteModel(modelId, endpoint.value);

  const handleTogglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAgent) {
      toggleFavoriteAgent(modelId);
    } else {
      toggleFavoriteModel({ model: modelId, endpoint: endpoint.value });
    }
  };

  const showEndpointIcon =
    (isAgentsEndpoint(endpoint.value) || isAssistantsEndpoint(endpoint.value)) && endpoint.icon;
  const avatar = avatarUrl ? (
    <img src={avatarUrl} alt={modelName} className="h-full w-full object-cover" />
  ) : showEndpointIcon ? (
    endpoint.icon
  ) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={rowKeyDown(onSelect)}
      className={cn(
        'flex h-[46px] w-full shrink-0 cursor-pointer items-center justify-between gap-2 rounded-[8px] px-2 outline-none transition-colors',
        isSelected && 'bg-surface-hover',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {avatar && (
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-full">
            {avatar}
          </div>
        )}
        <span className="truncate text-[14px] leading-[21px] text-text-primary">{modelName}</span>
        {isGlobal && (
          <EarthIcon className="ml-1 size-3.5 shrink-0 text-surface-submit" aria-hidden="true" />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleTogglePin}
          aria-label={localize(isFavorite ? 'com_ui_unpin' : 'com_ui_pin')}
          className={pinButtonClass(isFavorite, true)}
        >
          <Pin size={PIN_GLYPH_SIZE} aria-hidden="true" />
        </button>
        {isSelected && (
          <Check size={16} className="shrink-0 text-text-primary" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

function MobileProviderRow({
  endpoint,
  onDrill,
  onCloseAll,
}: {
  endpoint: Endpoint;
  onDrill: (endpoint: Endpoint) => void;
  onCloseAll: () => void;
}) {
  const localize = useLocalize();
  const { selectedValues, handleSelectEndpoint, handleOpenKeyDialog, endpointRequiresUserKey } =
    useModelSelectorContext();
  const isEndpointSelected = selectedValues.endpoint === endpoint.value;
  const isUserProvided = useMemo(
    () => endpointRequiresUserKey(endpoint.value),
    [endpointRequiresUserKey, endpoint.value],
  );
  const isAllPremium = useMemo(() => {
    if (!endpoint.models?.length) {
      return false;
    }
    return endpoint.models.every((m) => m.isPremium);
  }, [endpoint.models]);

  const subtitle = useMemo(() => modelNames(endpoint), [endpoint]);

  const handleRowClick = () => {
    if (endpoint.hasModels) {
      onDrill(endpoint);
    } else {
      handleSelectEndpoint(endpoint);
      onCloseAll();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={endpoint.hasModels ? undefined : isEndpointSelected}
      onClick={handleRowClick}
      onKeyDown={rowKeyDown(handleRowClick)}
      className={cn(
        'flex h-[52px] w-full shrink-0 cursor-pointer items-center justify-between gap-1.5 rounded-[8px] px-2 outline-none transition-colors',
        isEndpointSelected && 'bg-surface-hover',
      )}
    >
      <div className="flex min-w-0 flex-col text-left">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'truncate text-left text-[14px] font-medium leading-[21px] text-text-primary',
              isAllPremium && 'opacity-50',
            )}
          >
            {endpoint.label}
          </span>
          {isAllPremium && (
            <Lock className="size-3 shrink-0 text-text-secondary opacity-60" aria-hidden="true" />
          )}
        </div>
        {/* What is behind the chevron, same as the desktop panel. A provider
            row with only a name makes you drill in to find out whether it has
            the model you want. */}
        {subtitle && (
          <span className="truncate text-[12px] leading-[18px] text-text-secondary-alt">
            {subtitle}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {isUserProvided && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (endpoint.value) {
                handleOpenKeyDialog(endpoint.value as EModelEndpoint, e);
              }
            }}
            aria-label={`${localize('com_endpoint_config_key')} ${endpoint.label}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
          >
            <SettingsIcon className="size-4" aria-hidden="true" />
          </button>
        )}
        {endpoint.hasModels ? (
          <ChevronRight size={16} className="shrink-0 text-text-secondary" aria-hidden="true" />
        ) : (
          isEndpointSelected && (
            <Check size={16} className="shrink-0 text-text-primary" aria-hidden="true" />
          )
        )}
      </div>
    </div>
  );
}

function MobileDrillHeader({
  title,
  onBack,
  onCloseAll,
}: {
  title: string;
  onBack: () => void;
  onCloseAll: () => void;
}) {
  const localize = useLocalize();
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 pb-3.5">
      <button
        type="button"
        onClick={onBack}
        aria-label={localize('com_ui_back')}
        className="flex shrink-0 items-center justify-center text-text-secondary transition-colors hover:text-text-primary"
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold leading-[25px] tracking-[-0.2px] text-text-primary">
        {title}
      </h2>
      <MobileCloseButton onClick={onCloseAll} />
    </div>
  );
}

function MobileEndpointDrill({
  endpoint,
  onBack,
  onCloseAll,
}: {
  endpoint: Endpoint;
  onBack: () => void;
  onCloseAll: () => void;
}) {
  const localize = useLocalize();
  const {
    agentsMap,
    activeTier,
    modelSpecs,
    assistantsMap,
    selectedValues,
    handleSelectSpec,
    handleSelectModel,
    endpointSearchValues,
    setEndpointSearchValue,
  } = useModelSelectorContext();
  const { model: selectedModel, endpoint: selectedEndpoint, modelSpec: selectedSpec } =
    selectedValues;
  const searchValue = endpointSearchValues[endpoint.value] || '';
  const placeholder = localize('com_endpoint_search_var', { 0: endpoint.label });

  const endpointSpecs = useMemo(() => {
    if (!modelSpecs || !modelSpecs.length) {
      return [];
    }
    return modelSpecs.filter((spec: TModelSpec) => spec.group === endpoint.value);
  }, [modelSpecs, endpoint.value]);

  const isAssistantsLoading = isAssistantsEndpoint(endpoint.value) && endpoint.models === undefined;

  const filteredModels = searchValue
    ? filterModels(
        endpoint,
        (endpoint.models || []).map((model) => model.name),
        searchValue,
        agentsMap,
        assistantsMap,
      )
    : null;
  const modelsToRender = filteredModels ?? (endpoint.models || []).map((model) => model.name);

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = modelsToRender.length > VIRTUALIZATION_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? modelsToRender.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => MOBILE_ITEM_HEIGHT, []),
    overscan: 15,
  });

  const selectModel = (modelId: string) => {
    handleSelectModel(endpoint, modelId);
    onCloseAll();
  };

  return (
    <>
      <MobileDrillHeader title={endpoint.label} onBack={onBack} onCloseAll={onCloseAll} />
      {/* Same list card as the root level, so drilling in does not change the
          material under the list. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-[14px] bg-surface-hover p-3">
      <MobileSearchField
        value={searchValue}
        onValueChange={(value) => setEndpointSearchValue(endpoint.value, value)}
        placeholder={placeholder}
      />
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-y-0.5 overflow-y-auto pt-1 pb-1">
        {modelsToRender.length > 0 && (
          <div className={cn(sectionLabel, 'pb-1')}>{localize('com_ui_models')}</div>
        )}
        {!activeTier &&
          endpointSpecs.map((spec: TModelSpec) => (
            <MobileSpecRow
              key={spec.name}
              spec={spec}
              isSelected={selectedSpec === spec.name}
              onSelect={() => {
                handleSelectSpec(spec);
                onCloseAll();
              }}
            />
          ))}
        {isAssistantsLoading ? (
          <div
            className="flex items-center justify-center p-2"
            role="status"
            aria-label={localize('com_ui_loading')}
          >
            <Spinner aria-hidden="true" />
          </div>
        ) : shouldVirtualize ? (
          <div
            className="relative w-full shrink-0"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const modelId = modelsToRender[virtualItem.index];
              return (
                <div
                  key={`${endpoint.value}-${modelId}-${virtualItem.index}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <MobileModelRow
                    endpoint={endpoint}
                    modelId={modelId}
                    isSelected={selectedEndpoint === endpoint.value && selectedModel === modelId}
                    onSelect={() => selectModel(modelId)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          modelsToRender.map((modelId, modelIndex) => (
            <MobileModelRow
              key={`${endpoint.value}-${modelId}-${modelIndex}`}
              endpoint={endpoint}
              modelId={modelId}
              isSelected={selectedEndpoint === endpoint.value && selectedModel === modelId}
              onSelect={() => selectModel(modelId)}
            />
          ))
        )}
      </div>
      </div>
    </>
  );
}

function MobileGroupDrill({
  groupName,
  specs,
  onBack,
  onCloseAll,
}: {
  groupName: string;
  specs: TModelSpec[];
  onBack: () => void;
  onCloseAll: () => void;
}) {
  const { selectedValues, handleSelectSpec } = useModelSelectorContext();
  const { modelSpec: selectedSpec } = selectedValues;
  return (
    <>
      <MobileDrillHeader title={groupName} onBack={onBack} onCloseAll={onCloseAll} />
      {/* Same list card as every other level of the panel. */}
      <div className="flex min-h-0 flex-1 flex-col rounded-[14px] bg-surface-hover p-3">
        <div className="flex min-h-0 flex-1 flex-col gap-y-0.5 overflow-y-auto pb-1">
          {specs.map((spec) => (
            <MobileSpecRow
              key={spec.name}
              spec={spec}
              isSelected={selectedSpec === spec.name}
              onSelect={() => {
                handleSelectSpec(spec);
                onCloseAll();
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function MobileSearchResults({ onCloseAll }: { onCloseAll: () => void }) {
  const localize = useLocalize();
  const {
    searchValue,
    searchResults,
    selectedValues,
    handleSelectSpec,
    handleSelectModel,
    handleSelectEndpoint,
  } = useModelSelectorContext();
  const {
    modelSpec: selectedSpec,
    endpoint: selectedEndpoint,
    model: selectedModel,
  } = selectedValues;

  if (!searchResults) {
    return null;
  }
  if (!searchResults.length) {
    return (
      <>
        <div role="alert" aria-live="polite" className="sr-only">
          {localize('com_files_no_results')}
        </div>
        <div className="cursor-default px-2 py-2 text-[13px] leading-[19.5px] text-text-secondary">
          {localize('com_files_no_results')}
        </div>
      </>
    );
  }

  return (
    <>
      <div role="alert" aria-live="polite" className="sr-only">
        {searchResults.length === 1
          ? localize('com_files_result_found', { count: searchResults.length })
          : localize('com_files_results_found', { count: searchResults.length })}
      </div>
      {searchResults.map((item, i) => {
        if ('name' in item && 'label' in item) {
          const spec = item as TModelSpec;
          return (
            <MobileSpecRow
              key={spec.name}
              spec={spec}
              isSelected={selectedSpec === spec.name}
              onSelect={() => {
                handleSelectSpec(spec);
                onCloseAll();
              }}
            />
          );
        }

        const endpoint = item as Endpoint;
        if (endpoint.hasModels && endpoint.models && endpoint.models.length > 0) {
          const lowerQuery = searchValue.toLowerCase();
          const filteredModels = endpoint.label.toLowerCase().includes(lowerQuery)
            ? endpoint.models
            : endpoint.models.filter((model) => {
                let modelName = model.name;
                if (isAgentsEndpoint(endpoint.value) && endpoint.agentNames?.[model.name]) {
                  modelName = endpoint.agentNames[model.name];
                } else if (
                  isAssistantsEndpoint(endpoint.value) &&
                  endpoint.assistantNames?.[model.name]
                ) {
                  modelName = endpoint.assistantNames[model.name];
                }
                return (
                  modelName.toLowerCase().includes(lowerQuery) ||
                  formatModelName(modelName).toLowerCase().includes(lowerQuery)
                );
              });

          if (!filteredModels.length) {
            return null;
          }

          return (
            <React.Fragment key={`endpoint-${endpoint.value}-search-${i}`}>
              <div className="flex items-center gap-2 px-2 py-1 text-[12px] font-medium leading-[18px] text-text-secondary-alt">
                {endpoint.label}
              </div>
              {filteredModels.map((model) => (
                <MobileModelRow
                  key={`${endpoint.value}-${model.name}-search-${i}`}
                  endpoint={endpoint}
                  modelId={model.name}
                  isSelected={selectedEndpoint === endpoint.value && selectedModel === model.name}
                  onSelect={() => {
                    handleSelectModel(endpoint, model.name);
                    onCloseAll();
                  }}
                />
              ))}
            </React.Fragment>
          );
        }

        const isEndpointSelected = selectedEndpoint === endpoint.value;
        const selectEndpoint = () => {
          handleSelectEndpoint(endpoint);
          onCloseAll();
        };
        return (
          <div
            key={`endpoint-${endpoint.value}-search-item`}
            role="button"
            tabIndex={0}
            aria-pressed={isEndpointSelected}
            onClick={selectEndpoint}
            onKeyDown={rowKeyDown(selectEndpoint)}
            className={cn(
              'flex h-11 w-full shrink-0 cursor-pointer items-center justify-between gap-2 rounded-[8px] px-2 outline-none transition-colors',
              isEndpointSelected && 'bg-surface-hover',
            )}
          >
            <span className="truncate text-[14px] leading-[21px] text-text-primary">
              {endpoint.label}
            </span>
            {isEndpointSelected && (
              <Check size={16} className="shrink-0 text-text-primary" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </>
  );
}

export default function MobileModelSelector({ open, onClose }: MobileModelSelectorProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const showMarketplace = useShowMarketplace();
  const {
    modelSpecs,
    activeTier,
    searchResults,
    setActiveTier,
    selectedValues,
    setSearchValue,
    mappedEndpoints,
    handleSelectSpec,
    handleSelectModel,
    setEndpointSearchValue,
    filteredMappedEndpoints,
    agentsMap,
  } = useModelSelectorContext();
  /* Same rule as the desktop panel: no personas saved, no way in. */
  const { favorites } = useFavorites();
  const [pinnedFilter, setPinnedFilter] = useState(false);
  const pinnedModels = useMemo(() => {
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
  const showPinnedOnly = activeTier === null && pinnedFilter;

  const personaCount = Object.keys(agentsMap ?? {}).length;
  const hasPersonas = personaCount > 0;

  const [drill, setDrill] = useState<DrillTarget>(null);
  const [query, setQuery] = useState('');

  const hasTierFilters = useMemo(
    () =>
      mappedEndpoints.some((endpoint) =>
        endpoint.models?.some((model) => (model.tiers?.length ?? 0) > 0),
      ),
    [mappedEndpoints],
  );
  const ungroupedSpecs = useMemo(
    () => (modelSpecs ?? []).filter((spec) => !spec.group),
    [modelSpecs],
  );
  const customGroups = useMemo(
    () => collectCustomGroups(modelSpecs ?? [], filteredMappedEndpoints ?? []),
    [modelSpecs, filteredMappedEndpoints],
  );
  /* The desktop panel drops the Personas endpoint from its provider list when
     the Personas card is showing, and mobile did not — so Personas appeared
     twice: once as a card that leads to the marketplace, and again as a bare
     provider row that selected the endpoint outright. The second one had a tick
     instead of a chevron and no second line, because it has no models of its
     own to count, which is what made it look like the odd row out.

     Note the condition: `showMarketplace` alone, not "…and personas exist".
     With none saved, the card is hidden *and* the endpoint stays filtered, so
     Personas does not appear at all — an endpoint whose whole content is a list
     of personas has nothing to offer when that list is empty. */
  const totals = useMemo(
    () => ({
      models: mappedEndpoints.reduce((n, e) => n + (e.models?.length ?? 0), 0),
      providers: mappedEndpoints.length,
    }),
    [mappedEndpoints],
  );
  const providers = useMemo(() => {
    let list = filteredMappedEndpoints ?? [];
    if (showMarketplace) {
      const personasLabel = localize('com_ui_personas').toLowerCase();
      list = list.filter((e) => (e.label ?? e.value ?? '').toLowerCase() !== personasLabel);
    }
    return list;
  }, [filteredMappedEndpoints, showMarketplace, localize]);

  const panelRef = useRef<HTMLDivElement>(null);
  const drillRef = useRef<DrillTarget>(null);
  drillRef.current = drill;

  const closeAll = useCallback(() => {
    const current = drillRef.current;
    if (current?.kind === 'endpoint') {
      setEndpointSearchValue(current.value, '');
    }
    onClose();
  }, [onClose, setEndpointSearchValue]);

  useEffect(() => {
    if (!open) {
      setDrill(null);
      setQuery('');
      setSearchValue('');
    }
  }, [open, setSearchValue]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAll();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeAll]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const drilledEndpoint =
    drill?.kind === 'endpoint'
      ? ((filteredMappedEndpoints ?? []).find((endpoint) => endpoint.value === drill.value) ?? null)
      : null;
  const drilledGroup =
    drill?.kind === 'group'
      ? (customGroups.find(([groupName]) => groupName === drill.name) ?? null)
      : null;

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSearchValue(value);
  };
  const goToPersonas = () => {
    closeAll();
    navigate('/agents');
  };

  return createPortal(
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={localize('com_ui_select_model_short')}
      /* Full-screen on mobile. The 52vh sheet left the list in a letterbox —
         on a short phone that is ~7 rows, so choosing a model meant scrolling
         a scroller inside a page that could not scroll. Picking a model is a
         one-thing-at-a-time task, so it gets the screen and returns it on
         select or ×. `dvh` so the mobile URL bar collapsing doesn't crop the
         bottom of the list, and the safe-area insets keep the header clear of
         the notch. */
      className="fixed inset-0 z-[60] flex h-[100dvh] flex-col bg-presentation pt-[env(safe-area-inset-top)] outline-none"
    >
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-2">
        {drilledEndpoint ? (
          <MobileEndpointDrill
            endpoint={drilledEndpoint}
            onBack={() => {
              setEndpointSearchValue(drilledEndpoint.value, '');
              setDrill(null);
            }}
            onCloseAll={closeAll}
          />
        ) : drilledGroup ? (
          <MobileGroupDrill
            groupName={drilledGroup[0]}
            specs={drilledGroup[1].specs}
            onBack={() => setDrill(null)}
            onCloseAll={closeAll}
          />
        ) : (
          <>
            <div className="flex shrink-0 items-start justify-between pb-3">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold leading-[25px] tracking-[-0.2px] text-text-primary">
                  {localize('com_ui_select_model_short')}
                </h2>
                <p className="text-[12px] leading-[18px] text-text-secondary-alt">
                  {`${totals.models}+ models · ${totals.providers} providers`}
                </p>
              </div>
              <MobileCloseButton onClick={closeAll} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-[14px] bg-surface-hover p-3">
              <MobileSearchField
                value={query}
                onValueChange={handleQueryChange}
                placeholder={`Search ${totals.models}+ models...`}
              />
              {/* §5: the strip says what it is, same as Bookmarks and the
                  desktop panel — a bare row of pills reads as tabs. */}
              <div className="flex shrink-0 items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <span className="shrink-0 text-[12.5px] leading-[19px] text-text-secondary-alt">
                  {localize('com_ui_filter')}
                </span>
                <MobileTierChip
                  label={localize('com_ui_all_proper')}
                  isActive={activeTier === null && !pinnedFilter}
                  onClick={() => {
                    setActiveTier(null);
                    setPinnedFilter(false);
                  }}
                />
                {pinnedModels.length > 0 && (
                  <MobileTierChip
                    label={localize('com_ui_pinned')}
                    isActive={showPinnedOnly}
                    onClick={() => {
                      setActiveTier(null);
                      setPinnedFilter((v) => !v);
                    }}
                  />
                )}
                {hasTierFilters &&
                  tierOptions.map((tier) => (
                    <MobileTierChip
                      key={tier.value}
                      label={tier.label}
                      description={tier.description}
                      isActive={activeTier === tier.value}
                      onClick={() => {
                        setPinnedFilter(false);
                        setActiveTier(tier.value);
                      }}
                    />
                  ))}
              </div>
            <div className="flex min-h-0 flex-1 flex-col gap-y-0.5 overflow-y-auto pt-1 pb-1">
              {showMarketplace && hasPersonas && (
                <>
                  <div
                    role="button"
                    tabIndex={0}
                    data-testid="model-panel-personas"
                    onClick={goToPersonas}
                    onKeyDown={rowKeyDown(goToPersonas)}
                    className="flex h-[52px] w-full shrink-0 cursor-pointer items-center justify-between gap-2 rounded-[8px] px-2 outline-none transition-colors active:bg-surface-active"
                  >
                    {/* A second line, as the desktop panel gives every row that
                        leads somewhere — a lone chevron does not say how much
                        is behind it. */}
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="truncate text-[14px] font-medium leading-[21px] text-text-primary">
                        {localize('com_ui_personas')}
                      </span>
                      <span className="truncate text-[12px] leading-[18px] text-text-secondary-alt">
                        {localize('com_ui_personas_saved', { 0: personaCount })}
                      </span>
                    </span>
                    <ChevronRight
                      size={16}
                      className="shrink-0 text-text-secondary"
                      aria-hidden="true"
                    />
                  </div>
                </>
              )}
              {searchResults ? (
                <MobileSearchResults onCloseAll={closeAll} />
              ) : showPinnedOnly ? (
                <>
                  {pinnedModels.map(({ endpoint, model }) => (
                    <MobileModelRow
                      key={`pinned-${endpoint.value}-${model}`}
                      endpoint={endpoint}
                      modelId={model}
                      isSelected={
                        selectedValues.endpoint === endpoint.value &&
                        selectedValues.model === model
                      }
                      onSelect={() => {
                        handleSelectModel(endpoint, model);
                        closeAll();
                      }}
                    />
                  ))}
                </>
              ) : (
                <>
                  {!activeTier &&
                    ungroupedSpecs.map((spec) => (
                      <MobileSpecRow
                        key={spec.name}
                        spec={spec}
                        isSelected={selectedValues.modelSpec === spec.name}
                        onSelect={() => {
                          handleSelectSpec(spec);
                          closeAll();
                        }}
                      />
                    ))}
                  {/* The same headings the desktop panel uses. Without them the
                      mobile list ran as one stream of rows and you could not
                      tell a pinned model from a provider you drill into. */}
                  {providers.length > 0 && (
                    <div className={cn(sectionLabel, 'pb-1 pt-2')}>
                      {localize('com_ui_providers')}
                    </div>
                  )}
                  {providers.map((endpoint) => (
                    <MobileProviderRow
                      key={`mobile-endpoint-${endpoint.value}`}
                      endpoint={endpoint}
                      onDrill={(target) => setDrill({ kind: 'endpoint', value: target.value })}
                      onCloseAll={closeAll}
                    />
                  ))}
                  {!activeTier &&
                    customGroups.map(([groupName, { groupIcon }]) => (
                      <div
                        key={`mobile-group-${groupName}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setDrill({ kind: 'group', name: groupName })}
                        onKeyDown={rowKeyDown(() => setDrill({ kind: 'group', name: groupName }))}
                        className="flex h-11 w-full shrink-0 cursor-pointer items-center justify-between gap-1.5 rounded-[8px] px-2 outline-none transition-colors"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {groupIcon && (
                            <div className="flex-shrink-0">
                              <GroupIcon iconURL={groupIcon} groupName={groupName} />
                            </div>
                          )}
                          <span className="truncate text-left text-[14px] leading-[21px] text-text-primary">
                            {groupName}
                          </span>
                        </div>
                        <ChevronRight
                          size={14}
                          className="shrink-0 text-text-secondary"
                          aria-hidden="true"
                        />
                      </div>
                    ))}
                </>
              )}
            </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
