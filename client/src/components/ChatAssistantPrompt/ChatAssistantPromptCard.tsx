import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Check, Loader2 } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import { useGetChatAssistantQuery, useUpdateChatAssistantMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const DEFAULT_PLACEHOLDER =
  'You are Nash, a helpful AI assistant. Be concise, accurate, and helpful.';

type Variant = 'panel' | 'settings';

export default function ChatAssistantPromptCard({
  variant = 'panel',
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data, isLoading, isError } = useGetChatAssistantQuery();
  const updateMutation = useUpdateChatAssistantMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_saved'), status: 'success' });
      setSaveIndicator(true);
      saveIndicatorRef.current = window.setTimeout(() => setSaveIndicator(false), 2000);
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
    if (!isDirty || updateMutation.isLoading) return;
    updateMutation.mutate({ system_prompt: value });
  };

  const isSettings = variant === 'settings';
  const minRows = isSettings ? 6 : 3;

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-border-medium bg-surface-secondary p-6',
          isSettings && 'p-8',
          className,
        )}
      >
        <Spinner className="size-6 text-text-secondary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className={cn(
          'rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400',
          className,
        )}
      >
        {localize('com_ui_error')}
      </div>
    );
  }

  const isEmpty = !value.trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={cn(
        'rounded-xl border border-border-medium bg-surface-secondary transition-shadow duration-200 hover:shadow-md',
        isSettings && 'border-border-heavy shadow-sm',
        className,
      )}
    >
      <div className={cn('p-3', isSettings && 'p-5')}>
        <div className="mb-3 flex items-center gap-2">
          <span
            className={cn(
              'flex items-center gap-2 rounded-lg bg-blue-500/10 dark:bg-blue-500/20',
              isSettings ? 'p-2' : 'p-1.5',
            )}
          >
            <MessageSquare
              className={cn(
                'text-blue-600 dark:text-blue-400',
                isSettings ? 'size-5' : 'size-4',
              )}
              aria-hidden
            />
          </span>
          <div className="flex-1">
            <h3
              className={cn(
                'font-medium text-text-primary',
                isSettings ? 'text-base' : 'text-sm',
              )}
            >
              {localize('com_sidepanel_chat_assistant_prompt')}
            </h3>
            {isSettings && (
              <p className="mt-0.5 text-xs text-text-secondary">
                {localize('com_settings_chat_assistant_prompt_description')}
              </p>
            )}
          </div>
        </div>

        <div className="relative">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={DEFAULT_PLACEHOLDER}
            rows={minRows}
            className={cn(
              'w-full resize-y rounded-lg border border-border-medium bg-background px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary',
              'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-500/30',
              'transition-colors duration-150 min-h-[80px]',
              isSettings && 'min-h-[140px] py-3 text-[15px]',
            )}
            aria-label={localize('com_sidepanel_chat_assistant_prompt')}
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            {isEmpty && (
              <p className="text-xs text-text-tertiary">
                {localize('com_settings_chat_assistant_prompt_empty_hint')}
              </p>
            )}
            {!isEmpty && <div />}
            <div className="flex items-center gap-2">
              <AnimatePresence mode="wait">
                {saveIndicator ? (
                  <motion.span
                    key="saved"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5 text-sm text-brand-purple dark:text-violet-400"
                  >
                    <Check className="size-4" aria-hidden />
                    {localize('com_ui_saved')}
                  </motion.span>
                ) : (
                  <motion.span key="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <Button
                      type="button"
                      variant="outline"
                      size={isSettings ? 'default' : 'sm'}
                      onClick={handleSave}
                      disabled={!isDirty || updateMutation.isLoading}
                      className="active:scale-[0.97]"
                    >
                      {updateMutation.isLoading ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        localize('com_ui_save')
                      )}
                    </Button>
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
