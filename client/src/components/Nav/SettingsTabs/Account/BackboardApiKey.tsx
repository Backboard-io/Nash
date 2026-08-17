import React, { useState } from 'react';
import { Label, Input, Spinner, useToastContext } from '@librechat/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, request, apiBaseUrl } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import { ExternalLink, Check } from 'lucide-react';

const useUpdateApiKeyMutation = () => {
  const queryClient = useQueryClient();
  return useMutation(
    (bbApiKey: string) =>
      request.patch(`${apiBaseUrl()}/api/user/profile`, { bbApiKey }) as Promise<{
        id: string;
        hasApiKey: boolean;
      }>,
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.user]);
      },
    },
  );
};

export default function BackboardApiKey() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { user } = useAuthContext();
  const [value, setValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const hasKey = !!(user as any)?.hasApiKey;

  const { mutate: updateKey, isLoading } = useUpdateApiKeyMutation();

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    updateKey(trimmed, {
      onSuccess: () => {
        showToast({ message: 'API key saved and verified', status: 'success' });
        setValue('');
        setIsEditing(false);
      },
      onError: () => {
        showToast({ message: 'Invalid API key. Check your key and try again.', status: 'error' });
      },
    });
  };

  const handleRemove = () => {
    updateKey('', {
      onSuccess: () => {
        showToast({ message: 'API key removed', status: 'success' });
        setValue('');
        setIsEditing(false);
      },
      onError: () => {
        showToast({ message: localize('com_ui_error'), status: 'error' });
      },
    });
  };

  /* §4: one button shape per weight. This block had three buttons in a row in
     three different treatments — an outlined *status* pretending to be a
     button, a filled Change, and a red-text Remove — so nothing said which of
     them was the action. Status is a chip, Change is `.ghost.outlined`, and
     Remove is a `.ghost` that only turns red under the pointer (§1: red is the
     action, not the container). */
  const ghostOutlined =
    'inline-flex h-[30px] shrink-0 items-center justify-center gap-[6px] rounded-[8px] px-[14px] text-[12.5px] font-medium text-text-primary ring-1 ring-inset ring-border-light transition-colors hover:bg-surface-active focus:outline-none disabled:cursor-default disabled:opacity-[.42]';
  const ghost =
    'inline-flex h-[30px] shrink-0 items-center justify-center rounded-[8px] px-[14px] text-[12.5px] font-medium text-text-secondary-alt transition-colors hover:bg-surface-active hover:text-text-destructive focus:outline-none disabled:cursor-default disabled:opacity-[.42]';

  return (
    <div className="flex flex-col gap-2">
      {/* No icon beside the heading — §7: the words carry it. */}
      <Label className="text-[13.5px] font-medium leading-[20px] text-text-primary">
        Backboard API Key
      </Label>
      <p className="text-[12.5px] leading-[18px] text-text-secondary-alt">
        Connect your{' '}
        <a
          href="https://app.backboard.io/settings"
          target="_blank"
          rel="noopener noreferrer"
          /* §1 keeps accent for link-styled actions, which this is. */
          className="inline-flex items-center gap-[3px] text-text-primary hover:underline"
        >
          Backboard account
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
        {' '}to use your own API key. Your usage will be billed directly to your Backboard account.
      </p>
      {hasKey && !isEditing ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-[5px] rounded-[7px] bg-surface-active px-[9px] py-[4px] text-[12px] font-medium leading-[16px] text-text-success">
            <Check className="h-[13px] w-[13px]" aria-hidden="true" />
            API key connected
          </span>
          <span className="flex-1" />
          <button type="button" onClick={() => setIsEditing(true)} className={ghostOutlined}>
            Change
          </button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={isLoading}
            className={ghost}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste your Backboard API key"
            className="h-[34px] max-w-sm flex-1 rounded-[8px] border-0 bg-surface-secondary font-mono text-[12.5px]"
            onKeyDown={(e) => e.key === 'Enter' && value.trim() && handleSave()}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={isLoading || !value.trim()}
            className={ghostOutlined}
          >
            {isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setValue('');
              }}
              className="inline-flex h-[30px] shrink-0 items-center justify-center rounded-[8px] px-[14px] text-[12.5px] font-medium text-text-secondary-alt transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
