import { useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useRecoilState } from 'recoil';
import { EModelEndpoint, getConfigDefaults, getEndpointField } from 'librechat-data-provider';
import { useUserKeyQuery } from 'librechat-data-provider/react-query';
import { useMediaQuery } from '@librechat/client';
import type { TEndpointsConfig } from 'librechat-data-provider';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import useSideNavLinks from '~/hooks/Nav/useSideNavLinks';
import { useSidePanelContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

const defaultInterface = getConfigDefaults().interface;

/**
 * Left slide-out that hosts the controls (agent builder, memories, files, prompts,
 * bookmarks) previously docked in the right side panel. It reuses the exact same
 * panel components via {@link useSideNavLinks}; the only thing that changed is the
 * side it opens from and that it is driven by the global `openControlPanel` atom
 * instead of the right panel's local active-panel state. Mounted inside
 * `SidePanelGroup` so it inherits the same chat/side-panel context the components need.
 */
export default function LeftControlPanel() {
  const localize = useLocalize();
  const [openPanel, setOpenPanel] = useRecoilState(store.openControlPanel);
  const { endpoint } = useSidePanelContext();
  const isSmallScreen = useMediaQuery('(max-width: 767px)');

  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();
  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );

  const { data: keyExpiry = { expiresAt: undefined } } = useUserKeyQuery(endpoint ?? '');
  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, endpoint, 'type'),
    [endpoint, endpointsConfig],
  );
  const userProvidesKey = useMemo(
    () => !!(endpointsConfig?.[endpoint ?? '']?.userProvide ?? false),
    [endpointsConfig, endpoint],
  );
  const keyProvided = useMemo(
    () => (userProvidesKey ? !!(keyExpiry.expiresAt ?? '') : true),
    [keyExpiry.expiresAt, userProvidesKey],
  );

  const close = useCallback(() => setOpenPanel(null), [setOpenPanel]);

  const links = useSideNavLinks({
    endpoint,
    hidePanel: close,
    keyProvided,
    endpointType,
    interfaceConfig,
    endpointsConfig,
  });

  const active = useMemo(
    () => links.find((link) => link.id === openPanel && link.Component != null),
    [links, openPanel],
  );
  const isOpen = openPanel != null && active != null;
  const width = isSmallScreen ? '100%' : 'min(420px, 90vw)';

  // Custom modal, not Headless UI Dialog: its focus-trap closes the form's body-portaled Ariakit dropdowns the instant they open.
  const isAgentBuilder = openPanel === EModelEndpoint.agents;

  useEffect(() => {
    if (!isAgentBuilder || !isOpen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Ariakit preventDefaults Escape to close an open dropdown; only close the
      // modal when nothing else consumed the key.
      if (e.key === 'Escape' && !e.defaultPrevented) {
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isAgentBuilder, isOpen, close]);

  if (isAgentBuilder) {
    if (!isOpen) {
      return null;
    }
    // No stopPropagation wrapper: the form's body-portaled Ariakit dropdowns rely on
    // document-level pointer handling that a stopPropagation ancestor disrupts, which
    // makes every dropdown in the builder appear dead. Outside-click-to-close is a
    // sibling backdrop button instead; the centering layer is pointer-events-none so
    // clicks land on the backdrop, while the dialog re-enables pointer events.
    return createPortal(
      <div className="fixed inset-0 z-[100]">
        <button
          type="button"
          aria-label={localize('com_ui_close')}
          onClick={close}
          className="absolute inset-0 bg-black/50 transition-opacity dark:bg-black/70"
        />
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={localize('com_sidepanel_agent_builder')}
            className="pointer-events-auto relative my-8 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-light bg-surface-primary shadow-2xl"
          >
            <button
              type="button"
              aria-label={localize('com_ui_close')}
              onClick={close}
              className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
              {active?.Component && <active.Component />}
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={localize('com_ui_close')}
        onClick={close}
        className={cn(
          'absolute inset-0 z-40 bg-black/30 transition-opacity duration-200',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        tabIndex={isOpen ? 0 : -1}
      />
      <aside
        aria-hidden={!isOpen}
        className={cn(
          'absolute left-0 top-0 z-50 flex h-full flex-col border-r border-border-light bg-surface-primary-alt shadow-xl transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ width }}
      >
        {active != null && (
          <>
            <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
              <h2 className="text-sm font-semibold text-text-primary">
                {localize(active.title)}
              </h2>
              <button
                type="button"
                aria-label={localize('com_ui_close')}
                onClick={close}
                className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {active.Component && <active.Component />}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
