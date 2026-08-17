import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useDrag, useDrop } from 'react-dnd';
import { Skeleton } from '@librechat/client';
import { useQueries } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type t from 'librechat-data-provider';
import { useFavorites, useNewConvo } from '~/hooks';
import { useAssistantsMapContext, useAgentsMapContext } from '~/Providers';
import type { AgentQueryResult } from '~/common';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { useGetEndpointsQuery } from '~/data-provider';
import FavoriteItem from './FavoriteItem';
import store from '~/store';

const FavoriteItemSkeleton = () => (
  <div className="flex h-[34px] w-full items-center rounded-[8px] px-[9px]">
    <Skeleton className="mr-[11px] h-4 w-4 rounded-full" />
    <Skeleton className="h-4 w-24" />
  </div>
);

interface DraggableFavoriteItemProps {
  id: string;
  index: number;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
  onDrop: () => void;
  children: React.ReactNode;
}

const DraggableFavoriteItem = ({
  id,
  index,
  moveItem,
  onDrop,
  children,
}: DraggableFavoriteItemProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [{ handlerId }, drop] = useDrop<{ index: number; id: string }, unknown, { handlerId: any }>(
    {
      accept: 'favorite-item',
      collect(monitor) {
        return {
          handlerId: monitor.getHandlerId(),
        };
      },
      hover(item, monitor) {
        if (!ref.current) {
          return;
        }
        const dragIndex = item.index;
        const hoverIndex = index;

        if (dragIndex === hoverIndex) {
          return;
        }

        const hoverBoundingRect = ref.current?.getBoundingClientRect();
        const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) {
          return;
        }
        const hoverClientY = clientOffset.y - hoverBoundingRect.top;

        if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
          return;
        }

        if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
          return;
        }

        moveItem(dragIndex, hoverIndex);
        item.index = hoverIndex;
      },
    },
  );

  const [{ isDragging }, drag] = useDrag({
    type: 'favorite-item',
    item: () => {
      return { id, index };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: () => {
      onDrop();
    },
  });

  const opacity = isDragging ? 0 : 1;
  drag(drop(ref));

  return (
    <div ref={ref} style={{ opacity }} data-handler-id={handlerId}>
      {children}
    </div>
  );
};

