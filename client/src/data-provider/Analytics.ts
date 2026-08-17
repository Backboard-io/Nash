import { useRecoilValue } from 'recoil';
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';
import store from '~/store';

export const useGetAnalyticsQuery = (
  config?: UseQueryOptions<t.AnalyticsResponse>,
): QueryObserverResult<t.AnalyticsResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.AnalyticsResponse>(
    [QueryKeys.analytics],
    () => dataService.getAnalytics(),
    {
      refetchOnMount: 'always',
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};
