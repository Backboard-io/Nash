import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, Check, ChevronRight, EarthIcon, Lock, Pin, Search, SettingsIcon, X } from 'lucide-react';
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
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface-hover text-text-secondary transition-colors hover:text-text-primary"
    >
      <X size={17} aria-hidden="true" />
    </button>
  );
}

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
    <div className="flex h-[42px] shrink-0 items-center gap-[9px] rounded-[12px] bg-surface-primary-alt px-3 dark:bg-surface-hover">
      <Search size={15} className="shrink-0 text-text-secondary" aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full min-w-0 flex-1 border-none bg-transparent p-0 text-[13px] leading-[19.5px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
      />
    </div>
  );
}

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
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      title={description}
      className={cn(
        'flex h-8 shrink-0 items-center rounded-full px-3.5 text-[12px] leading-[18px] transition-colors',
        isActive
          ? 'bg-brand-purple font-medium text-white dark:text-text-primary'
          : 'border border-border-light font-normal text-text-secondary-alt dark:text-text-secondary',
      )}
    >
      {label}
    </button>
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
        <Check size={16} className="shrink-0 self-center text-brand-purple" aria-hidden="true" />
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

  const handleUnpin = (e: React.MouseEvent) => {
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
        {isFavorite && (
          <button
            type="button"
            onClick={handleUnpin}
            aria-label={localize('com_ui_unpin')}
            className="rounded p-0.5 text-text-secondary hover:bg-surface-active"
          >
            <Pin size={14} aria-hidden="true" />
          </button>
        )}
        {isSelected && (
          <Check size={16} className="shrink-0 text-brand-purple" aria-hidden="true" />
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
        'flex h-11 w-full shrink-0 cursor-pointer items-center justify-between gap-1.5 rounded-[8px] px-2 outline-none transition-colors',
        isEndpointSelected && 'bg-surface-hover',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'truncate text-left text-[14px] leading-[21px] text-text-primary',
            isAllPremium && 'opacity-50',
          )}
        >
          {endpoint.label}
        </span>
        {isAllPremium && (
          <Lock className="size-3 shrink-0 text-text-secondary opacity-60" aria-hidden="true" />
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
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
          >
            <SettingsIcon className="size-4" aria-hidden="true" />
          </button>
        )}
        {endpoint.hasModels ? (
          <ChevronRight size={14} className="shrink-0 text-text-secondary" aria-hidden="true" />
        ) : (
          isEndpointSelected && (
            <Check size={16} className="shrink-0 text-brand-purple" aria-hidden="true" />
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
        <ArrowLeft size={18} aria-hidden="true" />
      </button>
      <h2 className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-[27px] text-text-primary">
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
      <MobileSearchField
        value={searchValue}
        onValueChange={(value) => setEndpointSearchValue(endpoint.value, value)}
        placeholder={placeholder}
      />
      <div className="h-2.5 shrink-0" aria-hidden="true" />
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-y-0.5 overflow-y-auto pb-4">
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
      <div className="h-2.5 shrink-0" aria-hidden="true" />
      <div className="flex min-h-0 flex-1 flex-col gap-y-0.5 overflow-y-auto pb-4">
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
              <Check size={16} className="shrink-0 text-brand-purple" aria-hidden="true" />
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
    setEndpointSearchValue,
    filteredMappedEndpoints,
  } = useModelSelectorContext();

  const [drill, setDrill] = useState<DrillTarget>(null);
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

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
      style={{ bottom: 'var(--nash-composer-h, 0px)' }}
      className="fixed inset-x-0 top-12 z-[120] flex flex-col bg-surface-primary outline-none"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-y-0.5 px-5 pt-3.5">
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
            <div className="flex h-11 shrink-0 items-center justify-between pb-3.5">
              <h2 className="text-[18px] font-semibold leading-[27px] text-text-primary">
                {localize('com_ui_select_model_short')}
              </h2>
              <MobileCloseButton onClick={closeAll} />
            </div>
            <MobileSearchField
              value={query}
              onValueChange={handleQueryChange}
              placeholder={localize('com_endpoint_search_models')}
            />
            <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto py-2">
              <MobileTierChip
                label={localize('com_ui_all_proper')}
                isActive={activeTier === null}
                onClick={() => setActiveTier(null)}
              />
              {hasTierFilters &&
                tierOptions.map((tier) => (
                  <MobileTierChip
                    key={tier.value}
                    label={tier.label}
                    description={tier.description}
                    isActive={activeTier === tier.value}
                    onClick={() => setActiveTier(tier.value)}
                  />
                ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-y-0.5 overflow-y-auto pb-4">
              <div className="h-4 shrink-0" aria-hidden="true" />
              {showMarketplace && (
                <>
                  <div
                    role="button"
                    tabIndex={0}
                    data-testid="model-panel-personas"
                    onClick={goToPersonas}
                    onKeyDown={rowKeyDown(goToPersonas)}
                    className="flex h-11 w-full shrink-0 cursor-pointer items-center justify-between px-2 text-[14px] leading-[21px] text-text-primary outline-none"
                  >
                    <span>{localize('com_ui_personas')}</span>
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-text-secondary"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="h-4 shrink-0" aria-hidden="true" />
                </>
              )}
              {searchResults ? (
                <MobileSearchResults onCloseAll={closeAll} />
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
                  {(filteredMappedEndpoints ?? []).map((endpoint) => (
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
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
