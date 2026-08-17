import React, { useState } from 'react';
import { Label, Input, Button, Spinner, useToastContext } from '@librechat/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, request, apiBaseUrl } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import { KeyRound, ExternalLink, Check } from 'lucide-react';

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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-text-secondary" aria-hidden="true" />
        <Label className="text-sm font-medium">Backboard API Key</Label>
      </div>
      <p className="text-xs text-text-secondary">
        Connect your{' '}
        <a
          href="https://app.backboard.io/settings"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-brand-purple hover:underline dark:text-violet-400"
        >
          Backboard account
          <ExternalLink className="h-3 w-3" />
        </a>
        {' '}to use your own API key. Your usage will be billed directly to your Backboard account.
      </p>
      {hasKey && !isEditing ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-brand-purple/30 bg-brand-purple/10 px-3 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
            <Check className="h-3.5 w-3.5" />
            API key connected
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="text-xs"
          >
            Change
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRemove}
            disabled={isLoading}
            className="text-xs text-red-500 hover:text-red-600"
          >
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste your Backboard API key"
            className="max-w-sm font-mono text-xs"
            onKeyDown={(e) => e.key === 'Enter' && value.trim() && handleSave()}
          />
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={isLoading || !value.trim()}
            className="shrink-0"
          >
            {isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
          {isEditing && (
            <Button
              variant="ghost"
              onClick={() => { setIsEditing(false); setValue(''); }}
              className="shrink-0 text-xs"
            >
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
