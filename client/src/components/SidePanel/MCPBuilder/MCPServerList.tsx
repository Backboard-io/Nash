import { MCPIcon } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { MCPServerStatusIconProps } from '~/components/MCP/MCPServerStatusIcon';
import type { MCPServerDefinition } from '~/hooks';
import { useLocalize, useHasAccess } from '~/hooks';
import EmptyState from '~/components/ui/EmptyState';
import { bookmarkListClass, type BookmarkView } from '~/components/SidePanel/Bookmarks/BookmarkControls';
import MCPServerCard from './MCPServerCard';

interface MCPServerListProps {
  servers: MCPServerDefinition[];
  getServerStatusIconProps: (serverName: string) => MCPServerStatusIconProps;
  isFiltered?: boolean;
  /** Rows or cards — the same pair every other page offers. */
  view?: BookmarkView;
}

/**
 * Renders a list of MCP server cards with empty state handling
 */
export default function MCPServerList({
  servers,
  getServerStatusIconProps,
  isFiltered = false,
  view = 'list',
}: MCPServerListProps) {
  const localize = useLocalize();
  const canCreateEditMCPs = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.CREATE,
  });

  if (servers.length === 0) {
    /* A third size of the same thing — 40px circle, 20px glyph — where
       Bookmarks used 48/20 and Memories 56/24. The shared one settles it. */
    return (
      <EmptyState
        icon={<MCPIcon className="size-6" aria-hidden="true" />}
        title={
          isFiltered
            ? localize('com_ui_no_mcp_servers_match')
            : localize('com_ui_no_mcp_servers')
        }
        description={isFiltered ? undefined : localize('com_ui_add_first_mcp_server')}
      />
    );
  }

  return (
    /* The shared list/grid class, so MCP lays out exactly as personas and
       bookmarks do at every breakpoint. */
    <div className={bookmarkListClass(view)} role="list" aria-label={localize('com_ui_mcp_servers')}>
      {servers.map((server) => (
        <div key={`card_${server.serverName}`} role="listitem">
          <MCPServerCard
            server={server}
            view={view}
            getServerStatusIconProps={getServerStatusIconProps}
            canCreateEditMCPs={canCreateEditMCPs}
          />
        </div>
      ))}
    </div>
  );
}
