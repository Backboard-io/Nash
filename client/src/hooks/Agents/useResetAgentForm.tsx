import { useCallback } from 'react';
import { EarthIcon } from 'lucide-react';
import { AgentCapabilities, defaultAgentFormValues } from 'librechat-data-provider';
import type { UseFormReset } from 'react-hook-form';
import type { Agent } from 'librechat-data-provider';
import type { TAgentCapabilities, AgentForm } from '~/common';
import { createProviderOption } from '~/utils';

const keys = new Set(Object.keys(defaultAgentFormValues));

/**
 * Builds the agent-builder form values from a fully-loaded agent and resets the
 * form to them. Extracted from the (now unmounted) AgentSelect dropdown so the
 * builder can populate itself when editing an existing persona — without it the
 * form never receives the fetched agent, so `id` stays empty and the panel shows
 * "Create Persona" with blank fields.
 */
export default function useResetAgentForm(reset: UseFormReset<AgentForm>) {
  return useCallback(
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
        category: fullAgent.category || 'general',
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
}
