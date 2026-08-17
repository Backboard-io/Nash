import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { VisuallyHidden } from '@ariakit/react';
import { CheckCircle2, EarthIcon, Pin, PinOff } from 'lucide-react';
import { isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import { CustomMenuItem as MenuItem, menuScrollbarClasses } from '../CustomMenu';
import { useModelSelectorContext } from '../ModelSelectorContext';
import { useFavorites, useLocalize } from '~/hooks';
import type { Endpoint } from '~/common';
import { cn, formatModelName } from '~/utils';

const VIRTUALIZATION_THRESHOLD = 50;
const ITEM_HEIGHT = 35;

interface EndpointModelItemProps {
  modelId: string | null;
  endpoint: Endpoint;
  isSelected: boolean;
  isPremium?: boolean;
}

export function EndpointModelItem({ modelId, endpoint, isSelected, isPremium }: EndpointModelItemProps) {
  const localize = useLocalize();
  const { handleSelectModel } = useModelSelectorContext();
  const { isFavoriteModel, toggleFavoriteModel, isFavoriteAgent, toggleFavoriteAgent } =
    useFavorites();

  const itemRef = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const element = itemRef.current;
    if (!element) {
      return;
    }

    const observer = new MutationObserver(() => {
      setIsActive(element.hasAttribute('data-active-item'));
    });

    observer.observe(element, { attributes: true, attributeFilter: ['data-active-item'] });
    setIsActive(element.hasAttribute('data-active-item'));

    return () => observer.disconnect();
  }, []);

  let isGlobal = false;
  /** Display-only name; `modelId` stays the raw value used for selection */
  let modelName = modelId != null ? formatModelName(modelId) : modelId;
  const avatarUrl = endpoint?.modelIcons?.[modelId ?? ''] || null;

  // Use custom names if available
  if (endpoint && modelId && isAgentsEndpoint(endpoint.value) && endpoint.agentNames?.[modelId]) {
    modelName = endpoint.agentNames[modelId];

    const modelInfo = endpoint?.models?.find((m) => m.name === modelId);
    isGlobal = modelInfo?.isGlobal ?? false;
  } else if (
    endpoint &&
    modelId &&
    isAssistantsEndpoint(endpoint.value) &&
    endpoint.assistantNames?.[modelId]
  ) {
    modelName = endpoint.assistantNames[modelId];
  }

  const isAgent = isAgentsEndpoint(endpoint.value);
  const isFavorite = isAgent
    ? isFavoriteAgent(modelId ?? '')
    : isFavoriteModel(modelId ?? '', endpoint.value);

  const handleFavoriteToggle = () => {
    if (!modelId) {
      return;
    }

    if (isAgent) {
      toggleFavoriteAgent(modelId);
    } else {
      toggleFavoriteModel({ model: modelId, endpoint: endpoint.value });
    }
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleFavoriteToggle();
  };

  const renderAvatar = () => {
    const isAgentOrAssistant =
      isAgentsEndpoint(endpoint.value) || isAssistantsEndpoint(endpoint.value);
    const showEndpointIcon = isAgentOrAssistant && endpoint.icon;

    const getContent = () => {
      if (avatarUrl) {
        return <img src={avatarUrl} alt={modelName ?? ''} className="h-full w-full object-cover" />;
      }
      if (showEndpointIcon) {
        return endpoint.icon;
      }
      return null;
    };

    const content = getContent();
    if (!content) {
      return null;
    }

    return (
      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-full">
        {content}
      </div>
    );
  };

  return (
    <MenuItem
      ref={itemRef}
      onClick={() => handleSelectModel(endpoint, modelId ?? '')}
      aria-selected={isSelected || undefined}
      className="group flex h-[34px] w-full cursor-pointer items-center justify-between gap-1 rounded-[7px] text-[12.5px] leading-[18.75px]"
    >
      <div className="flex w-full min-w-0 items-center gap-2">
        {renderAvatar()}
        <span className="truncate text-text-primary">{modelName}</span>
        {isGlobal && <EarthIcon className="ml-1 size-3.5 text-surface-submit" />}
      </div>
      <button
        tabIndex={isActive ? 0 : -1}
        onClick={handleFavoriteClick}
        aria-label={isFavorite ? localize('com_ui_unpin') : localize('com_ui_pin')}
        className={cn(
          'rounded p-0.5 hover:bg-surface-active',
          isFavorite
            ? 'visible'
            : 'visible md:invisible md:group-hover:visible md:group-data-[active-item]:visible',
        )}
      >
        {isFavorite ? (
          <PinOff size={14} className="text-text-secondary" />
        ) : (
          <Pin size={14} className="text-text-secondary" aria-hidden="true" />
        )}
      </button>
      {isSelected && (
        <>
          <CheckCircle2 className="size-3.5 shrink-0 text-text-primary" aria-hidden="true" />
          <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
        </>
      )}
    </MenuItem>
  );
}

function VirtualizedModelList({
  endpoint,
  modelIds,
  selectedModel,
  indexSuffix,
  premiumSet,
}: {
  endpoint: Endpoint;
  modelIds: string[];
  selectedModel: string | null;
  indexSuffix: string;
  premiumSet: Set<string>;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: modelIds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => ITEM_HEIGHT, []),
    overscan: 15,
  });

  return (
    <div
      ref={parentRef}
      className={cn('max-h-[240px] overflow-y-auto', menuScrollbarClasses)}
      role="presentation"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const modelId = modelIds[virtualItem.index];
          return (
            <div
              key={`${endpoint.value}${indexSuffix}-${modelId}-${virtualItem.index}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <EndpointModelItem
                modelId={modelId}
                endpoint={endpoint}
                isSelected={selectedModel === modelId}
                isPremium={premiumSet.has(modelId)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function renderEndpointModels(
  endpoint: Endpoint | null,
  models: Array<{ name: string; isGlobal?: boolean; isPremium?: boolean; tiers?: string[] }>,
  selectedModel: string | null,
  filteredModels?: string[],
  endpointIndex?: number,
) {
  const modelsToRender = filteredModels || models.map((model) => model.name);
  const indexSuffix = endpointIndex != null ? `-${endpointIndex}` : '';

  if (!endpoint) {
    return null;
  }

  const premiumSet = new Set(
    models.filter((m) => m.isPremium).map((m) => m.name),
  );

  if (modelsToRender.length > VIRTUALIZATION_THRESHOLD) {
    return (
      <VirtualizedModelList
        endpoint={endpoint}
        modelIds={modelsToRender}
        selectedModel={selectedModel}
        indexSuffix={indexSuffix}
        premiumSet={premiumSet}
      />
    );
  }

  return modelsToRender.map((modelId, modelIndex) => (
    <EndpointModelItem
      key={`${endpoint.value}${indexSuffix}-${modelId}-${modelIndex}`}
      modelId={modelId}
      endpoint={endpoint}
      isSelected={selectedModel === modelId}
      isPremium={premiumSet.has(modelId)}
    />
  ));
}
