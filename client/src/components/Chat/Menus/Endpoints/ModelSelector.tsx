import React, { useEffect, useMemo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useMediaQuery } from '@librechat/client';
import type { TModelTier } from 'librechat-data-provider';
import { QueryKeys, getConfigDefaults } from 'librechat-data-provider';
import type { ModelSelectorProps } from '~/common';
import {
  renderModelSpecs,
  renderEndpoints,
  renderSearchResults,
  renderCustomGroups,
} from './components';
import { ModelSelectorProvider, useModelSelectorContext } from './ModelSelectorContext';
import { getSelectedIcon, getDisplayValue, tierOptions } from './utils';
import { ModelSelectorChatProvider } from './ModelSelectorChatContext';
import MobileModelSelector from './MobileModelSelector';
import DesktopModelModal from './DesktopModelModal';
import { CustomMenu as Menu } from './CustomMenu';
import { useLocalize, useShowMarketplace } from '~/hooks';
import DialogManager from './DialogManager';
import { cn } from '~/utils';

function PanelTab({
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
      className="flex h-full flex-col items-center justify-center px-2.5"
    >
      <span
        className={cn(
          'text-[12px] leading-[18px] transition-colors',
          isActive
            ? 'font-medium text-text-primary'
            : 'text-text-secondary-alt hover:text-text-secondary',
        )}
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        className={cn('h-[2px] w-full rounded-[1px]', isActive ? 'bg-brand-purple' : 'bg-transparent')}
      />
    </button>
  );
}

