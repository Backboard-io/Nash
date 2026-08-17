import React, { useMemo, useEffect } from 'react';
import { ControlCombobox } from '@librechat/client';
import { ChevronLeft } from 'lucide-react';
import { useFormContext, useWatch, Controller } from 'react-hook-form';
import { alternateName, getModelName, LocalStorageKeys } from 'librechat-data-provider';
import type { AgentForm, AgentModelPanelProps, StringOption } from '~/common';
import { useLocalize } from '~/hooks';
import { Panel } from '~/common';
import { cn, formatModelName } from '~/utils';

export default function ModelPanel({
  providers,
  setActivePanel,
  models: modelsData,
}: Pick<AgentModelPanelProps, 'models' | 'providers' | 'setActivePanel'>) {
  const localize = useLocalize();

  const { control, setValue } = useFormContext<AgentForm>();

  const model = useWatch({ control, name: 'model' });
  const providerOption = useWatch({ control, name: 'provider' });

  const provider = useMemo(() => {
    const value =
      typeof providerOption === 'string'
        ? providerOption
        : (providerOption as StringOption | undefined)?.value;
    return value ?? '';
  }, [providerOption]);
  const models = useMemo(
    () =>
      (provider ? (modelsData[provider] ?? []) : []).map((m) =>
        typeof m === 'string' ? m : m.name,
      ),
    [modelsData, provider],
  );

  useEffect(() => {
    const _model = model ?? '';
    if (provider && _model) {
      const modelExists = models.some((m) => getModelName(m) === _model);
      if (!modelExists) {
        const newModels = modelsData[provider] ?? [];
        setValue('model', newModels[0] != null ? getModelName(newModels[0]) : '');
      }
      localStorage.setItem(LocalStorageKeys.LAST_AGENT_MODEL, _model);
      localStorage.setItem(LocalStorageKeys.LAST_AGENT_PROVIDER, provider);
    }

    if (provider && !_model) {
      setValue('model', models[0] != null ? getModelName(models[0]) : '');
    }
  }, [provider, models, modelsData, setValue, model]);

  return (
    <div className="scrollbar-gutter-stable mx-1 mb-1 flex h-full min-h-[50vh] w-full flex-col gap-4 overflow-auto pb-4 text-sm">
      {/* Header: back to basic + title + subtitle */}
      <div className="px-1 pt-1">
        <button
          type="button"
          onClick={() => setActivePanel(Panel.builder)}
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={localize('com_ui_back_to_basic')}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {localize('com_ui_back_to_basic')}
        </button>
        <h2 className="text-xl font-semibold text-text-primary">
          {localize('com_ui_advanced_settings')}
        </h2>
        <p className="mt-0.5 text-sm text-text-secondary">
          {localize('com_ui_advanced_settings_subtitle')}
        </p>
      </div>
      {/* Model card: provider + model */}
      <section className="rounded-2xl border border-border-light bg-surface-secondary p-4">
        <div className="mb-4 border-b border-border-light pb-3">
          <h3 className="text-sm font-semibold text-text-primary">{localize('com_ui_model')}</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            {localize('com_ui_model_group_desc')}
          </p>
        </div>
        {/* Endpoint aka Provider for Agents */}
        <div className="mb-4">
          <label
            id="provider-label"
            className="mb-2 block text-sm font-medium text-text-primary"
            htmlFor="provider"
          >
            {localize('com_ui_provider')} <span className="text-brand-purple">*</span>
          </label>
          <Controller
            name="provider"
            control={control}
            rules={{ required: true, minLength: 1 }}
            render={({ field, fieldState: { error } }) => {
              const value =
                typeof field.value === 'string'
                  ? field.value
                  : ((field.value as StringOption)?.value ?? '');
              const display =
                typeof field.value === 'string'
                  ? field.value
                  : ((field.value as StringOption)?.label ?? '');

              return (
                <>
                  <ControlCombobox
                    selectedValue={value}
                    displayValue={alternateName[display] ?? display}
                    selectPlaceholder={localize('com_ui_select_provider')}
                    searchPlaceholder={localize('com_ui_select_search_provider')}
                    setValue={field.onChange}
                    items={providers.map((provider) => ({
                      label: typeof provider === 'string' ? provider : provider.label,
                      value: typeof provider === 'string' ? provider : provider.value,
                    }))}
                    className={cn(error ? 'border-2 border-red-500' : '')}
                    popoverClassName="z-[130]"
                    ariaLabel={localize('com_ui_provider')}
                    isCollapsed={false}
                    showCarat={true}
                  />
                  {error && (
                    <span className="model-panel-error text-sm text-red-500 transition duration-swap ease-nash">
                      {localize('com_ui_field_required')}
                    </span>
                  )}
                </>
              );
            }}
          />
        </div>
        {/* Model */}
        <div>
          <label
            id="model-label"
            className={cn(
              'mb-2 block text-sm font-medium text-text-primary',
              !provider && 'text-text-tertiary',
            )}
            htmlFor="model"
          >
            {localize('com_ui_model')} <span className="text-brand-purple">*</span>
          </label>
          <Controller
            name="model"
            control={control}
            rules={{ required: true, minLength: 1 }}
            render={({ field, fieldState: { error } }) => {
              return (
                <>
                  <ControlCombobox
                    selectedValue={field.value || ''}
                    displayValue={field.value ? formatModelName(field.value) : ''}
                    selectPlaceholder={
                      provider
                        ? localize('com_ui_select_model')
                        : localize('com_ui_select_provider_first')
                    }
                    searchPlaceholder={localize('com_ui_select_model')}
                    setValue={field.onChange}
                    items={models.map((model) => ({
                      label: formatModelName(getModelName(model)),
                      value: getModelName(model),
                    }))}
                    disabled={!provider}
                    className={cn('disabled:opacity-50', error ? 'border-2 border-red-500' : '')}
                    popoverClassName="z-[130]"
                    ariaLabel={localize('com_ui_model')}
                    isCollapsed={false}
                    showCarat={true}
                  />
                  {provider && error && (
                    <span className="text-sm text-red-500 transition duration-swap ease-nash">
                      {localize('com_ui_field_required')}
                    </span>
                  )}
                </>
              );
            }}
          />
        </div>
      </section>
      {/* Footer: Save Settings */}
      <div className="flex items-center gap-2 px-1 pt-1">
        <button
          type="button"
          onClick={() => setActivePanel(Panel.builder)}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-purple px-4 text-sm font-semibold text-brand-purple-foreground transition-colors hover:bg-brand-purple-hover active:bg-brand-purple-pressed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {localize('com_ui_save_settings')}
        </button>
      </div>
    </div>
  );
}
