import { EarthIcon, Trash2 } from 'lucide-react';
import { ControlCombobox } from '@librechat/client';
import { useCallback, useEffect, useRef } from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { AgentCapabilities, defaultAgentFormValues } from 'librechat-data-provider';
import type { UseMutationResult, QueryObserverResult } from '@tanstack/react-query';
import type { Agent, AgentCreateParams } from 'librechat-data-provider';
import type { TAgentCapabilities, AgentForm } from '~/common';
import { cn, createProviderOption, processAgentOption, getDefaultAgentFormValues, logger } from '~/utils';
import { useLocalize, useAgentDefaultPermissionLevel, useSetIndexOptions } from '~/hooks';
import { useListAgentsQuery, useDeleteAgentMutation } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { useToastContext } from '@librechat/client';
import {
  Label,
  OGDialog,
  OGDialogTrigger,
  OGDialogTemplate,
} from '@librechat/client';
import { isEphemeralAgent } from '~/common';

const keys = new Set(Object.keys(defaultAgentFormValues));

export default function AgentSelect({
  agentQuery,
  selectedAgentId = null,
  setCurrentAgentId,
  createMutation,
}: {
  selectedAgentId: string | null;
  agentQuery: QueryObserverResult<Agent>;
  setCurrentAgentId: React.Dispatch<React.SetStateAction<string | undefined>>;
  createMutation: UseMutationResult<Agent, Error, AgentCreateParams>;
}) {
  const localize = useLocalize();
  const lastSelectedAgent = useRef<string | null>(null);
  const { control, reset } = useFormContext();
  const permissionLevel = useAgentDefaultPermissionLevel();
  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const { setOption } = useSetIndexOptions();

  const { data: agents = null } = useListAgentsQuery(
    { requiredPermission: permissionLevel },
    {
      select: (res) =>
        res.data.map((agent) =>
          processAgentOption({
            agent: {
              ...agent,
              name: agent.name || agent.id,
            },
          }),
        ),
    },
  );

  const deleteAgent = useDeleteAgentMutation({
    onSuccess: (_, vars, context) => {
      const updatedList = context as Agent[] | undefined;
      if (!updatedList) {
        return;
      }
      showToast({
        message: localize('com_ui_agent_deleted'),
        status: 'success',
      });
      if (createMutation.data?.id ?? '') {
        logger.log('agents', 'resetting createMutation');
        createMutation.reset();
      }
      const firstAgent = updatedList[0] as Agent | undefined;
      if (!firstAgent) {
        setCurrentAgentId(undefined);
        return reset(getDefaultAgentFormValues());
      }
      if (vars.agent_id === conversation?.agent_id) {
        setOption('model')('');
        return setOption('agent_id')(firstAgent.id);
      }
      const currentAgent = updatedList.find((agent) => agent.id === conversation?.agent_id);
      if (currentAgent) {
        setCurrentAgentId(currentAgent.id);
      }
      setCurrentAgentId(firstAgent.id);
    },
    onError: (error) => {
      console.error(error);
      showToast({
        message: localize('com_ui_agent_delete_error'),
        status: 'error',
      });
    },
  });

  const resetAgentForm = useCallback(
    (fullAgent: Agent) => {
      const isGlobal = fullAgent.isPublic ?? false;
      const update = {
        ...fullAgent,
        provider: createProviderOption(fullAgent.provider),
        label: fullAgent.name ?? '',
        value: fullAgent.id || '',
        icon: isGlobal ? <EarthIcon className={'icon-lg text-brand-purple'} /> : null,
      };

      const capabilities: TAgentCapabilities = {
        [AgentCapabilities.web_search]: false,
        [AgentCapabilities.file_search]: false,
        [AgentCapabilities.execute_code]: false,
        [AgentCapabilities.end_after_tools]: false,
        [AgentCapabilities.hide_sequential_outputs]: false,
      };

      const agentTools: string[] = [];
      (fullAgent.tools ?? []).forEach((tool) => {
        if (capabilities[tool] !== undefined) {
          capabilities[tool] = true;
          return;
        }

        agentTools.push(tool);
      });

      const formValues: Partial<AgentForm & TAgentCapabilities> = {
        ...capabilities,
        agent: update,
        model: update.model,
        tools: agentTools,
        // Ensure the category is properly set for the form
        category: fullAgent.category || 'general',
        // Make sure support_contact is properly loaded
        support_contact: fullAgent.support_contact,
        avatar_file: null,
        avatar_preview: fullAgent.avatar?.filepath ?? '',
        avatar_action: null,
      };

      Object.entries(fullAgent).forEach(([name, value]) => {
        if (name === 'model_parameters') {
          formValues[name] = value;
          return;
        }

        if (capabilities[name] !== undefined) {
          formValues[name] = value;
          return;
        }

        if (
          name === 'agent_ids' &&
          Array.isArray(value) &&
          value.every((item) => typeof item === 'string')
        ) {
          formValues[name] = value;
          return;
        }

        if (name === 'edges' && Array.isArray(value)) {
          formValues[name] = value;
          return;
        }

        if (name === 'tool_options' && typeof value === 'object' && value !== null) {
          formValues[name] = value;
          return;
        }

        if (!keys.has(name)) {
          return;
        }

        if (name === 'recursion_limit' && typeof value === 'number') {
          formValues[name] = value;
          return;
        }

        if (typeof value !== 'number' && typeof value !== 'object') {
          formValues[name] = value;
        }
      });

      reset(formValues);
    },
    [reset],
  );

  const onSelect = useCallback(
    (selectedId: string) => {
      const agentExists = !!(selectedId
        ? (agents ?? []).find((agent) => agent.id === selectedId)
        : undefined);

      createMutation.reset();
      if (!agentExists) {
        setCurrentAgentId(undefined);
        return reset(getDefaultAgentFormValues());
      }

      setCurrentAgentId(selectedId);
      const agent = agentQuery.data;
      if (!agent) {
        console.warn('Agent not found');
        return;
      }

      resetAgentForm(agent);
    },
    [agents, createMutation, setCurrentAgentId, agentQuery.data, resetAgentForm, reset],
  );

  useEffect(() => {
    if (agentQuery.data && agentQuery.isSuccess) {
      resetAgentForm(agentQuery.data);
    }
  }, [agentQuery.data, agentQuery.isSuccess, resetAgentForm]);

  useEffect(() => {
    let timerId: NodeJS.Timeout | null = null;

    if (selectedAgentId === lastSelectedAgent.current) {
      return;
    }

    if (selectedAgentId != null && selectedAgentId !== '' && agents) {
      timerId = setTimeout(() => {
        lastSelectedAgent.current = selectedAgentId;
        onSelect(selectedAgentId);
      }, 5);
    }

    return () => {
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [selectedAgentId, agents, onSelect]);

  const createAgent = localize('com_ui_create_new_agent');

  const renderItemSuffix = useCallback(
    (option: { value?: string | number | null; label?: string }) => {
      const agentId = String(option?.value ?? '');
      if (!agentId || isEphemeralAgent(agentId)) {
        return null;
      }
      return (
        <OGDialog key={agentId}>
          <OGDialogTrigger asChild>
            <button
              type="button"
              className="rounded-md p-1 text-red-500 hover:bg-surface-hover hover:text-red-600"
              aria-label={localize('com_ui_delete_agent')}
              title={localize('com_ui_delete_agent')}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </OGDialogTrigger>
          <OGDialogTemplate
            title={localize('com_ui_delete_agent')}
            className="max-w-[450px]"
            main={
              <div className="grid w-full items-center gap-2">
                <Label htmlFor="delete-agent-list" className="text-left text-sm font-medium">
                  {localize('com_ui_delete_agent_confirm')}
                </Label>
              </div>
            }
            selection={{
              selectHandler: () => deleteAgent.mutate({ agent_id: agentId }),
              selectClasses: 'bg-red-600 hover:bg-red-700 dark:hover:bg-red-800 text-white',
              selectText: localize('com_ui_delete'),
            }}
          />
        </OGDialog>
      );
    },
    [localize, deleteAgent],
  );

  return (
    <Controller
      name="agent"
      control={control}
      render={({ field }) => (
        <ControlCombobox
          containerClassName="px-0"
          popoverClassName="z-[130]"
          selectedValue={(field?.value?.value ?? '') + ''}
          displayValue={field?.value?.label ?? ''}
          selectPlaceholder={field?.value?.value ?? createAgent}
          iconSide="right"
          searchPlaceholder={localize('com_agents_search_name')}
          SelectIcon={field?.value?.icon}
          setValue={onSelect}
          items={
            agents?.map((agent) => ({
              label: agent.name ?? '',
              value: agent.id ?? '',
              icon: agent.icon,
            })) ?? [
              {
                label: 'Loading...',
                value: '',
              },
            ]
          }
          className={cn(
            'z-50 flex h-[40px] w-full flex-none items-center justify-center truncate rounded-md bg-transparent font-bold',
          )}
          ariaLabel={localize('com_ui_agent')}
          isCollapsed={false}
          showCarat={true}
          renderItemSuffix={renderItemSuffix}
        />
      )}
    />
  );
}
