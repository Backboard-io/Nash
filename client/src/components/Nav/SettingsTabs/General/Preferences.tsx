import React, { useMemo, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import { getModelName } from 'librechat-data-provider';
import { ControlCombobox } from '@librechat/client';
import type { OptionWithIcon } from '~/common';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { useListAgentsQuery } from '~/data-provider';
import { useAgentDefaultPermissionLevel } from '~/hooks';
import {
  DEFAULT_OPTION,
  IMAGE_MODEL_OPTIONS,
  TTS_VOICE_OPTIONS,
} from '~/components/Chat/Input/composerSelectOptions';
import store from '~/store';

// Personas are listed in the same "Chat model" default dropdown as models. Their
// option value is prefixed so onChange can tell a persona (agent id) apart from a
// model name and route it to the right setting.
const PERSONA_PREFIX = 'persona:';

function PreferenceSelector({
  label,
  value,
  onChange,
  items,
  ariaLabel,
  searchPlaceholder,
  popoverWidth,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: OptionWithIcon[];
  ariaLabel: string;
  searchPlaceholder: string;
  popoverWidth?: number | string;
}) {
  const selectedLabel =
    (items.find((item) => item.value === value)?.label as string | undefined) ?? value;
  // The trigger button is narrow and truncates. Show just the model's short
  // name (last path segment) so a long provider-prefixed id like
  // "openrouter/deepseek/deepseek-chat-v3-0324" is readable on the closed
  // dropdown instead of cut to "openrouter/deepseek/de…". The open list keeps
  // the full label (its popover is widened).
  const displayValue =
    selectedLabel && selectedLabel.includes('/')
      ? selectedLabel.slice(selectedLabel.lastIndexOf('/') + 1)
      : selectedLabel;

  return (
    <div className="flex items-center justify-between">
      <div>{label}</div>
      <div className="w-[240px]">
        <ControlCombobox
          isCollapsed={false}
          ariaLabel={ariaLabel}
          selectedValue={value}
          displayValue={displayValue}
          selectPlaceholder="Default"
          searchPlaceholder={searchPlaceholder}
          items={items}
          setValue={onChange}
          showCarat
          containerClassName="px-0"
          popoverWidth={popoverWidth}
        />
      </div>
    </div>
  );
}

function Preferences() {
  const [defaultChatModel, setDefaultChatModel] = useRecoilState(store.defaultChatModel);
  const [defaultImageModel, setDefaultImageModel] = useRecoilState(store.defaultImageModel);
  const [defaultTTSVoice, setDefaultTTSVoice] = useRecoilState(store.defaultTTSVoice);
  const [defaultPersona, setDefaultPersona] = useRecoilState(store.defaultPersona);

  const { data: modelsConfig } = useGetModelsQuery();

  const permissionLevel = useAgentDefaultPermissionLevel();
  const { data: personaOptions = [] } = useListAgentsQuery(
    { requiredPermission: permissionLevel },
    {
      select: (res) =>
        res.data.map((agent) => ({ value: agent.id, label: agent.name ?? agent.id })),
    },
  );

  // One default picker for both models and personas. A default model and a
  // default persona are mutually exclusive (a new chat opens as one or the
  // other), so selecting either clears the other; "Default" clears both.
  const modelOrPersonaOptions = useMemo<OptionWithIcon[]>(() => {
    const names = new Set<string>();
    Object.values(modelsConfig ?? {}).forEach((list) => {
      (list ?? []).forEach((model) => {
        const name = getModelName(model);
        if (name) {
          names.add(name);
        }
      });
    });
    const models = Array.from(names).map((name) => ({ value: name, label: name }));
    const personas = personaOptions.map((p) => ({
      value: `${PERSONA_PREFIX}${p.value}`,
      label: `${p.label} (Persona)`,
    }));
    return [DEFAULT_OPTION, ...personas, ...models];
  }, [modelsConfig, personaOptions]);

  // The currently-selected default, encoded for the combined dropdown: a set
  // persona is shown as `persona:<id>`, otherwise the model name.
  const defaultModelOrPersona = defaultPersona
    ? `${PERSONA_PREFIX}${defaultPersona}`
    : defaultChatModel;

  const handleDefaultModelOrPersonaChange = useCallback(
    (value: string) => {
      if (value.startsWith(PERSONA_PREFIX)) {
        setDefaultPersona(value.slice(PERSONA_PREFIX.length));
        setDefaultChatModel('');
      } else {
        // A model name, or '' for the "Default" option (clears both).
        setDefaultChatModel(value);
        setDefaultPersona('');
      }
    },
    [setDefaultChatModel, setDefaultPersona],
  );

  return (
    <div className="flex flex-col gap-3 border-t border-border-light pt-3">
      <div className="text-sm font-medium text-text-primary">Defaults</div>

      <PreferenceSelector
        label="Chat model"
        ariaLabel="Default chat model or persona"
        searchPlaceholder="Search models & personas..."
        value={defaultModelOrPersona}
        onChange={handleDefaultModelOrPersonaChange}
        items={modelOrPersonaOptions}
        popoverWidth="min(28rem, calc(100vw - 2rem))"
      />

      <PreferenceSelector
        label="Image model"
        ariaLabel="Default image model"
        searchPlaceholder="Search image models..."
        value={defaultImageModel}
        onChange={setDefaultImageModel}
        items={IMAGE_MODEL_OPTIONS}
      />

      <PreferenceSelector
        label="Voice"
        ariaLabel="Default voice"
        searchPlaceholder="Search voices..."
        value={defaultTTSVoice}
        onChange={setDefaultTTSVoice}
        items={TTS_VOICE_OPTIONS}
      />
    </div>
  );
}

export default React.memo(Preferences);
