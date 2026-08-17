import { Controller, useFormContext } from 'react-hook-form';
import type { AgentForm } from '~/common';
import { cn, defaultTextProps, removeFocusOutlines } from '~/utils';
import { useLocalize } from '~/hooks';

const inputClass = cn(
  defaultTextProps,
  'flex w-full px-3 py-2 border-border-light bg-surface-secondary focus-visible:ring-2 focus-visible:ring-ring-primary',
  removeFocusOutlines,
);

export default function Instructions() {
  const localize = useLocalize();
  const methods = useFormContext<AgentForm>();
  const { control } = methods;

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center">
        <label className="text-token-text-primary flex-grow font-medium" htmlFor="instructions">
          {localize('com_ui_instructions')}
        </label>
      </div>
      <Controller
        name="instructions"
        control={control}
        render={({ field, fieldState: { error } }) => (
          <>
            <textarea
              {...field}
              value={field.value ?? ''}
              className={cn(inputClass, 'min-h-[100px] resize-y')}
              id="instructions"
              placeholder={localize('com_agents_instructions_placeholder')}
              rows={3}
              aria-label="Agent instructions"
              aria-required="true"
              aria-invalid={error ? 'true' : 'false'}
            />
            {error && (
              <span
                className="text-sm text-red-500 transition duration-swap ease-nash"
                role="alert"
              >
                {localize('com_ui_field_required')}
              </span>
            )}
          </>
        )}
      />
    </div>
  );
}
