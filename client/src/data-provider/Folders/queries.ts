import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService, apiBaseUrl, request } from 'librechat-data-provider';
import type {
  UseQueryOptions,
  UseMutationOptions,
  QueryObserverResult,
} from '@tanstack/react-query';
import type {
  TFolder,
  FoldersResponse,
  CreateFolderRequest,
} from 'librechat-data-provider';

export const useFoldersQuery = (
  config?: UseQueryOptions<FoldersResponse>,
): QueryObserverResult<FoldersResponse> => {
  return useQuery<FoldersResponse>(
    [QueryKeys.folders],
    () => dataService.listFolders(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

export const useCreateFolderMutation = (
  options?: UseMutationOptions<TFolder, Error, CreateFolderRequest>,
) => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: CreateFolderRequest) => dataService.createFolder(payload),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.folders]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useDeleteFolderMutation = (
  options?: UseMutationOptions<void, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation(
    (folderId: string) => dataService.deleteFolder(folderId),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.folders]);
        queryClient.invalidateQueries([QueryKeys.allConversations]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export type FolderMemory = { key: string; value: string; updated_at: string; tokenCount?: number };
export type FolderMemoriesResponse = { memories: FolderMemory[] };
export type FolderAssistantPromptResponse = {
  folder_context: string;
  system_prompt: string;
};

export const useFolderMemoriesQuery = (
  folderId: string,
  config?: UseQueryOptions<FolderMemoriesResponse>,
): QueryObserverResult<FolderMemoriesResponse> => {
  return useQuery<FolderMemoriesResponse>(
    [QueryKeys.folders, folderId, 'memories'],
    () => request.get(`${apiBaseUrl()}/api/folders/${folderId}/memories`) as Promise<FolderMemoriesResponse>,
    {
      refetchOnWindowFocus: false,
      enabled: !!folderId,
      ...config,
    },
  );
};

export const useFolderAssistantPromptQuery = (
  folderId: string,
  config?: UseQueryOptions<FolderAssistantPromptResponse>,
): QueryObserverResult<FolderAssistantPromptResponse> => {
  return useQuery<FolderAssistantPromptResponse>(
    [QueryKeys.folders, folderId, 'assistant-prompt'],
    () =>
      request.get(
        `${apiBaseUrl()}/api/folders/${folderId}/assistant-prompt`,
      ) as Promise<FolderAssistantPromptResponse>,
    {
      refetchOnWindowFocus: false,
      enabled: !!folderId,
      ...config,
    },
  );
};

export const useDeleteFolderMemoryMutation = (
  folderId: string,
  options?: UseMutationOptions<void, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>(
    (memoryId: string) =>
      request.delete(`${apiBaseUrl()}/api/folders/${folderId}/memories/${memoryId}`) as Promise<void>,
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.folders, folderId, 'memories']);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export type CreateFolderMemoryParams = { key: string; value: string };
export type CreateFolderMemoryResponse = { created: boolean; memory: { key: string; value: string } };

export const useCreateFolderMemoryMutation = (
  folderId: string,
  options?: UseMutationOptions<CreateFolderMemoryResponse, Error, CreateFolderMemoryParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation<CreateFolderMemoryResponse, Error, CreateFolderMemoryParams>(
    ({ key, value }: CreateFolderMemoryParams) =>
      request.post(
        `${apiBaseUrl()}/api/folders/${folderId}/memories`,
        { key, value },
      ) as Promise<CreateFolderMemoryResponse>,
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.folders, folderId, 'memories']);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useUpdateFolderAssistantPromptMutation = (
  folderId: string,
  options?: UseMutationOptions<FolderAssistantPromptResponse, Error, { system_prompt: string }>,
) => {
  const queryClient = useQueryClient();
  return useMutation<FolderAssistantPromptResponse, Error, { system_prompt: string }>(
    ({ system_prompt }: { system_prompt: string }) =>
      request.patch(
        `${apiBaseUrl()}/api/folders/${folderId}/assistant-prompt`,
        { system_prompt },
      ) as Promise<FolderAssistantPromptResponse>,
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.folders, folderId, 'assistant-prompt']);
        queryClient.invalidateQueries([QueryKeys.folders]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export type MoveConvoToFolderParams = {
  conversationId: string;
  folderId: string | null;
};

export const useMoveConvoToFolderMutation = (
  options?: UseMutationOptions<void, Error, MoveConvoToFolderParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ conversationId, folderId }: MoveConvoToFolderParams) =>
      dataService.moveConvoToFolder(conversationId, { folderId }),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.allConversations]);
        queryClient.invalidateQueries([QueryKeys.folders]);
        options?.onSuccess?.(...params);
      },
    },
  );
};
