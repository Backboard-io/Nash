import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions } from '@tanstack/react-query';

/**
 * Fetches /api/init and seeds the React Query cache for all individual
 * query keys that would otherwise fire as separate HTTP requests.
 *
 * This turns ~15 parallel requests into a single request on page load.
 */
export const useInitQuery = (
  config?: Omit<UseQueryOptions<Record<string, unknown>>, 'queryKey' | 'queryFn'>,
) => {
  const queryClient = useQueryClient();
  const seeded = useRef(false);

  const query = useQuery<Record<string, unknown>>(
    ['init'],
    () => dataService.getInit(),
    {
      staleTime: 30_000,
      cacheTime: 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: 1,
      ...config,
    },
  );

  useEffect(() => {
    if (!query.data || seeded.current) {
      return;
    }
    seeded.current = true;
    const data = query.data;

    const seeds: Array<[unknown[], unknown]> = [
      [[QueryKeys.balance], data.balance],
      [[QueryKeys.startupConfig], data.startupConfig],
      [[QueryKeys.endpoints], data.endpoints],
      [[QueryKeys.models], data.models],
      [[QueryKeys.presets], data.presets],
      [[QueryKeys.files], data.files],
      [[QueryKeys.fileConfig], data.fileConfig],
      [[QueryKeys.searchEnabled], (data.searchEnabled as Record<string, unknown>)?.enabled ?? true],
      [[QueryKeys.mcpServers], data.mcpServers],
      [[QueryKeys.mcpTools], data.mcpTools],
      [[QueryKeys.agentTools], data.agentTools],
      [[QueryKeys.agentCategories], data.agentCategories],
      [[QueryKeys.activeJobs], data.activeJobs],
      [[QueryKeys.banner], data.banner],
      [[QueryKeys.conversationTags], data.tags],
      [[QueryKeys.allPromptGroups], data.allPrompts],
      [['favorites'], data.favorites],
    ];

    for (const [key, value] of seeds) {
      if (value !== undefined) {
        queryClient.setQueryData(key, value);
      }
    }

    if (data.agents) {
      queryClient.setQueryData(
        [QueryKeys.agents, { limit: 10, requiredPermission: 2 }],
        data.agents,
      );
    }

    if (data.conversations) {
      const convData = data.conversations as Record<string, unknown>;
      queryClient.setQueryData(
        [QueryKeys.allConversations, {
          isArchived: false,
          sortBy: undefined,
          sortDirection: undefined,
          tags: undefined,
          search: undefined,
          folderId: 'none',
        }],
        {
          pages: [{
            conversations: convData.conversations,
            pageSize: convData.pageSize,
            pages: convData.pages,
            pageNumber: convData.pageNumber,
            nextCursor: convData.nextCursor,
          }],
          pageParams: [undefined],
        },
      );
    }

    if (data.promptGroups) {
      queryClient.setQueryData(
        [QueryKeys.promptGroups, undefined, '', '10'],
        {
          pages: [{
            promptGroups: data.promptGroups,
            pageNumber: '1',
            pageSize: 10,
            pages: 1,
            has_more: false,
            after: null,
          }],
          pageParams: [undefined],
        },
      );
    }

    if (data.folders) {
      queryClient.setQueryData([QueryKeys.folders], data.folders);
    }
  }, [query.data, queryClient]);

  return query;
};
