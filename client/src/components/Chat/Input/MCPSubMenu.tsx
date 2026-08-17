import React from 'react';
import * as Ariakit from '@ariakit/react';
import { ChevronRight } from 'lucide-react';
import { MCPIcon, PinIcon } from '@librechat/client';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import { MCPServerRow, mcpMenuClasses, mcpListScrollbarClasses } from './MCPSelect';
import { useBadgeRowContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MCPSubMenuProps {
  placeholder?: string;
}

const MCPSubMenu = React.forwardRef<HTMLDivElement, MCPSubMenuProps>(
  ({ placeholder, ...props }, ref) => {
    const localize = useLocalize();
    const { storageContextKey, mcpServerManager } = useBadgeRowContext();
    const {
      isPinned,
      mcpValues,
      setIsPinned,
      placeholderText,
      selectableServers,
      connectionStatus,
      isInitializing,
      getConfigDialogProps,
      toggleServerSelection,
      getServerStatusIconProps,
    } = mcpServerManager;

    const menuStore = Ariakit.useMenuStore({
      focusLoop: true,
      showTimeout: 100,
      placement: 'right',
    });

    // Don't render if no MCP servers are configured
    if (!selectableServers || selectableServers.length === 0) {
      return null;
    }

    const configDialogProps = getConfigDialogProps();

    return (
      <div ref={ref}>
        <Ariakit.MenuProvider store={menuStore}>
          <Ariakit.MenuItem
            {...props}
            hideOnClick={false}
            render={
              <Ariakit.MenuButton
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  menuStore.toggle();
                }}
                className="flex h-9 w-full cursor-pointer items-center justify-between rounded-[8px] px-[10px] text-[13px] leading-[19.5px] text-text-primary hover:bg-surface-hover"
              />
            }
          >
            <div className="flex min-w-0 items-center gap-2">
              <MCPIcon className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="truncate">{placeholder || placeholderText}</span>
              <ChevronRight
                size={14}
                className="flex-shrink-0 text-text-secondary"
                aria-hidden="true"
              />
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsPinned(!isPinned);
              }}
              className={cn(
                'rounded p-1 transition-all duration-200',
                'hover:bg-surface-active hover:shadow-sm',
                !isPinned && 'text-text-secondary hover:text-text-primary',
              )}
              aria-label={isPinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
            >
              <div className="h-3.5 w-3.5">
                <PinIcon unpin={isPinned} />
              </div>
            </button>
          </Ariakit.MenuItem>

          <Ariakit.Menu
            portal={true}
            unmountOnHide={true}
            gutter={16}
            aria-label={localize('com_ui_mcp_servers')}
            className={cn('animate-popover-left', mcpMenuClasses, 'z-40')}
          >
            <div
              className={cn(
                'flex max-h-[320px] flex-col gap-1 overflow-y-auto overscroll-contain',
                mcpListScrollbarClasses,
              )}
            >
              {selectableServers.map((server) => (
                <MCPServerRow
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
          </Ariakit.Menu>
        </Ariakit.MenuProvider>
        {configDialogProps && (
          <MCPConfigDialog {...configDialogProps} storageContextKey={storageContextKey} />
        )}
      </div>
    );
  },
);

MCPSubMenu.displayName = 'MCPSubMenu';

export default React.memo(MCPSubMenu);
