import { useMemo } from 'react';
import { VisuallyHidden } from '@ariakit/react';
import { Spinner, TooltipAnchor } from '@librechat/client';
import { CheckCircle2, Lock, MousePointerClick, SettingsIcon } from 'lucide-react';
import { EModelEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type { TModelSpec } from 'librechat-data-provider';
import type { Endpoint } from '~/common';
import { CustomMenu as Menu, CustomMenuItem as MenuItem } from '../CustomMenu';
import { useModelSelectorContext } from '../ModelSelectorContext';
import { renderEndpointModels } from './EndpointModelItem';
import { ModelSpecItem } from './ModelSpecItem';
import { filterModels } from '../utils';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface EndpointItemProps {
  endpoint: Endpoint;
  endpointIndex: number;
}

const SettingsButton = ({
  endpoint,
  className,
  handleOpenKeyDialog,
}: {
  endpoint: Endpoint;
  className?: string;
  handleOpenKeyDialog: (endpoint: EModelEndpoint, e: React.MouseEvent) => void;
}) => {
  const localize = useLocalize();
  const text = localize('com_endpoint_config_key');

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!endpoint.value) {
      return;
    }
    e.stopPropagation();
    handleOpenKeyDialog(endpoint.value as EModelEndpoint, e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (endpoint.value) {
        handleOpenKeyDialog(endpoint.value as EModelEndpoint, e as unknown as React.MouseEvent);
      }
    }
  };

  return (
    <button
      type="button"
      id={`endpoint-${endpoint.value}-settings`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group/button flex items-center gap-1.5 rounded-lg px-1.5',
        'text-text-secondary transition-colors duration-hover',
        'hover:bg-surface-tertiary hover:text-text-primary',
        'focus-visible:bg-surface-tertiary focus-visible:text-text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        className,
      )}
      aria-label={`${text} ${endpoint.label}`}
    >
      <SettingsIcon className="size-4 shrink-0" aria-hidden="true" />
      <span
        aria-hidden="true"
        className={cn(
          'grid overflow-hidden transition-[grid-template-columns,opacity] duration-hover ease-nash',
          'grid-cols-[0fr] opacity-0',
          'group-hover/button:grid-cols-[1fr] group-hover/button:opacity-100',
          'group-focus-visible/button:grid-cols-[1fr] group-focus-visible/button:opacity-100',
        )}
      >
        <span className="min-w-0 truncate pr-0.5">{text}</span>
      </span>
    </button>
  );
};

/**
 * Lazily-rendered content for an endpoint submenu. By extracting this into a
 * separate component, the expensive model-list rendering (and per-item hooks
 * such as MutationObservers in EndpointModelItem) only runs when the submenu
 * is actually mounted — which Ariakit defers via `unmountOnHide`.
 */
function EndpointMenuContent({
  endpoint,
  endpointIndex,
}: {
  endpoint: Endpoint;
  endpointIndex: number;
}) {
  const localize = useLocalize();
  const { agentsMap, assistantsMap, modelSpecs, selectedValues, endpointSearchValues, activeTier } =
    useModelSelectorContext();
  const { model: selectedModel, modelSpec: selectedSpec } = selectedValues;
  const searchValue = endpointSearchValues[endpoint.value] || '';

  const endpointSpecs = useMemo(() => {
    if (!modelSpecs || !modelSpecs.length) {
      return [];
    }
    return modelSpecs.filter((spec: TModelSpec) => spec.group === endpoint.value);
  }, [modelSpecs, endpoint.value]);

  if (isAssistantsEndpoint(endpoint.value) && endpoint.models === undefined) {
    return (
      <div
        className="flex items-center justify-center p-2"
        role="status"
        aria-label={localize('com_ui_loading')}
      >
        <Spinner aria-hidden="true" />
      </div>
    );
  }

  const filteredModels = searchValue
    ? filterModels(
        endpoint,
        (endpoint.models || []).map((model) => model.name),
        searchValue,
        agentsMap,
        assistantsMap,
      )
    : null;

  return (
    <>
      {!activeTier &&
        endpointSpecs.map((spec: TModelSpec) => (
          <ModelSpecItem key={spec.name} spec={spec} isSelected={selectedSpec === spec.name} />
        ))}
      {filteredModels
        ? renderEndpointModels(
            endpoint,
            endpoint.models || [],
            selectedModel,
            filteredModels,
            endpointIndex,
          )
        : endpoint.models &&
          renderEndpointModels(endpoint, endpoint.models, selectedModel, undefined, endpointIndex)}
    </>
  );
}

