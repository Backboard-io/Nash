import React, { useState, useEffect } from 'react';
import { Label, Input, Button, Spinner, useToastContext } from '@librechat/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, request, apiBaseUrl } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

const useUpdateNicknameMutation = () => {
  const queryClient = useQueryClient();
  return useMutation(
    (nickname: string) =>
      request.patch(`${apiBaseUrl()}/api/user/profile`, { nickname }) as Promise<{
        id: string;
        nickname: string;
      }>,
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.user]);
      },
    },
  );
};

export default function Nickname() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { user } = useAuthContext();
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue((user as any)?.nickname ?? '');
  }, [user]);

  const { mutate: updateNickname, isLoading } = useUpdateNicknameMutation();

  const handleSave = () => {
    updateNickname(value.trim(), {
      onSuccess: () => {
        showToast({ message: localize('com_ui_saved'), status: 'success' });
      },
      onError: () => {
        showToast({ message: localize('com_ui_error'), status: 'error' });
      },
    });
  };

  const isDirty = value.trim() !== ((user as any)?.nickname ?? '');

  return (
    <div className="flex items-center justify-between">
      <div className="flex-1 pr-4">
        <Label htmlFor="nickname-input" className="mb-1 block text-sm font-medium">
          Chat greeting name
        </Label>
        <p className="mb-2 text-xs text-text-secondary">
          Name used in your chat screen greeting. Defaults to your account name if left blank.
        </p>
        <div className="flex items-center gap-2">
          <Input
            id="nickname-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={(user as any)?.name ?? 'Enter a nickname'}
            maxLength={64}
            className="max-w-xs"
            onKeyDown={(e) => e.key === 'Enter' && isDirty && handleSave()}
          />
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={isLoading || !isDirty}
            className="shrink-0"
          >
            {isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
