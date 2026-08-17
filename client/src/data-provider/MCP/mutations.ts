import { useMutation, useQueryClient, UseMutationResult } from '@tanstack/react-query';
import { dataService, QueryKeys, ResourceType } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';

/**
 * Hook for creating a new MCP server
 */
export const useCreateMCPServerMutation = (options?: {
  onMutate?: (variables: t.MCPServerCreateParams) => void;
  onSuccess?: (
    data: t.MCPServerDBObjectResponse,
    variables: t.MCPServerCreateParams,
    context: unknown,
  ) => void;
  onError?: (error: Error, variables: t.MCPServerCreateParams, context: unknown) => void;
}): UseMutationResult<t.MCPServerDBObjectResponse, Error, t.MCPServerCreateParams> => {
  const queryClient = useQueryClient();

  return useMutation((data: t.MCPServerCreateParams) => dataService.createMCPServer(data), {
    onMutate: (variables) => options?.onMutate?.(variables),
    onError: (error, variables, context) => options?.onError?.(error, variables, context),
    onSuccess: (newServer, variables, context) => {
      const listRes = queryClient.getQueryData<t.MCPServersListResponse>([QueryKeys.mcpServers]);
      if (listRes) {
        queryClient.setQueryData<t.MCPServersListResponse>([QueryKeys.mcpServers], {
          ...listRes,
          [newServer.serverName!]: newServer,
        });
      }

      queryClient.invalidateQueries([QueryKeys.mcpServers]);
      queryClient.invalidateQueries([QueryKeys.mcpTools]);
      queryClient.invalidateQueries([QueryKeys.mcpAuthValues]);
      queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
      queryClient.invalidateQueries([
        QueryKeys.effectivePermissions,
        'all',
        ResourceType.MCPSERVER,
      ]);

      return options?.onSuccess?.(newServer, variables, context);
    },
  });
};

/**
 * Hook for updating an existing MCP server
 */
export const useUpdateMCPServerMutation = (options?: {
  onMutate?: (variables: { serverName: string; data: t.MCPServerUpdateParams }) => void;
  onSuccess?: (
    data: t.MCPServerDBObjectResponse,
    variables: { serverName: string; data: t.MCPServerUpdateParams },
    context: unknown,
  ) => void;
  onError?: (
    error: Error,
    variables: { serverName: string; data: t.MCPServerUpdateParams },
    context: unknown,
  ) => void;
}): UseMutationResult<
  t.MCPServerDBObjectResponse,
  Error,
  { serverName: string; data: t.MCPServerUpdateParams }
> => {
  const queryClient = useQueryClient();

  return useMutation(
    ({ serverName, data }: { serverName: string; data: t.MCPServerUpdateParams }) =>
      dataService.updateMCPServer(serverName, data),
    {
      onMutate: (variables: { serverName: string; data: t.MCPServerUpdateParams }) =>
        options?.onMutate?.(variables),
      onError: (
        error: Error,
        variables: { serverName: string; data: t.MCPServerUpdateParams },
        context: unknown,
      ) => options?.onError?.(error, variables, context),
      onSuccess: (
        updatedServer: t.MCPServerDBObjectResponse,
        variables: { serverName: string; data: t.MCPServerUpdateParams },
        context: unknown,
      ) => {
        // Update list cache
        const listRes = queryClient.getQueryData<t.MCPServersListResponse>([QueryKeys.mcpServers]);
        if (listRes) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { type, ...oldServer } = listRes[variables.serverName!];
          listRes[variables.serverName!] = { ...oldServer, ...updatedServer };

          queryClient.setQueryData<t.MCPServersListResponse>([QueryKeys.mcpServers], {
            ...listRes,
          });
        }

        queryClient.setQueryData([QueryKeys.mcpServer, variables.serverName], updatedServer);
        queryClient.invalidateQueries([QueryKeys.mcpServers]);
        queryClient.invalidateQueries([QueryKeys.mcpTools]);
        queryClient.invalidateQueries([QueryKeys.mcpAuthValues]);
        queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);

        return options?.onSuccess?.(updatedServer, variables, context);
      },
    },
  );
};

/**
 * Hook for deleting an MCP server
 */
export const useDeleteMCPServerMutation = (options?: {
  onMutate?: (variables: string) => void;
  onSuccess?: (_data: { success: boolean }, variables: string, context: unknown) => void;
  onError?: (error: Error, variables: string, context: unknown) => void;
}): UseMutationResult<{ success: boolean }, Error, string> => {
  const queryClient = useQueryClient();

  return useMutation((serverName: string) => dataService.deleteMCPServer(serverName), {
    onMutate: (variables) => options?.onMutate?.(variables),
    onError: (error, variables, context) => options?.onError?.(error, variables, context),
    onSuccess: (_data, serverName, context) => {
      // Update list cache by removing the deleted server (immutable update)
      const listRes = queryClient.getQueryData<t.MCPServersListResponse>([QueryKeys.mcpServers]);
      if (listRes) {
        const { [serverName]: _removed, ...remaining } = listRes;
        queryClient.setQueryData<t.MCPServersListResponse>([QueryKeys.mcpServers], remaining);
      }

      // Remove from specific server query cache
      queryClient.removeQueries([QueryKeys.mcpServer, serverName]);

      // Invalidate list query to ensure consistency
      queryClient.invalidateQueries([QueryKeys.mcpServers]);
      queryClient.invalidateQueries([QueryKeys.mcpTools]);
      queryClient.invalidateQueries([QueryKeys.mcpAuthValues]);
      queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
      // Deleting a catalog server flips it back to "not added" — refresh the catalog.
      queryClient.invalidateQueries(['mcpCatalog']);

      return options?.onSuccess?.(_data, serverName, context);
    },
  });
};

type AddCatalogResponse = {
  success: boolean;
  serverName: string;
  oauthRequired: boolean;
  oauthUrl: string;
};

/**
 * Add a one-click catalog server (Google Workspace). Creates the server row
 * server-side; the returned oauthUrl (if any) starts the OAuth connect, but
 * callers typically hand off to useMCPServerManager.initializeServer for the
 * open+poll loop. Invalidates the servers/catalog caches on success.
 */
export const useAddMCPCatalogServerMutation = (options?: {
  onSuccess?: (data: AddCatalogResponse, serverName: string) => void;
  onError?: (error: Error, serverName: string) => void;
}): UseMutationResult<AddCatalogResponse, Error, string> => {
  const queryClient = useQueryClient();
  return useMutation((serverName: string) => dataService.addMCPCatalogServer(serverName), {
    onSuccess: (data, serverName) => {
      queryClient.invalidateQueries([QueryKeys.mcpServers]);
      queryClient.invalidateQueries(['mcpCatalog']);
      queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
      options?.onSuccess?.(data, serverName);
    },
    onError: (error: Error, serverName) => options?.onError?.(error, serverName),
  });
};
