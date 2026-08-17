import React, { memo, useMemo, useCallback, useRef, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Check } from 'lucide-react';
import { ServerIcon } from '~/components/svg/NashComposerIcons';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { TooltipAnchor, useMediaQuery } from '@librechat/client';
import NashBottomSheet from '~/components/ui/NashBottomSheet';
import type { MCPServerDefinition } from '~/hooks/MCP/useMCPServerManager';
import type { MCPServerStatusIconProps } from '~/components/MCP/MCPServerStatusIcon';
import MCPServerStatusIcon from '~/components/MCP/MCPServerStatusIcon';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import {
  getStatusColor,
  getStatusTextKey,
  shouldShowActionButton,
  type ConnectionStatusMap,
} from '~/components/MCP/mcpServerUtils';
import { useBadgeRowContext } from '~/Providers';
import { useHasAccess, useLocalize } from '~/hooks';
import { cn } from '~/utils';

export const mcpMenuClasses = cn(
  'z-50 flex w-[280px] flex-col rounded-[14px] border border-border-light',
  'bg-surface-secondary py-2 pl-2 pr-4 shadow-[0_8px_24px_rgba(0,0,0,0.4)]',
);

export const mcpListScrollbarClasses =
  '[&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[2px] [&::-webkit-scrollbar-thumb]:bg-black/15 dark:[&::-webkit-scrollbar-thumb]:bg-white/15';

/** Figma "Dark MCP Open": panel bottom sits 30px above the composer's top edge. */
const MCP_COMPOSER_GAP = 30;

/**
 * Anchor the panel to the COMPOSER's top edge rather than to the trigger.
 *
 * The trigger lives in the composer's bottom tool row, so anchoring to it
 * (Ariakit's default) opens the panel *inside* the composer and paints over the
 * input. We keep the trigger's horizontal position but take the vertical edge
 * from `--nash-composer-top` (published by ChatForm), so the panel clears the
 * composer entirely. Returns null when the var is absent, which falls back to
 * Ariakit's normal trigger anchoring.
 */
function getComposerAnchorRect(anchor: HTMLElement | null) {
  if (!anchor) {
    return null;
  }
  const rect = anchor.getBoundingClientRect();
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--nash-composer-top');
  const fromBottom = parseFloat(raw);
  if (!Number.isFinite(fromBottom) || fromBottom <= 0) {
    return null;
  }
  return {
    x: rect.x,
    y: window.innerHeight - fromBottom,
    width: rect.width,
    height: 0,
  };
}

interface MCPServerRowProps {
  server: MCPServerDefinition;
  isSelected: boolean;
  connectionStatus?: ConnectionStatusMap;
  isInitializing?: (serverName: string) => boolean;
  statusIconProps?: MCPServerStatusIconProps | null;
  onToggle: (serverName: string) => void;
}

export function MCPServerRow({
  server,
  isSelected,
  connectionStatus,
  isInitializing,
  statusIconProps,
  onToggle,
}: MCPServerRowProps) {
  const localize = useLocalize();
  const displayName = server.config?.title || server.serverName;
  const statusColor = getStatusColor(server.serverName, connectionStatus, isInitializing);
  const statusTextKey = getStatusTextKey(server.serverName, connectionStatus, isInitializing);
  const statusText = localize(statusTextKey as Parameters<typeof localize>[0]);
  const showActionButton = shouldShowActionButton(statusIconProps);

  // Include status in aria-label so screen readers announce it
  const accessibleLabel = `${displayName}, ${statusText}`;

  return (
    <Ariakit.MenuItemCheckbox
      hideOnClick={false}
      name="mcp-servers"
      value={server.serverName}
      checked={isSelected}
      onChange={() => onToggle(server.serverName)}
      aria-label={accessibleLabel}
      className={cn(
        'group flex h-12 w-full shrink-0 cursor-pointer items-center gap-2 rounded-[10px] px-[10px]',
        'outline-none transition-colors duration-150',
        'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
        isSelected && 'bg-surface-hover',
      )}
    >
      {/* Server icon with connection-status dot */}
      <div className="relative flex-shrink-0">
        {server.config?.iconPath ? (
          <img
            src={server.config.iconPath}
            className="h-4 w-4 rounded object-cover"
            alt={displayName}
          />
        ) : (
          <ServerIcon size={16} />
        )}
        {/* Status dot - decorative, status is announced via aria-label on MenuItem */}
        <div
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-surface-secondary',
            statusColor,
          )}
        />
      </div>

      {/* Server Info */}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[12.5px] font-medium leading-[18.75px] text-text-primary">
          {displayName}
        </span>
        {server.config?.description && (
          <span className="truncate text-[11px] leading-[16.5px] text-text-secondary-alt">
            {server.config.description}
          </span>
        )}
      </div>

      {/* Action Button - only show when actionable */}
      {showActionButton && statusIconProps && (
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <MCPServerStatusIcon {...statusIconProps} />
        </div>
      )}

      {/* Selection Indicator - purely visual, state conveyed by aria-checked on MenuItem */}
      <span
        aria-hidden="true"
        className={cn(
          'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px]',
          isSelected
            ? 'bg-surface-submit text-white'
            : 'border border-border-light bg-transparent',
        )}
      >
        {isSelected && <Check size={13} aria-hidden="true" />}
      </span>
    </Ariakit.MenuItemCheckbox>
  );
}

