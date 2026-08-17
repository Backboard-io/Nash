import { useId, useMemo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { ChevronDown } from 'lucide-react';
import { DropdownPopup } from '@librechat/client';
import { isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import type { SetterOrUpdater } from 'recoil';
import type { MenuItemProps } from '~/common';
import { useGetEndpointsQuery, useGetStartupConfig, useListAgentsQuery } from '~/data-provider';
import { useAgentDefaultPermissionLevel } from '~/hooks/Agents';
import { useEndpoints } from '~/hooks/Endpoint/useEndpoints';
import { EndpointIcon } from '~/components/Endpoints';
import { useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import { formatModelName } from '~/utils';
import { useAuthContext } from '~/hooks/AuthContext';

export default function AddedConvo({
  addedConvo,
  setAddedConvo,
}: {
  addedConvo: TConversation | null;
  setAddedConvo: SetterOrUpdater<TConversation | null>;
}) {
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const { isAuthenticated } = useAuthContext();
  const agentsMap = useAgentsMapContext();
  const assistantsMap = useAssistantsMapContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const permissionLevel = useAgentDefaultPermissionLevel();
  const { data: agents = null } = useListAgentsQuery(
    { requiredPermission: permissionLevel },
    { enabled: isAuthenticated, select: (data) => data?.data },
  );
  const { mappedEndpoints } = useEndpoints({
    agents,
    assistantsMap,
    startupConfig,
    endpointsConfig: endpointsConfig ?? {},
  });

  const title = useMemo(() => {
    // Priority: agent name > modelDisplayLabel > modelLabel > model
    if (isAgentsEndpoint(addedConvo?.endpoint) && addedConvo?.agent_id) {
      const agent = agentsMap?.[addedConvo.agent_id];
      if (agent?.name) {
        return `+ ${agent.name}`;
      }
    }

    const endpointConfig = endpointsConfig?.[addedConvo?.endpoint ?? ''];
    const displayLabel =
      endpointConfig?.modelDisplayLabel ||
      addedConvo?.modelLabel ||
      formatModelName(addedConvo?.model) ||
      'AI';

    return `+ ${displayLabel}`;
  }, [addedConvo, agentsMap, endpointsConfig]);

  const selectModel = (endpointValue: string, modelName: string) => {
    const base: Partial<TConversation> = {
      endpoint: endpointValue as TConversation['endpoint'],
      // Clear cross-endpoint fields so switching (e.g. agent -> plain model)
      // never leaves a stale agent_id/assistant_id/spec behind.
      agent_id: undefined,
      assistant_id: undefined,
      spec: undefined,
      modelLabel: undefined,
    };
    if (isAgentsEndpoint(endpointValue)) {
      base.agent_id = modelName;
      base.model = agentsMap?.[modelName]?.model ?? '';
    } else if (isAssistantsEndpoint(endpointValue)) {
      base.assistant_id = modelName;
      base.model = assistantsMap?.[endpointValue]?.[modelName]?.model ?? '';
    } else {
      base.model = modelName;
    }
    setAddedConvo((prev) => (prev ? { ...prev, ...base } : prev));
  };

  const dropdownItems = useMemo<MenuItemProps[]>(() => {
    return mappedEndpoints
      .filter((endpoint) => endpoint.hasModels)
      .map((endpoint) => {
        const models = endpoint.models ?? [];
        const displayName = (modelName: string) => {
          if (isAgentsEndpoint(endpoint.value)) {
            return endpoint.agentNames?.[modelName] ?? modelName;
          }
          if (isAssistantsEndpoint(endpoint.value)) {
            return endpoint.assistantNames?.[modelName] ?? modelName;
          }
          return formatModelName(modelName);
        };
        return {
          label: endpoint.label,
          icon: endpoint.icon,
          subItems: models.map((m) => ({
            label: displayName(m.name),
            onClick: () => {
              selectModel(endpoint.value as string, m.name);
              // Picking a model only auto-hides the nested submenu (its own
              // Ariakit store); the root provider list is controlled by our
              // isOpen, so close it explicitly or it lingers until an outside
              // click.
              setIsOpen(false);
            },
          })),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedEndpoints, agentsMap, assistantsMap]);

  if (!addedConvo) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 py-2.5 pl-3 pr-1.5 text-sm">
      <DropdownPopup
        portal={true}
        menuId={menuId}
        focusLoop={true}
        className="z-[125]"
        unmountOnHide={true}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        trigger={
          // Must be an Ariakit.MenuButton, not a plain <button> —
          // DropdownPopup renders the trigger as-is inside its MenuProvider
          // and does NOT wire up click handling for arbitrary elements (see
          // packages/client/src/components/DropdownPopup.tsx and the same
          // pattern in ChatMenu.tsx). Spans the whole pill row (icon +
          // label + chevron) so clicking anywhere on it opens the picker;
          // only the X button stays separate.
          <Ariakit.MenuButton
            className="flex min-w-0 flex-1 items-center gap-4 rounded-lg py-0.5 text-left hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Change model for the added response"
          >
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
              <span className="icon-md">
                <EndpointIcon
                  conversation={addedConvo}
                  endpointsConfig={endpointsConfig}
                  containerClassName="shadow-stroke overflow-hidden rounded-full"
                  context="menu-item"
                  size={20}
                />
              </span>
            </span>
            <span className="text-token-text-secondary line-clamp-3 min-w-0 flex-1 font-semibold">
              {title}
            </span>
            <ChevronDown
              className="mr-1 size-4 flex-shrink-0 text-text-secondary opacity-75"
              aria-hidden="true"
            />
          </Ariakit.MenuButton>
        }
        items={dropdownItems}
      />
      <button
        className="text-token-text-secondary flex-shrink-0"
        type="button"
        aria-label="Close added conversation"
        onClick={() => setAddedConvo(null)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          fill="none"
          viewBox="0 0 24 24"
          className="icon-lg"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M7.293 7.293a1 1 0 0 1 1.414 0L12 10.586l3.293-3.293a1 1 0 1 1 1.414 1.414L13.414 12l3.293 3.293a1 1 0 0 1-1.414 1.414L12 13.414l-3.293 3.293a1 1 0 0 1-1.414-1.414L10.586 12 7.293 8.707a1 1 0 0 1 0-1.414"
            clipRule="evenodd"
          ></path>
        </svg>
      </button>
    </div>
  );
}
