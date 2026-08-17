import { useResetRecoilState, useSetRecoilState } from 'recoil';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';
import useClearStates from '~/hooks/Config/useClearStates';
import { clearAllConversationStorage } from '~/utils';
import store from '~/store';

/* login/logout */
export const useLogoutUserMutation = (
  options?: t.LogoutOptions,
): UseMutationResult<t.TLogoutResponse, unknown, undefined, unknown> => {
  const queryClient = useQueryClient();
  const clearStates = useClearStates();
  const resetDefaultPreset = useResetRecoilState(store.defaultPreset);
  const setQueriesEnabled = useSetRecoilState<boolean>(store.queriesEnabled);

  return useMutation([MutationKeys.logoutUser], {
    mutationFn: () => dataService.logout(),
    ...(options || {}),
    onSuccess: (...args) => {
      setQueriesEnabled(false);
      resetDefaultPreset();
      clearStates();
      queryClient.removeQueries();
      options?.onSuccess?.(...args);
    },
  });
};

export const useApiKeyLoginMutation = (
  options?: t.MutationOptions<t.TLoginResponse, { apiKey: string }, unknown, unknown>,
): UseMutationResult<t.TLoginResponse, unknown, { apiKey: string }, unknown> => {
  const queryClient = useQueryClient();
  const clearStates = useClearStates();
  const resetDefaultPreset = useResetRecoilState(store.defaultPreset);
  const setQueriesEnabled = useSetRecoilState<boolean>(store.queriesEnabled);
  return useMutation(['apiKeyLogin'], {
    mutationFn: (payload: { apiKey: string }) => dataService.apiKeyLogin(payload),
    ...(options || {}),
    onMutate: (vars) => {
      resetDefaultPreset();
      clearStates();
      queryClient.removeQueries();
      options?.onMutate?.(vars);
    },
    onSuccess: (...args) => {
      setQueriesEnabled(true);
      options?.onSuccess?.(...args);
    },
  });
};

/* User */
export const useDeleteUserMutation = (
  options?: t.MutationOptions<unknown, undefined>,
): UseMutationResult<unknown, unknown, undefined, unknown> => {
  const queryClient = useQueryClient();
  const clearStates = useClearStates();
  const resetDefaultPreset = useResetRecoilState(store.defaultPreset);

  return useMutation([MutationKeys.deleteUser], {
    mutationFn: () => dataService.deleteUser(),
    ...(options || {}),
    onSuccess: (...args) => {
      resetDefaultPreset();
      clearStates();
      clearAllConversationStorage();
      queryClient.removeQueries();
      options?.onSuccess?.(...args);
    },
  });
};