export default function FavoritesList({
  onHeightChange,
}: {
  /** Callback when the list height might have changed (e.g., agents finished loading) */
  onHeightChange?: () => void;
}) {
  const search = useRecoilValue(store.search);
  const { favorites, reorderFavorites, isLoading: isFavoritesLoading } = useFavorites();

  const { newConversation } = useNewConvo();
  const assistantsMap = useAssistantsMapContext();
  const agentsMap = useAgentsMapContext();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const { data: endpointsConfig = {} as t.TEndpointsConfig } = useGetEndpointsQuery();

  const { onSelectEndpoint } = useSelectMention({
    modelSpecs: [],
    conversation,
    assistantsMap,
    endpointsConfig,
    newConversation,
    returnHandlers: true,
  });

  const listContainerRef = useRef<HTMLDivElement>(null);

  const handleRemoveFocus = useCallback(() => {
    const nextFavorite = listContainerRef.current?.querySelector<HTMLElement>(
      '[data-testid="favorite-item"]',
    );
    if (nextFavorite) {
      nextFavorite.focus();
      return;
    }
    const newChatButton = document.querySelector<HTMLElement>(
      '[data-testid="nav-new-chat-button"]',
    );
    newChatButton?.focus();
  }, []);

  const safeFavorites = useMemo(() => (Array.isArray(favorites) ? favorites : []), [favorites]);

  const allAgentIds = useMemo(
    () => safeFavorites.map((f) => f.agentId).filter(Boolean) as string[],
    [safeFavorites],
  );

  const missingAgentIds = useMemo(() => {
    if (agentsMap === undefined) {
      return [];
    }
    return allAgentIds.filter((id) => !agentsMap[id]);
  }, [allAgentIds, agentsMap]);

  const missingAgentQueries = useQueries({
    queries: missingAgentIds.map((agentId) => ({
      queryKey: [QueryKeys.agent, agentId],
      queryFn: async (): Promise<AgentQueryResult> => {
        try {
          const agent = await dataService.getAgentById({ agent_id: agentId });
          return { found: true, agent };
        } catch (error) {
          if (error && typeof error === 'object' && 'response' in error) {
            const axiosError = error as { response?: { status?: number } };
            if (axiosError.response?.status === 404) {
              return { found: false };
            }
          }
          throw error;
        }
      },
      staleTime: 1000 * 60 * 5,
      enabled: missingAgentIds.length > 0,
    })),
  });

  const combinedAgentsMap = useMemo(() => {
    if (agentsMap === undefined) {
      return undefined;
    }
    const combined: Record<string, t.Agent> = {};
    for (const [key, value] of Object.entries(agentsMap)) {
      if (value) {
        combined[key] = value;
      }
    }
    missingAgentQueries.forEach((query) => {
      if (query.data?.found) {
        combined[query.data.agent.id] = query.data.agent;
      }
    });
    return combined;
  }, [agentsMap, missingAgentQueries]);

  const isAgentsLoading =
    (allAgentIds.length > 0 && agentsMap === undefined) ||
    (missingAgentIds.length > 0 && missingAgentQueries.some((q) => q.isLoading));

  useEffect(() => {
    if (!isAgentsLoading && onHeightChange) {
      onHeightChange();
    }
  }, [isAgentsLoading, onHeightChange]);

  const draggedFavoritesRef = useRef(safeFavorites);

  const moveItem = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      const newFavorites = [...draggedFavoritesRef.current];
      const [draggedItem] = newFavorites.splice(dragIndex, 1);
      newFavorites.splice(hoverIndex, 0, draggedItem);
      draggedFavoritesRef.current = newFavorites;
      reorderFavorites(newFavorites, false);
    },
    [reorderFavorites],
  );

  const handleDrop = useCallback(() => {
    // Persist the final order using the ref which has the latest state
    reorderFavorites(draggedFavoritesRef.current, true);
  }, [reorderFavorites]);

  // Keep ref in sync when favorites change from external sources
  useEffect(() => {
    draggedFavoritesRef.current = safeFavorites;
  }, [safeFavorites]);

  if (search.query) {
    return null;
  }

  if (!isFavoritesLoading && safeFavorites.length === 0) {
    return null;
  }

  if (isFavoritesLoading) {
    return (
      <div className="flex flex-col">
        <div className="flex flex-col gap-[2px]">
          <FavoriteItemSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div ref={listContainerRef} className="flex flex-col gap-[2px]">
        {/* Show skeletons for ALL items while agents are still loading */}
        {isAgentsLoading ? (
          <>
            {/* Favorite items skeletons */}
            {safeFavorites.map((_, index) => (
              <FavoriteItemSkeleton key={`skeleton-${index}`} />
            ))}
          </>
        ) : (
          <>
            {safeFavorites.map((fav, index) => {
              if (fav.agentId) {
                const agent = combinedAgentsMap?.[fav.agentId];
                if (!agent) {
                  return null;
                }
                return (
                  <DraggableFavoriteItem
                    key={fav.agentId}
                    id={fav.agentId}
                    index={index}
                    moveItem={moveItem}
                    onDrop={handleDrop}
                  >
                    <FavoriteItem
                      item={agent}
                      type="agent"
                      onSelectEndpoint={onSelectEndpoint}
                      onRemoveFocus={handleRemoveFocus}
                    />
                  </DraggableFavoriteItem>
                );
              } else if (fav.model && fav.endpoint) {
                return (
                  <DraggableFavoriteItem
                    key={`${fav.endpoint}-${fav.model}`}
                    id={`${fav.endpoint}-${fav.model}`}
                    index={index}
                    moveItem={moveItem}
                    onDrop={handleDrop}
                  >
                    <FavoriteItem
                      item={{ model: fav.model, endpoint: fav.endpoint }}
                      type="model"
                      onSelectEndpoint={onSelectEndpoint}
                      onRemoveFocus={handleRemoveFocus}
                    />
                  </DraggableFavoriteItem>
                );
              }
              return null;
            })}
          </>
        )}
      </div>
    </div>
  );
}