function MobileMCPServerRow({
  server,
  isSelected,
  connectionStatus,
  isInitializing,
  statusIconProps,
  onToggle,
}: MCPServerRowProps) {
  const localize = useLocalize();
  const displayName = server.config?.title || server.serverName;
  const statusColor = getStatusColor(server.serverName, connectionStatus, isInitializing);
  const statusTextKey = getStatusTextKey(server.serverName, connectionStatus, isInitializing);
  const statusText = localize(statusTextKey as Parameters<typeof localize>[0]);
  const showActionButton = shouldShowActionButton(statusIconProps);

  // Include status in aria-label so screen readers announce it
  const accessibleLabel = `${displayName}, ${statusText}`;

  const handleToggle = () => onToggle(server.serverName);

  return (
    <div
      role="checkbox"
      tabIndex={0}
      aria-checked={isSelected}
      aria-label={accessibleLabel}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggle();
        }
      }}
      className={cn(
        'group flex h-[72px] w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-[10px] px-3',
        'outline-none transition-colors duration-150',
        isSelected && 'bg-surface-hover',
      )}
    >
      {/* Server icon with connection-status dot */}
      <div className="relative flex-shrink-0">
        {server.config?.iconPath ? (
          <img
            src={server.config.iconPath}
            className="h-[18px] w-[18px] rounded object-cover"
            alt={displayName}
          />
        ) : (
          <ServerIcon size={18} />
        )}
        {/* Status dot - decorative, status is announced via aria-label on the row */}
        <div
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-surface-primary-alt',
            statusColor,
          )}
        />
      </div>

      {/* Server Info */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium leading-[21px] text-text-primary">
          {displayName}
        </span>
        {server.config?.description && (
          <span className="truncate text-[12px] leading-[18px] text-text-secondary-alt">
            {server.config.description}
          </span>
        )}
      </div>

      {/* Action Button - only show when actionable */}
      {showActionButton && statusIconProps && (
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <MCPServerStatusIcon {...statusIconProps} />
        </div>
      )}

      {/* Selection Indicator - purely visual, state conveyed by aria-checked on the row */}
      <span
        aria-hidden="true"
        className={cn(
          'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px]',
          isSelected
            ? 'bg-surface-submit text-white'
            : 'border border-border-light bg-transparent',
        )}
      >
        {isSelected && <Check size={13} aria-hidden="true" />}
      </span>
    </div>
  );
}

export function MobileMCPSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { conversationId, storageContextKey, mcpServerManager } = useBadgeRowContext();
  const {
    localize,
    mcpValues,
    selectableServers,
    connectionStatus,
    isInitializing,
    getConfigDialogProps,
    toggleServerSelection,
    getServerStatusIconProps,
  } = mcpServerManager;

  const configDialogProps = getConfigDialogProps();

  return (
    <>
      <NashBottomSheet
        open={open}
        onClose={onClose}
        title={localize('com_ui_mcp_servers')}
        ariaLabel={localize('com_ui_mcp_servers')}
      >
        <div className="flex flex-col gap-y-0.5 pb-4 pl-4 pr-6 pt-2">
          {selectableServers.length === 0 && (
            <div className="flex h-[72px] shrink-0 items-center rounded-[10px] px-3 text-[12.5px] leading-[18.75px] text-text-secondary-alt">
              {localize('com_ui_mcp_no_servers')}
            </div>
          )}
          {selectableServers.map((server) => (
            <MobileMCPServerRow
              key={server.serverName}
              server={server}
              isSelected={mcpValues?.includes(server.serverName) ?? false}
              connectionStatus={connectionStatus}
              isInitializing={isInitializing}
              statusIconProps={getServerStatusIconProps(server.serverName)}
              onToggle={toggleServerSelection}
            />
          ))}
        </div>
      </NashBottomSheet>
      {configDialogProps && (
        <MCPConfigDialog
          {...configDialogProps}
          conversationId={conversationId}
          storageContextKey={storageContextKey}
        />
      )}
    </>
  );
}