function ModelPanelHeader({
  hasTierFilters,
  activeTier,
  setActiveTier,
}: {
  hasTierFilters: boolean;
  activeTier: TModelTier | null;
  setActiveTier: React.Dispatch<React.SetStateAction<TModelTier | null>>;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const menu = Ariakit.useMenuContext();
  const showMarketplace = useShowMarketplace();
  const { agentsMap } = useModelSelectorContext();
  /* A door into an empty room is not an affordance. With no personas saved,
     the row is not shown at all rather than shown and leading nowhere —
     marketplace being enabled says the feature exists, not that you have any. */
  const hasPersonas = Object.keys(agentsMap ?? {}).length > 0;

  return (
    <>
      <div className="flex h-[34px] shrink-0 items-center px-[10px]">
        <PanelTab
          label={localize('com_ui_all_proper')}
          isActive={activeTier === null}
          onClick={() => setActiveTier(null)}
        />
        {hasTierFilters &&
          tierOptions.map((tier) => (
            <PanelTab
              key={tier.value}
              label={tier.label}
              description={tier.description}
              isActive={activeTier === tier.value}
              onClick={() => setActiveTier(tier.value)}
            />
          ))}
      </div>
      {showMarketplace && hasPersonas && (
        <button
          type="button"
          onClick={() => {
            menu?.hideAll();
            navigate('/agents');
          }}
          data-testid="model-panel-personas"
          className="my-1.5 flex h-9 w-full shrink-0 items-center justify-between pl-[15px] pr-[21px] text-[13px] leading-[19.5px] text-text-primary transition-colors hover:bg-surface-hover"
        >
          <span>{localize('com_ui_personas')}</span>
          <ChevronRight size={14} className="shrink-0 text-text-secondary" aria-hidden="true" />
        </button>
      )}
    </>
  );
}

function ModelSelectorContent({ variant = 'default' }: { variant?: 'default' | 'pill' }) {
  const localize = useLocalize();
  const isCompactTrigger = useMediaQuery('(max-width: 900px)');
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const showMarketplace = useShowMarketplace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isPill = variant === 'pill';
  const queryClient = useQueryClient();

  // Model availability can change while a session is open (an org admin
  // disabling a model — BAC-192). The queries cache with staleTime Infinity,
  // so opening the picker is the moment to re-sync: invalidate marks them
  // stale and active observers refetch in the background, while the cached
  // list still renders instantly (no flicker, no spinner). Scoped to native
  // org workspaces — a personal workspace's payload can't change per-open,
  // so refetching there would be pure request noise.
  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    try {
      const raw = window.localStorage.getItem('activeNashOrgId');
      if (typeof raw !== 'string' || !raw.includes('norg_')) {
        return;
      }
    } catch {
      return;
    }
    queryClient.invalidateQueries([QueryKeys.models]);
    queryClient.invalidateQueries([QueryKeys.endpoints]);
  }, [mobileOpen, queryClient]);

  const {
    // LibreChat
    agentsMap,
    modelSpecs,
    mappedEndpoints,
    filteredMappedEndpoints,
    endpointsConfig,
    // State
    searchValue,
    searchResults,
    selectedValues,
    activeTier,
    // Functions
    setSearchValue,
    setSelectedValues,
    setActiveTier,
    // Dialog
    keyDialogOpen,
    onOpenChange,
    keyDialogEndpoint,
  } = useModelSelectorContext();
  const hasTierFilters = useMemo(
    () => mappedEndpoints.some((endpoint) => endpoint.models?.some((model) => (model.tiers?.length ?? 0) > 0)),
    [mappedEndpoints],
  );

  const selectedIcon = useMemo(
    () =>
      getSelectedIcon({
        mappedEndpoints: mappedEndpoints ?? [],
        selectedValues,
        modelSpecs,
        endpointsConfig,
      }),
    [mappedEndpoints, selectedValues, modelSpecs, endpointsConfig],
  );
  const selectedDisplayValue = useMemo(
    () =>
      getDisplayValue({
        localize,
        agentsMap,
        modelSpecs,
        selectedValues,
        mappedEndpoints,
      }),
    [localize, agentsMap, modelSpecs, selectedValues, mappedEndpoints],
  );
  const triggerLabel =
    isPill || !isCompactTrigger ? selectedDisplayValue : localize('com_ui_model');

  const trigger = (
    <TooltipAnchor
      aria-label={localize('com_ui_select_model')}
      description={localize('com_ui_select_model')}
      render={
        <button
          type="button"
          data-testid="model-selector-trigger"
          onClick={(e) => {
            // The composer card focuses its textarea on any click inside it, and
            // this trigger lives in that card — letting the click bubble would
            // pull the caret out of the panel's search field the moment it opens.
            e.stopPropagation();
            setMobileOpen(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
          className={cn(
            'flex items-center',
            isPill
              ? 'max-w-[10rem] flex-shrink-0 gap-[12px] bg-transparent sm:max-w-[14rem] text-[13px] leading-[19.5px] text-text-secondary-alt transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-text-secondary md:min-w-0'
              : 'my-1 h-10 w-auto min-w-[112px] max-w-[160px] justify-center gap-2 rounded-xl border border-border-light bg-presentation px-3 py-2 text-sm text-text-primary hover:bg-surface-active-alt sm:max-w-[70vw] md:w-full md:max-w-[70vw]',
          )}
          aria-label={localize('com_ui_select_model')}
        >
          {!isPill && selectedIcon && React.isValidElement(selectedIcon) && (
            <div className="flex flex-shrink-0 items-center justify-center overflow-hidden">
              {selectedIcon}
            </div>
          )}
          <span className={cn('truncate', isPill ? 'text-left' : 'flex-grow text-left')}>
            {triggerLabel}
          </span>
          <ChevronDown
            className={cn(
              'flex-shrink-0',
              isPill ? 'h-[14px] w-[14px] text-text-secondary' : 'h-4 w-4 text-text-secondary',
            )}
            aria-hidden="true"
          />
        </button>
      }
    />
  );

  return (
    <div
      className={cn(
        'relative flex items-center gap-2',
        isPill ? 'w-auto' : 'w-auto max-w-md flex-col md:w-full',
      )}
    >
      {trigger}
      {isSmallScreen ? (
        <MobileModelSelector open={mobileOpen} onClose={() => setMobileOpen(false)} />
      ) : (
        <DesktopModelModal open={mobileOpen} onClose={() => setMobileOpen(false)} />
      )}
        <DialogManager
          keyDialogOpen={keyDialogOpen}
          onOpenChange={onOpenChange}
          endpointsConfig={endpointsConfig || {}}
          keyDialogEndpoint={keyDialogEndpoint || undefined}
        />
      </div>
    );
}

export default function ModelSelector({ startupConfig, variant = 'default' }: ModelSelectorProps) {
  const interfaceConfig = startupConfig?.interface ?? getConfigDefaults().interface;
  const modelSpecs = startupConfig?.modelSpecs?.list ?? [];

  // Hide the selector when modelSelect is false and there are no model specs to show
  if (interfaceConfig.modelSelect === false && modelSpecs.length === 0) {
    return null;
  }

  return (
    <ModelSelectorChatProvider>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <ModelSelectorContent variant={variant} />
      </ModelSelectorProvider>
    </ModelSelectorChatProvider>
  );
}
