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
    <div className="space-y-2" role="region" aria-label={localize('com_ui_mcp_google_workspace')}>
      <div className="flex items-center gap-2 px-1 pt-1">
        <Cloud className="size-4 text-brand-purple" aria-hidden={true} />
        <h3 className="text-sm font-medium text-text-primary">
          {localize('com_ui_mcp_google_workspace')}
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {catalog.map((entry) => {
          const Icon = ICONS[entry.serverName] ?? Cloud;
          const connected = connectionStatus?.[entry.serverName]?.connectionState === 'connected';
          const busy = pendingServer === entry.serverName || isInitializing(entry.serverName);
          return (
            <div
              key={entry.serverName}
              className="flex items-center gap-3 rounded-xl border border-border-light bg-surface-primary p-3"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary">
                <Icon className="size-4 text-text-secondary" aria-hidden={true} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-primary">{entry.title}</div>
                <div className="truncate text-xs text-text-secondary">{entry.description}</div>
              </div>
              {connected ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-purple">
                  <Check className="size-4" aria-hidden={true} />
                  {localize('com_ui_mcp_connected')}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleConnect(entry.serverName)}
                  className={cn('shrink-0', busy && 'pointer-events-none')}
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
