import React, { useState } from 'react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import {
  OGDialog,
  OGDialogTemplate,
  Button,
  Label,
  Spinner,
  useToastContext,
} from '@librechat/client';
import { useCreateMemoryMutation, useFoldersQuery, useCreateFolderMemoryMutation } from '~/data-provider';
import { cn } from '~/utils';
import { useLocalize, useHasAccess } from '~/hooks';

interface MemoryCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  triggerRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

export default function MemoryCreateDialog({
  open,
  onOpenChange,
  children,
  triggerRef,
}: MemoryCreateDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const hasCreateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.CREATE,
  });

  const { mutate: createMemory, isLoading } = useCreateMemoryMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_memory_created'),
        status: 'success',
      });
      onOpenChange(false);
      setValue('');
      setTimeout(() => {
        triggerRef?.current?.focus();
      }, 0);
    },
    onError: (error: Error) => {
      let errorMessage = localize('com_ui_error');

      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as any;
        if (axiosError.response?.data?.error) {
          errorMessage = axiosError.response.data.error;

          // Check for duplicate key error
          if (axiosError.response?.status === 409 || errorMessage.includes('already exists')) {
            errorMessage = localize('com_ui_memory_key_exists');
          }
          // Check for key validation error (lowercase and underscores only)
          else if (errorMessage.includes('lowercase letters and underscores')) {
            errorMessage = localize('com_ui_memory_key_validation');
          }
        }
      } else if (error.message) {
        errorMessage = error.message;
      }

      showToast({
        message: errorMessage,
        status: 'error',
      });
    },
  });

  /* Where the memory is stored is *which assistant it is attached to*: the
     user's own for Universal, the folder's isolated one for a workspace. That
     is the whole of scoping, and it is why this picker can exist here rather
     than on each folder's page. Persona is deliberately absent — agents carry
     an assistant id but the API has no memories route for one yet. Chat is
     absent because chat memories are written by the model, never by hand. */
  const [scope, setScope] = useState<'global' | 'folder'>('global');
  const [folderId, setFolderId] = useState('');
  const { data: foldersData } = useFoldersQuery();
  const folders = foldersData ?? [];

  const { mutate: createFolderMemory, isLoading: isCreatingFolderMemory } =
    useCreateFolderMemoryMutation(folderId, {
      onSuccess: () => {
        showToast({ message: localize('com_ui_memory_created'), status: 'success' });
        onOpenChange(false);
        setValue('');
      },
      onError: () => {
        showToast({ message: localize('com_ui_error'), status: 'error' });
      },
    });

  const [value, setValue] = useState('');

  const handleSave = () => {
    if (!hasCreateAccess) {
      return;
    }

    if (!value.trim()) {
      showToast({
        message: localize('com_ui_field_required'),
        status: 'error',
      });
      return;
    }

    if (scope === 'folder') {
      if (!folderId) {
        showToast({ message: localize('com_ui_field_required'), status: 'error' });
        return;
      }
      createFolderMemory({ key: '', value: value.trim() });
      return;
    }

    createMemory({
      key: '',
      value: value.trim(),
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && hasCreateAccess) {
      handleSave();
    }
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      {children}
      <OGDialogTemplate
        title={localize('com_ui_create_memory')}
        showCloseButton={false}
        className="w-11/12 md:max-w-lg"
        main={
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-text-primary">
                {localize('com_ui_memory_scope_label')}
              </Label>
              <div className="flex gap-2">
                {(['global', 'folder'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setScope(option)}
                    aria-pressed={scope === option}
                    className={cn(
                      'flex-1 rounded-[10px] px-3 py-2.5 text-left transition-colors',
                      scope === option
                        ? 'bg-surface-hover text-text-primary'
                        : 'bg-surface-secondary text-text-secondary hover:text-text-primary',
                    )}
                  >
                    <span className="block text-[13px] font-medium leading-[19px]">
                      {option === 'global'
                        ? localize('com_ui_memory_scope_global')
                        : localize('com_ui_memory_scope_workspace')}
                    </span>
                    <span className="block text-[12px] leading-[17px] text-text-tertiary">
                      {option === 'global'
                        ? localize('com_ui_memory_scope_global_desc')
                        : localize('com_ui_memory_scope_workspace_desc')}
                    </span>
                  </button>
                ))}
              </div>
              {scope === 'folder' && (
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  aria-label={localize('com_ui_memory_scope_workspace')}
                  className="h-10 w-full rounded-[10px] border-0 bg-surface-secondary px-3 text-[13px] text-text-primary focus:outline-none"
                >
                  <option value="">{localize('com_ui_memory_pick_workspace')}</option>
                  {folders.map((folder) => (
                    <option key={folder.folderId} value={folder.folderId}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="memory-value" className="text-sm font-medium text-text-primary">
                {localize('com_ui_value')}
              </Label>
              <textarea
                id="memory-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={localize('com_ui_enter_value')}
                /* Same box as Edit Memory: fixed height, scrolls, no grip. A
                   `min-h` with rows grows the dialog as you type. */
                className="h-[160px] w-full resize-none overflow-y-auto rounded-[10px] border-0 bg-surface-secondary p-3 text-[13px] leading-[20px] text-text-primary focus:outline-none"
              />
            </div>
          </div>
        }
        buttons={
          <Button
            type="button"
            variant="submit"
            onClick={handleSave}
            disabled={isLoading || isCreatingFolderMemory || !value.trim()}
            className="text-white"
            aria-label={localize('com_ui_create_memory')}
          >
            {isLoading || isCreatingFolderMemory ? (
              <Spinner className="size-4" />
            ) : (
              localize('com_ui_create')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
