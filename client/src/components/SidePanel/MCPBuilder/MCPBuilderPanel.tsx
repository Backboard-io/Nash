import { useState, useRef, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { Spinner, OGDialogTrigger } from '@librechat/client';
import { useLocalize, useMCPServerManager, useHasAccess } from '~/hooks';
import SearchField from '~/components/ui/SearchField';
import {
  ViewToggle,
  type BookmarkView,
} from '~/components/SidePanel/Bookmarks/BookmarkControls';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import MCPServerDialog from './MCPServerDialog';
import MCPServerList from './MCPServerList';
import GoogleWorkspaceCatalog from './GoogleWorkspaceCatalog';

export default function MCPBuilderPanel() {
  const localize = useLocalize();
  const {
    availableMCPServers,
    isLoading,
    getServerStatusIconProps,
    getConfigDialogProps,
    initializeServer,
    isInitializing,
    connectionStatus,
  } = useMCPServerManager();

  const hasCreateAccess = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.CREATE,
  });
  const [showDialog, setShowDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  /* List by default: a server row is a name, a status dot and its actions —
     there is no preview to look at, so rows read faster than cards and fit
     more of them on screen. The grid is there for parity with the other
     pages, not as the default. */
  const [view, setView] = useState<BookmarkView>('list');
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const configDialogProps = getConfigDialogProps();

  const filteredServers = useMemo(() => {
    if (!searchQuery.trim()) {
      return availableMCPServers;
    }
    const query = searchQuery.toLowerCase();
    return availableMCPServers.filter((server) => {
      const displayName = server.config?.title || server.serverName;
      return (
        displayName.toLowerCase().includes(query) || server.serverName.toLowerCase().includes(query)
      );
    });
  }, [availableMCPServers, searchQuery]);

  return (
    <div role="region" aria-label={localize('com_ui_mcp_servers')}>
      {/* The page header every management surface uses: 30/600 title over a
          13.5 sub, primary hard right, wrapping on narrow. */}
      <header className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-semibold leading-[38px] tracking-[-0.5px] text-text-primary">
            {localize('com_nav_setting_mcp')}
          </h1>
          <p className="mt-[7px] max-w-2xl text-[13.5px] leading-[20px] text-text-secondary-alt">
            {localize('com_nav_setting_mcp_subtitle')}
          </p>
        </div>
        {hasCreateAccess && (
          <MCPServerDialog open={showDialog} onOpenChange={setShowDialog} triggerRef={addButtonRef}>
            <OGDialogTrigger asChild>
              <button
                ref={addButtonRef}
                type="button"
                onClick={() => setShowDialog(true)}
                /* §4 `.primary.sm`. It was an outlined icon-only "+" tucked
                   beside the filter, which made the page's only creative
                   action the smallest thing on it. */
                aria-label={localize('com_ui_add_mcp')}
                title={localize('com_ui_add_mcp')}
                className="grid size-[39px] shrink-0 place-items-center rounded-[10px] bg-text-primary text-surface-primary transition-opacity hover:opacity-90 focus:outline-none"
              >
                <Plus size={17} aria-hidden="true" />
              </button>
            </OGDialogTrigger>
          </MCPServerDialog>
        )}
      </header>

      <div>
        {/* §6's standard search row, 20 below the header. This was a
            `FilterInput`, a fifth search control with its own geometry. */}
        <div className="flex items-center gap-[10px] pt-[20px]">
          <SearchField
            id="mcp-filter"
            value={searchQuery}
            onChange={setSearchQuery}
            onClear={() => setSearchQuery('')}
            placeholder={localize('com_ui_filter_mcp_servers')}
          />
          <ViewToggle view={view} onChange={setView} />
        </div>

        {/* Server Cards List — the content gap every page uses, under the
            same 11px uppercase section heading the marketplace and Bookmarks
            put over theirs, counted. */}
        <div className="pt-[22px]">
          {!isLoading && (
            <h2 className="mb-2 flex h-8 items-center gap-[7px] px-[2px] text-[11px] font-medium uppercase leading-[16.5px] tracking-[0.06em] text-text-secondary">
              {localize('com_ui_mcp_servers')}
              {filteredServers.length > 0 && (
                <>
                  <span className="text-text-tertiary">·</span>
                  <span className="text-text-tertiary">{filteredServers.length}</span>
                </>
              )}
            </h2>
          )}
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Spinner className="size-6" aria-label={localize('com_ui_loading')} />
          </div>
        ) : (
          <MCPServerList
            servers={filteredServers}
            view={view}
            getServerStatusIconProps={getServerStatusIconProps}
            isFiltered={searchQuery.trim().length > 0}
          />
        )}
        </div>

        {/* One-click providers (Google Workspace) — renders only when configured.
            Gated on CREATE like the manual "+" Add button (connecting creates a
            server row). Uses the panel's single manager instance so polling and
            cancel state stay consistent. */}
        {hasCreateAccess && (
          <div className="pt-[22px]">
          <GoogleWorkspaceCatalog
            initializeServer={initializeServer}
            isInitializing={isInitializing}
            connectionStatus={connectionStatus}
          />
          </div>
        )}

        {/* Config Dialog for custom user vars */}
        {configDialogProps && <MCPConfigDialog {...configDialogProps} />}
      </div>
    </div>
  );
}