export function EndpointItem({ endpoint, endpointIndex }: EndpointItemProps) {
  const localize = useLocalize();
  const {
    selectedValues,
    handleOpenKeyDialog,
    handleSelectEndpoint,
    endpointSearchValues,
    setEndpointSearchValue,
    endpointRequiresUserKey,
  } = useModelSelectorContext();
  const { endpoint: selectedEndpoint } = selectedValues;

  const searchValue = endpointSearchValues[endpoint.value] || '';
  const isUserProvided = useMemo(
    () => endpointRequiresUserKey(endpoint.value),
    [endpointRequiresUserKey, endpoint.value],
  );

  const isAssistantsNotLoaded =
    isAssistantsEndpoint(endpoint.value) && endpoint.models === undefined;

  const isAllPremium = useMemo(() => {
    if (!endpoint.models?.length) {
      return false;
    }
    return endpoint.models.every((m) => m.isPremium);
  }, [endpoint.models]);

  const renderIconLabel = () => (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cn('truncate text-left text-text-primary', isAllPremium && 'opacity-50')}
      >
        {endpoint.label}
      </span>
      {isAllPremium && <Lock className="size-3 shrink-0 text-text-secondary opacity-60" aria-hidden="true" />}
    </div>
  );

  const isEndpointSelected = selectedEndpoint === endpoint.value;

  if (endpoint.hasModels) {
    const placeholder = localize('com_endpoint_search_var', { 0: endpoint.label });
    return (
      <Menu
        id={`endpoint-${endpoint.value}-menu`}
        key={`endpoint-${endpoint.value}-item`}
        searchValue={searchValue}
        onSearch={(value) => setEndpointSearchValue(endpoint.value, value)}
        combobox={<input placeholder={placeholder} />}
        comboboxLabel={placeholder}
        onClick={() => handleSelectEndpoint(endpoint)}
        label={
          <div className="group flex h-9 w-full min-w-0 items-center justify-between gap-1.5 text-[13px] leading-[19.5px]">
            {renderIconLabel()}
            <div className="flex shrink-0 items-center gap-1">
              {isUserProvided && (
                <SettingsButton endpoint={endpoint} handleOpenKeyDialog={handleOpenKeyDialog} />
              )}
              {isEndpointSelected && (
                <>
                  <CheckCircle2 className="size-3.5 shrink-0 text-text-primary" aria-hidden="true" />
                  <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
                </>
              )}
            </div>
          </div>
        }
      >
        <EndpointMenuContent endpoint={endpoint} endpointIndex={endpointIndex} />
      </Menu>
    );
  } else {
    return (
      <MenuItem
        id={`endpoint-${endpoint.value}-menu`}
        key={`endpoint-${endpoint.value}-item`}
        onClick={() => handleSelectEndpoint(endpoint)}
        aria-selected={isEndpointSelected || undefined}
        className="group flex h-9 w-full cursor-pointer items-center justify-between gap-1.5 text-[13px] leading-[19.5px]"
      >
        {renderIconLabel()}
        <div className="flex shrink-0 items-center gap-2">
          {endpointRequiresUserKey(endpoint.value) && (
            <SettingsButton endpoint={endpoint} handleOpenKeyDialog={handleOpenKeyDialog} />
          )}
          {isAssistantsNotLoaded && (
            <TooltipAnchor
              description={localize('com_ui_click_to_view_var', { 0: endpoint.label })}
              side="top"
              render={
                <span className="flex items-center">
                  <MousePointerClick className="size-4 text-text-secondary" aria-hidden="true" />
                </span>
              }
            />
          )}
          {isEndpointSelected && !isAssistantsNotLoaded && (
            <>
              <CheckCircle2 className="size-3.5 shrink-0 text-text-primary" aria-hidden="true" />
              <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
            </>
          )}
        </div>
      </MenuItem>
    );
  }
}

export function renderEndpoints(mappedEndpoints: Endpoint[]) {
  return mappedEndpoints.map((endpoint, index) => (
    <EndpointItem
      endpoint={endpoint}
      endpointIndex={index}
      key={`endpoint-${endpoint.value}-${index}`}
    />
  ));
}
