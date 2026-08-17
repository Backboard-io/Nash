import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  UseQueryOptions,
  UseMutationOptions,
  QueryObserverResult,
} from '@tanstack/react-query';
import type {
  TSavedMessage,
  TSaveMessageRequest,
  TSavedMessageFolder,
  TSavedMessagesResponse,
  TSavedMessageFolderRequest,
  TSavedMessageFoldersResponse,
  TUpdateSavedMessageRequest,
  TDeleteSavedFolderResponse,
} from 'librechat-data-provider';

/** Both lists move together: a save changes a folder's count and `lastSavedAt`. */
const invalidateSaved = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.savedMessages]);
  queryClient.invalidateQueries([QueryKeys.savedMessageFolders]);
};

/** Saved responses, newest first. `folderId: 'unsorted'` filters the implicit bucket. */
export const useSavedMessagesQuery = (
  folderId?: string | null,
  config?: UseQueryOptions<TSavedMessagesResponse>,
): QueryObserverResult<TSavedMessagesResponse> => {
  return useQuery<TSavedMessagesResponse>(
    [QueryKeys.savedMessages, folderId ?? 'all'],
    () => dataService.getSavedMessages(folderId),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

/** Folder cards, with a trailing virtual `unsorted` row. */
export const useSavedMessageFoldersQuery = (
  config?: UseQueryOptions<TSavedMessageFoldersResponse>,
): QueryObserverResult<TSavedMessageFoldersResponse> => {
  return useQuery<TSavedMessageFoldersResponse>(
    [QueryKeys.savedMessageFolders],
    () => dataService.getSavedMessageFolders(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

/** Idempotent on `messageId` — re-saving keeps the existing note, folder and `createdAt`. */
export const useSaveMessageMutation = (
  options?: UseMutationOptions<TSavedMessage, Error, TSaveMessageRequest>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TSavedMessage, Error, TSaveMessageRequest>(
    (payload: TSaveMessageRequest) => dataService.saveMessage(payload),
    {
      ...options,
      onSuccess: (...params) => {
        invalidateSaved(queryClient);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useUnsaveMessageMutation = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<{ message: string }, Error, string>(
    (messageId: string) => dataService.deleteSavedMessage(messageId),
    {
      ...options,
      onSuccess: (...params) => {
        invalidateSaved(queryClient);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export type UpdateSavedMessageVariables = {
  messageId: string;
} & TUpdateSavedMessageRequest;

/** Edits the note and/or moves the row between folders (`folderId: null` → Unsorted). */
export const useUpdateSavedMessageMutation = (
  options?: UseMutationOptions<TSavedMessage, Error, UpdateSavedMessageVariables>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TSavedMessage, Error, UpdateSavedMessageVariables>(
    ({ messageId, ...payload }: UpdateSavedMessageVariables) =>
      dataService.updateSavedMessage(messageId, payload),
    {
      ...options,
      onSuccess: (...params) => {
        invalidateSaved(queryClient);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useCreateSavedMessageFolderMutation = (
  options?: UseMutationOptions<TSavedMessageFolder, Error, TSavedMessageFolderRequest>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TSavedMessageFolder, Error, TSavedMessageFolderRequest>(
    (payload: TSavedMessageFolderRequest) => dataService.createSavedMessageFolder(payload),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.savedMessageFolders]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export type UpdateSavedMessageFolderVariables = {
  folderId: string;
} & TSavedMessageFolderRequest;

export const useUpdateSavedMessageFolderMutation = (
  options?: UseMutationOptions<TSavedMessageFolder, Error, UpdateSavedMessageFolderVariables>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TSavedMessageFolder, Error, UpdateSavedMessageFolderVariables>(
    ({ folderId, ...payload }: UpdateSavedMessageFolderVariables) =>
      dataService.updateSavedMessageFolder(folderId, payload),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.savedMessageFolders]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

/** Deleting a folder reparents its members to Unsorted, so the saved list moves too. */
export const useDeleteSavedMessageFolderMutation = (
  options?: UseMutationOptions<TDeleteSavedFolderResponse, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TDeleteSavedFolderResponse, Error, string>(
    (folderId: string) => dataService.deleteSavedMessageFolder(folderId),
    {
      ...options,
      onSuccess: (...params) => {
        invalidateSaved(queryClient);
        options?.onSuccess?.(...params);
      },
    },
  );
};
