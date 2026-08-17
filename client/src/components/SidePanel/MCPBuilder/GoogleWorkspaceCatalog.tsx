import { useCallback, useState } from 'react';
import { Mail, HardDrive, Calendar, MessageSquare, Users, Check, Cloud } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import { useMCPCatalogQuery } from '~/data-provider/MCP/queries';
import { useAddMCPCatalogServerMutation } from '~/data-provider/MCP/mutations';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const ICONS: Record<string, LucideIcon> = {
  'google-gmail': Mail,
  'google-drive': HardDrive,
  'google-calendar': Calendar,
  'google-chat': MessageSquare,
  'google-people': Users,
};

type InitializeResult = { oauthRequired?: boolean; oauthUrl?: string; success?: boolean } | undefined;

export interface GoogleWorkspaceCatalogProps {
  /** From the parent's single useMCPServerManager instance — sharing one
   *  instance keeps polling/cancel state consistent across the panel. */
  initializeServer: (serverName: string, autoOpenOAuth?: boolean) => Promise<InitializeResult>;
  isInitializing: (serverName: string) => boolean;
  connectionStatus?: Record<string, { connectionState?: string } | undefined>;
}

/**
 * One-click "Connect Google Workspace" catalog. Renders nothing unless the
 * server has the Google OAuth client configured (the catalog query returns []).
 *
 * Popup handling: the OAuth window is opened *synchronously* inside the click
 * handler (browsers block window.open called after an await), then navigated to
 * the real URL once add/initialize resolve. initializeServer is called with
 * autoOpenOAuth=false so it only starts status polling and doesn't try to open
 * its own (blocked) window.
 */
export default function GoogleWorkspaceCatalog({
  initializeServer,
  isInitializing,
  connectionStatus,
}: GoogleWorkspaceCatalogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data } = useMCPCatalogQuery();
  const addMutation = useAddMCPCatalogServerMutation();
  const [pendingServer, setPendingServer] = useState<string | null>(null);

  const handleConnect = useCallback(
    async (serverName: string) => {
      if (pendingServer) {
        return; // guard against double-submit while a connect is in flight
      }
      setPendingServer(serverName);
      // Open inside the user gesture so it isn't popup-blocked; navigate later.
      const popup = window.open('about:blank', `mcp_oauth_${serverName}`, 'popup,width=520,height=680');
      try {
        await addMutation.mutateAsync(serverName);
        const res = await initializeServer(serverName, false);
        if (res?.oauthRequired && res?.oauthUrl) {
          if (popup && !popup.closed) {
            popup.location.href = res.oauthUrl;
          } else {
            window.open(res.oauthUrl, '_blank', 'noopener,noreferrer');
          }
        } else {
          popup?.close(); // already connected / nothing to authorize
        }
      } catch {
        popup?.close();
        showToast({
          message: localize('com_ui_mcp_connect_error', { 0: serverName }),
          status: 'error',
        });
      } finally {
        setPendingServer(null);
      }
    },
    [pendingServer, addMutation, initializeServer, showToast, localize],
  );

  const catalog = data?.catalog ?? [];
  if (catalog.length === 0) {
    return null;
  }

  return (
    <div role="region" aria-label={localize('com_ui_mcp_google_workspace')}>
      {/* The page's section heading, same as the servers list below — 11px
          uppercase in --t3. §7 also rules out an icon beside a heading. */}
      <h2 className="mb-2 flex h-8 items-center px-[2px] text-[11px] font-medium uppercase leading-[16.5px] tracking-[0.06em] text-text-secondary">
        {localize('com_ui_mcp_google_workspace')}
      </h2>
      <div className="flex flex-col gap-2">
        {catalog.map((entry) => {
          const Icon = ICONS[entry.serverName] ?? Cloud;
          const connected = connectionStatus?.[entry.serverName]?.connectionState === 'connected';
          const busy = pendingServer === entry.serverName || isInitializing(entry.serverName);
          return (
            <div
              key={entry.serverName}
              /* The one card geometry: radius 13, 16 of padding, --surface. */
              className="flex items-center gap-3 nash-card rounded-[13px] p-4"
            >
              <div className="grid size-[26px] shrink-0 place-items-center rounded-[8px] bg-surface-hover text-text-secondary">
                <Icon className="size-[15px]" aria-hidden={true} />
              </div>
              {/* Same two lines, same sizes as an MCP server row above. */}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-medium leading-[21px] text-text-primary">
                  {entry.title}
                </span>
                <span className="truncate text-[12.5px] leading-[18px] text-text-secondary-alt">
                  {entry.description}
                </span>
              </div>
              {connected ? (
                <span className="inline-flex shrink-0 items-center gap-[5px] text-[12.5px] font-medium text-text-success">
                  <Check className="size-[15px]" aria-hidden={true} />
                  {localize('com_ui_mcp_connected')}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleConnect(entry.serverName)}
                  /* §4 `.ghost.outlined`, at the compact height a row action
                     takes — the same button "Fix" is beside it. */
                  className={cn(
                    'inline-flex h-[30px] shrink-0 items-center gap-[6px] rounded-[8px] border-0 bg-transparent px-[14px] text-[12.5px] font-medium text-text-primary ring-1 ring-inset ring-border-light transition-colors hover:bg-surface-active focus:outline-none',
                    busy && 'pointer-events-none',
                  )}
                  aria-label={localize('com_ui_mcp_connect_server', { 0: entry.title })}
                  aria-busy={busy}
                >
                  {busy ? (
                    <Spinner className="size-4" />
                  ) : (
                    localize(entry.alreadyAdded ? 'com_ui_mcp_reconnect' : 'com_ui_mcp_connect')
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
