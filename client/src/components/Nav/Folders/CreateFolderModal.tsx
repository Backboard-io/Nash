import React, { useState } from 'react';
import { OGDialog, OGDialogTemplate, Button, Input, useToastContext } from '@librechat/client';
import { useCreateFolderMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const PRESET_NAMES = [
  'com_folder_investing',
  'com_folder_writing',
  'com_folder_homework',
  'com_folder_travel',
] as const;

interface CreateFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateFolderModal({ open, onOpenChange }: CreateFolderModalProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [name, setName] = useState('');
  const [sharedMemory, setSharedMemory] = useState(false);

  const createMutation = useCreateFolderMutation({
    onSuccess: () => {
      setName('');
      setSharedMemory(false);
      onOpenChange(false);
    },
    onError: () => {
      showToast({ message: 'Failed to create folder', status: 'error' });
    },
  });

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    createMutation.mutate({ name: trimmed, sharedMemory });
  };

  const handlePresetClick = (key: typeof PRESET_NAMES[number]) => {
    setName(localize(key));
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_folder_create')}
        className="w-full max-w-md"
        main={
          <div className="flex flex-col gap-4 p-1">
            <div className="flex flex-wrap gap-2">
              {PRESET_NAMES.map((key) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  onClick={() => handlePresetClick(key)}
                  className="text-xs"
                >
                  {localize(key)}
                </Button>
              ))}
            </div>
            <Input
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder={localize('com_folder_name_placeholder')}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter') {
                  handleCreate();
                }
              }}
            />
            <div className="flex items-center justify-between rounded-lg border border-border-light p-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-text-primary">
                  {sharedMemory
                    ? localize('com_folder_shared_memory')
                    : localize('com_folder_isolated_memory')}
                </span>
                <span className="text-xs text-text-secondary">
                  {sharedMemory
                    ? 'Conversations share memory with all chats'
                    : 'Conversations have their own isolated memory'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!sharedMemory}
                onClick={() => setSharedMemory(!sharedMemory)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-hover ease-nash focus:outline-none ${
                  !sharedMemory ? 'bg-brand-purple' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-hover ease-nash ${
                    !sharedMemory ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        }
        buttons={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || createMutation.isLoading}
            >
              {localize('com_folder_create')}
            </Button>
          </div>
        }
      />
    </OGDialog>
  );
}
