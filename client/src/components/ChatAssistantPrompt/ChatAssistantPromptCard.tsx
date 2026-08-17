import { useState, useEffect, useRef } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Spinner, useToastContext } from '@librechat/client';
import { useGetChatAssistantQuery, useUpdateChatAssistantMutation } from '~/data-provider';
import { secondaryAction } from '~/components/ui/actionButton';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const DEFAULT_PLACEHOLDER =
  'You are Nash, a helpful AI assistant. Be concise, accurate, and helpful.';

export default function ChatAssistantPromptCard({ className }: { className?: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data, isLoading, isError } = useGetChatAssistantQuery();
  const updateMutation = useUpdateChatAssistantMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_saved'), status: 'success' });
      setSaveIndicator(true);
      saveIndicatorRef.current = setTimeout(() => setSaveIndicator(false), 2000);
    },
    onError: () => {
      showToast({ message: localize('com_ui_error'), status: 'error' });
    },
  });

  const [value, setValue] = useState('');
  const [saveIndicator, setSaveIndicator] = useState(false);
  const saveIndicatorRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (data?.system_prompt !== undefined) {
      setValue(data.system_prompt);
    }
  }, [data?.system_prompt]);

  useEffect(() => {
    return () => {
      if (saveIndicatorRef.current) {
        clearTimeout(saveIndicatorRef.current);
      }
    };
  }, []);

  const isDirty = value !== (data?.system_prompt ?? '');
  const handleSave = () => {
    if (!isDirty || updateMutation.isLoading) {
      return;
    }
    updateMutation.mutate({ system_prompt: value });
  };

  if (isLoading) {
    return (
      <div className={cn('flex h-[124px] items-center justify-center', className)}>
        <Spinner className="size-5 text-text-secondary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className={cn(
          'rounded-[10px] bg-surface-destructive-subtle px-3 py-2.5 text-[13.5px] leading-[20px] text-text-destructive',
          className,
        )}
      >
        {localize('com_ui_error')}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div>
        <div className="text-[13.5px] font-medium leading-[20px] text-text-primary">
          {localize('com_sidepanel_chat_assistant_prompt')}
        </div>
        <p className="mt-0.5 text-[12.5px] leading-[18px] text-text-secondary-alt">
          {localize('com_settings_chat_assistant_prompt_description')}
        </p>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={DEFAULT_PLACEHOLDER}
        rows={5}
        className={cn(
          'w-full resize-none overflow-y-auto rounded-[10px] bg-surface-secondary px-3 py-2.5',
          'text-[13.5px] leading-[20px] text-text-primary placeholder:text-text-tertiary',
          'scrollbar-hover focus:outline-none',
        )}
        aria-label={localize('com_sidepanel_chat_assistant_prompt')}
      />
      <div className="flex h-[30px] items-center justify-end gap-2">
        {saveIndicator && (
          <span className="flex items-center gap-1.5 text-[12.5px] leading-[18px] text-text-secondary">
            <Check size={14} aria-hidden="true" />
            {localize('com_ui_saved')}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || updateMutation.isLoading}
          className={secondaryAction}
        >
          {updateMutation.isLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            localize('com_ui_save')
          )}
        </button>
      </div>
    </div>
  );
}
