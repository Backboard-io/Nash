import { useState, useRef } from 'react';
import { MCPIcon } from '@librechat/client';
import { PermissionBits, hasPermissions } from 'librechat-data-provider';
import type { MCPServerStatusIconProps } from '~/components/MCP/MCPServerStatusIcon';
import type { MCPServerDefinition } from '~/hooks';
import MCPServerDialog from './MCPServerDialog';
import { getStatusDotColor } from './MCPStatusBadge';
import MCPCardActions from './MCPCardActions';
import { useMCPServerManager, useLocalize } from '~/hooks';
import { useDeleteMCPServerMutation } from '~/data-provider';
import { cn } from '~/utils';

interface MCPServerCardProps {
  server: MCPServerDefinition;
  getServerStatusIconProps: (serverName: string) => MCPServerStatusIconProps;
  canCreateEditMCPs: boolean;
  /** Grid stacks the parts; list lays the same ones out on a row. */
  view?: 'grid' | 'list';
}

/**
 * Compact card component for displaying an MCP server with status and actions.
 *
 * Visual design:
 * - Status shown via colored dot on icon (no separate badge - avoids redundancy)
 * - Action buttons clearly indicate available operations
 * - Consistent with MCPServerMenuItem in chat dropdown
 */
export default function MCPServerCard({
  server,
  getServerStatusIconProps,
  canCreateEditMCPs,
  view = 'list',
}: MCPServerCardProps) {
  const isList = view === 'list';
  const localize = useLocalize();
  const triggerRef = useRef<HTMLDivElement | HTMLButtonElement | null>(null);
  const { initializeServer, revokeOAuthForServer } = useMCPServerManager();
  const deleteMutation = useDeleteMCPServerMutation();
  const [dialogOpen, setDialogOpen] = useState(false);

  const statusIconProps = getServerStatusIconProps(server.serverName);
  const {
    serverStatus,
    onConfigClick,
    isInitializing,
    canCancel,
    onCancel,
    hasCustomUserVars = false,
  } = statusIconProps;

  const canEditThisServer = hasPermissions(server.effectivePermissions, PermissionBits.EDIT);
  const displayName = server.config?.title || server.serverName;
  const description = server.config?.description;
  const statusDotColor = getStatusDotColor(serverStatus, isInitializing);
  const canEdit = canCreateEditMCPs && canEditThisServer;

  const handleInitialize = () => {
    /** If server has custom user vars and is not already connected, show config dialog first
     *  This ensures users can enter credentials before initialization attempts
     */
    if (hasCustomUserVars && serverStatus?.connectionState !== 'connected') {
      onConfigClick({ stopPropagation: () => {}, preventDefault: () => {} } as React.MouseEvent);
      return;
    }
    initializeServer(server.serverName);
  };

  const handleRevoke = () => {
    revokeOAuthForServer(server.serverName);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDialogOpen(true);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    deleteMutation.mutate(server.serverName);
  };

  // Determine status text for accessibility
  const getStatusText = () => {
    if (isInitializing) return localize('com_nav_mcp_status_initializing');
    if (!serverStatus) return localize('com_nav_mcp_status_unknown');
    const { connectionState, requiresOAuth } = serverStatus;
    if (connectionState === 'connected') return localize('com_nav_mcp_status_connected');
    if (connectionState === 'connecting') return localize('com_nav_mcp_status_connecting');
    if (connectionState === 'error') return localize('com_nav_mcp_status_error');
    if (connectionState === 'disconnected') {
      return requiresOAuth
        ? localize('com_nav_mcp_status_needs_auth')
        : localize('com_nav_mcp_status_disconnected');
    }
    return localize('com_nav_mcp_status_unknown');
  };

  return (
    <>
      <div
        className={cn(
          /* The app's one card geometry — radius 13, padding 16, one 12px gap
             on --surface — the same as a persona, a bookmark folder and a
             memory. This was a bordered transparent strip at radius 8, which
             read as a table row on a page of cards. */
          'group relative overflow-visible nash-card rounded-[13px] p-4',
          'transition-colors hover:bg-surface-hover',
          isList ? 'flex flex-row items-center gap-3' : 'flex h-full flex-col gap-3',
        )}
        aria-label={`${displayName} - ${getStatusText()}`}
      >
        {/* Icon + name + description, one block. In list view the description
            used to be a separate flex-1 column after a fixed 220px header,
            which pushed it to the far right and left a canyon between a
            server's name and what it does — while the Workspace rows two
            sections below stacked the same two lines together. One layout. */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative flex-shrink-0">
            {server.config?.iconPath ? (
              <img
                src={server.config.iconPath}
                className="size-[26px] rounded-[8px] object-cover"
                alt=""
                aria-hidden="true"
              />
            ) : (
              /* The 26px tile every card puts its glyph in. */
              <div className="grid size-[26px] place-items-center rounded-[8px] bg-surface-hover text-text-secondary group-hover:bg-surface-active">
                <MCPIcon className="size-[15px]" aria-hidden="true" />
              </div>
            )}
            {/* Status dot - color indicates connection state */}
            <div
              className={cn(
                'absolute -bottom-0.5 -right-0.5 size-[9px] rounded-full',
                'border-2 border-surface-secondary group-hover:border-surface-hover',
                statusDotColor,
                (isInitializing || serverStatus?.connectionState === 'connecting') &&
                  'animate-pulse',
              )}
              aria-hidden="true"
            />
          </div>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-medium leading-[21px] text-text-primary">
              {displayName}
            </span>
            {description && (
              <span
                className={cn(
                  'text-[12.5px] leading-[18px] text-text-secondary-alt',
                  isList ? 'truncate' : 'line-clamp-2',
                )}
              >
                {description}
              </span>
            )}
          </span>
        </div>

        {/* Actions */}
        <div className={cn('flex-shrink-0', isList && 'ml-auto')}>
          <MCPCardActions
            serverName={server.serverName}
            serverStatus={serverStatus}
            isInitializing={isInitializing}
            canCancel={canCancel}
            hasCustomUserVars={hasCustomUserVars}
            canEdit={canEdit}
            editButtonRef={triggerRef}
            onEditClick={handleEditClick}
            onConfigClick={onConfigClick}
            onInitialize={handleInitialize}
            onCancel={onCancel}
            onRevoke={handleRevoke}
            onDelete={handleDelete}
          />
        </div>
      </div>

      {/* Edit Dialog - separate from card */}
      {canEdit && (
        <MCPServerDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          triggerRef={triggerRef}
          server={server}
        />
      )}
    </>
  );
}
