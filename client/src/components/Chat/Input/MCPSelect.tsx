import React, { memo, useMemo, useCallback, useRef, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Check } from 'lucide-react';
import { ServerIcon } from '~/components/svg/NashComposerIcons';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useNavigate } from 'react-router-dom';
import { EModelEndpoint } from 'librechat-data-provider';
import { GearIcon, TooltipAnchor, useMediaQuery } from '@librechat/client';
import { Constants } from 'librechat-data-provider';
import SearchField from '~/components/ui/SearchField';
import { useAvailableToolsQuery } from '~/data-provider';
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

/* §7's panel, not a menu: it has a title, a manage action, its own search and a
   scrolling list. --elevated fill, radius 14, no border in dark. */
export const mcpMenuClasses = cn(
  'z-50 flex w-[328px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[14px]',
  'bg-surface-hover shadow-[0_10px_28px_rgba(16,18,24,0.14)] ring-1 ring-inset ring-border-light',
  'dark:shadow-[0_12px_34px_rgba(0,0,0,0.45)] dark:ring-0',
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
  /** How many tools this connector exposes, when the tools query knows. */
  toolCount?: number;
}

/**
 * One connector in the composer panel: icon, name, tool count, switch.
 *
 * It used to carry a checkbox and a status dot on its icon. A switch says "on
 * for this chat" where a tick says "selected", which is the actual question
 * here — and a connector that cannot be turned on now says so in words
 * ("Needs auth") beside the button that fixes it, rather than as a coloured
 * dot the reader has to decode.
 */
export function MCPServerRow({
  server,
  isSelected,
  connectionStatus,
  isInitializing,
  statusIconProps,
  onToggle,
  toolCount,
}: MCPServerRowProps) {
  const localize = useLocalize();
  const displayName = server.config?.title || server.serverName;
  const statusTextKey = getStatusTextKey(server.serverName, connectionStatus, isInitializing);
  const statusText = localize(statusTextKey as Parameters<typeof localize>[0]);
  const showActionButton = shouldShowActionButton(statusIconProps);

  const accessibleLabel = `${displayName}, ${statusText}`;
  const toolsLabel =
    toolCount == null
      ? (server.config?.description ?? '')
      : toolCount === 1
        ? localize('com_ui_connectors_tools_count_one')
        : localize('com_ui_connectors_tools_count', { 0: toolCount });

  return (
    <div
      role="group"
      aria-label={accessibleLabel}
      className="group flex h-[52px] w-full shrink-0 items-center gap-3 rounded-[10px] px-[10px]"
    >
      <span className="flex size-[22px] shrink-0 items-center justify-center text-text-secondary">
        {server.config?.iconPath ? (
          <img
            src={server.config.iconPath}
            className="size-[18px] rounded-[4px] object-cover"
            alt=""
            aria-hidden="true"
          />
        ) : (
          <ServerIcon size={18} />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-[13.5px] font-medium leading-[19px]',
            showActionButton ? 'text-text-tertiary' : 'text-text-primary',
          )}
        >
          {displayName}
        </span>
        <span className="truncate text-[12px] leading-[17px] text-text-tertiary">
          {showActionButton && (
            <>
              <span className="text-text-warning">{localize('com_ui_connectors_needs_auth')}</span>
              {toolsLabel !== '' && <span aria-hidden="true"> · </span>}
            </>
          )}
          {toolsLabel}
        </span>
      </span>

      {showActionButton && statusIconProps ? (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <MCPServerStatusIcon {...statusIconProps} />
        </div>
      ) : (
        <Ariakit.MenuItemCheckbox
          hideOnClick={false}
          name="mcp-servers"
          value={server.serverName}
          checked={isSelected}
          onChange={() => onToggle(server.serverName)}
          aria-label={accessibleLabel}
          /* A switch, not a tick: the question is whether this connector is on
             for this chat, and marking an on-state is exactly what §1 keeps
             accent for. */
          className={cn(
            'relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full',
            'outline-none transition-colors duration-hover',
            'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-heavy',
            isSelected ? 'bg-brand-purple' : 'bg-surface-active',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute size-[16px] rounded-full bg-white transition-transform duration-hover',
              isSelected ? 'translate-x-[19px]' : 'translate-x-[3px]',
            )}
          />
        </Ariakit.MenuItemCheckbox>
      )}
    </div>
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
        'outline-none transition-colors duration-hover',
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
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  /* Tool counts come from the tools the agents endpoint already publishes —
     MCP tools carry `serverName` after `mcp_delimiter` in their key — so the
     row can say "6 tools" without a second request. */
  const { data: tools } = useAvailableToolsQuery(EModelEndpoint.agents);
  const toolCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tool of tools ?? []) {
      const key = tool?.pluginKey ?? '';
      if (!key.includes(Constants.mcp_delimiter)) {
        continue;
      }
      const serverName = key.split(Constants.mcp_delimiter)[1];
      if (serverName) {
        counts[serverName] = (counts[serverName] ?? 0) + 1;
      }
    }
    return counts;
  }, [tools]);

  const visibleServers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return selectableServers;
    }
    return selectableServers.filter((server) =>
      (server.config?.title || server.serverName).toLowerCase().includes(q),
    );
  }, [selectableServers, query]);

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
            'origin-bottom opacity-0 transition-[opacity,transform] duration-hover ease-nash',
            'data-[enter]:scale-100 data-[enter]:opacity-100',
            'scale-95 data-[leave]:scale-95 data-[leave]:opacity-0',
          )}
        >
          {/* Title + Manage, on a hairline. The panel had no header at all, so
              nothing said what the list was scoped to — these are the
              connectors *for this chat*, not the ones you have. */}
          <div className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-[14px]">
            <span className="text-[14px] font-semibold leading-[21px] text-text-primary">
              {localize('com_ui_connectors_in_chat')}
            </span>
            <button
              type="button"
              onClick={() => {
                menuStore.hide();
                navigate('/mcp');
              }}
              className="inline-flex shrink-0 items-center gap-[6px] rounded-[7px] px-[6px] py-[3px] text-[12.5px] leading-[18px] text-text-secondary transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none"
            >
              <GearIcon className="size-[15px]" aria-hidden="true" />
              {localize('com_ui_manage')}
            </button>
          </div>

          <div className="px-3 pt-3">
            <SearchField
              on="overlay"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
              placeholder={localize('com_ui_connectors_search')}
            />
          </div>

          <div
            className={cn(
              'flex max-h-[320px] flex-col gap-1 overflow-y-auto overscroll-contain px-2 py-2',
              mcpListScrollbarClasses,
            )}
          >
            {visibleServers.length === 0 && (
              <div className="flex h-12 items-center rounded-[10px] px-[10px] text-[12.5px] leading-[18.75px] text-text-secondary-alt">
                {localize('com_ui_mcp_no_servers')}
              </div>
            )}
            {visibleServers.map((server) => (
              <MCPServerRow
                key={server.serverName}
                server={server}
                isSelected={mcpValues?.includes(server.serverName) ?? false}
                connectionStatus={connectionStatus}
                isInitializing={isInitializing}
                statusIconProps={getServerStatusIconProps(server.serverName)}
                toolCount={toolCounts[server.serverName]}
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