function MCPSelectContent() {
  const { conversationId, storageContextKey, mcpServerManager } = useBadgeRowContext();
  const {
    localize,
    isPinned,
    mcpValues,
    placeholderText,
    selectableServers,
    connectionStatus,
    isInitializing,
    getConfigDialogProps,
    toggleServerSelection,
    getServerStatusIconProps,
  } = mcpServerManager;

  const menuStore = Ariakit.useMenuStore({ focusLoop: true, placement: 'top-start' });
  const isOpen = menuStore.useState('open');
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const [sheetOpen, setSheetOpen] = useState(false);

  const connectedSelected = (mcpValues ?? []).filter((name) => {
    if (!selectableServers.some((server) => server.serverName === name)) {
      return false;
    }
    return connectionStatus?.[name]?.connectionState === 'connected';
  });
  const selectedCount = connectedSelected.length;

  // Wrap toggleServerSelection to preserve focus after state update
  const handleToggle = useCallback(
    (serverName: string) => {
      // Save currently focused element
      focusedElementRef.current = document.activeElement as HTMLElement;
      toggleServerSelection(serverName);
      // Restore focus after React re-renders
      requestAnimationFrame(() => {
        focusedElementRef.current?.focus();
      });
    },
    [toggleServerSelection],
  );

  const displayText = useMemo(() => {
    if (selectedCount === 0) {
      return null;
    }
    if (selectedCount === 1) {
      const server = selectableServers.find((s) => s.serverName === connectedSelected[0]);
      return server?.config?.title || connectedSelected[0];
    }
    return localize('com_ui_x_selected', { 0: selectedCount });
  }, [selectedCount, selectableServers, connectedSelected, localize]);

  // Nash renders this control directly in the composer drawer (it does not mount
  // LibreChat's BadgeRow/ToolsDropdown), so it doubles as the server *picker*:
  // stay visible whenever the user has at least one MCP server configured, not
  // only once one is already selected.

  const configDialogProps = getConfigDialogProps();

  if (isSmallScreen) {
    return (
      <>
        <TooltipAnchor
          description={displayText || placeholderText}
          disabled={sheetOpen}
          render={
            <button
              type="button"
              aria-label={displayText || placeholderText}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
              className={cn(
                'relative inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full',
                'bg-surface-active text-text-secondary transition-colors hover:bg-surface-hover',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                sheetOpen && 'bg-surface-hover',
              )}
            />
          }
        >
          <ServerIcon size={17} />
          {selectedCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-brand-purple px-[3px] text-[9px] font-medium leading-none text-white"
            >
              {selectedCount}
            </span>
          )}
        </TooltipAnchor>
        <MobileMCPSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      </>
    );
  }

  return (
    <>
      <Ariakit.MenuProvider store={menuStore}>
        <TooltipAnchor
          description={displayText || placeholderText}
          disabled={isOpen}
          render={
            <Ariakit.MenuButton
              aria-label={displayText || placeholderText}
              className={cn(
                'relative inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full',
                'bg-surface-active text-text-secondary transition-colors hover:bg-surface-hover',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isOpen && 'bg-surface-hover',
              )}
            />
          }
        >
          <ServerIcon size={17} />
          {selectedCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-brand-purple px-[3px] text-[9px] font-medium leading-none text-white"
            >
              {selectedCount}
            </span>
          )}
        </TooltipAnchor>

        <Ariakit.Menu
          portal={true}
          gutter={MCP_COMPOSER_GAP}
          getAnchorRect={getComposerAnchorRect}
          aria-label={localize('com_ui_mcp_servers')}
          className={cn(
            mcpMenuClasses,
            'origin-bottom opacity-0 transition-[opacity,transform] duration-200 ease-out',
            'data-[enter]:scale-100 data-[enter]:opacity-100',
            'scale-95 data-[leave]:scale-95 data-[leave]:opacity-0',
          )}
        >
          <div
            className={cn(
              'flex max-h-[320px] flex-col gap-1 overflow-y-auto overscroll-contain',
              mcpListScrollbarClasses,
            )}
          >
            {selectableServers.length === 0 && (
              <div className="flex h-12 items-center rounded-[10px] px-[10px] text-[12.5px] leading-[18.75px] text-text-secondary-alt">
                {localize('com_ui_mcp_no_servers')}
              </div>
            )}
            {selectableServers.map((server) => (
              <MCPServerRow
                key={server.serverName}
                server={server}
                isSelected={mcpValues?.includes(server.serverName) ?? false}
                connectionStatus={connectionStatus}
                isInitializing={isInitializing}
                statusIconProps={getServerStatusIconProps(server.serverName)}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </Ariakit.Menu>
      </Ariakit.MenuProvider>
      {configDialogProps && (
        <MCPConfigDialog
          {...configDialogProps}
          conversationId={conversationId}
          storageContextKey={storageContextKey}
        />
      )}
    </>
  );
}

function MCPSelect() {
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });

  if (!canUseMcp) {
    return null;
  }

  return <MCPSelectContent />;
}

export default memo(MCPSelect);
