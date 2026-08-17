import { useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Copy, MoreHorizontal } from 'lucide-react';
import { EditIcon, TrashIcon2 } from '~/components/svg/NashMemoriesIcons';
import { Trans } from 'react-i18next';
import {
  Label,
  Spinner,
  OGDialog,
  TooltipAnchor,
  OGDialogTrigger,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TUserMemory } from 'librechat-data-provider';
import { useDeleteMemoryMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MemoryCardActionsProps {
  memory: TUserMemory;
  onEdit: () => void;
  onDeleteError?: (retry: () => void) => void;
}

export default function MemoryCardActions({ memory, onEdit, onDeleteError }: MemoryCardActionsProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { mutate: deleteMemory, isLoading: isDeleting } = useDeleteMemoryMutation();

  const buttonBaseClass = cn(
    'flex size-7 items-center justify-center rounded-[6px]',
    'transition-colors duration-150',
    'text-text-secondary-alt hover:text-text-primary',
    'hover:bg-surface-hover',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );

  const confirmDelete = () => {
    const run = () =>
      deleteMemory(memory.key, {
        onSuccess: () => {
          showToast({ message: localize('com_ui_deleted'), status: 'success' });
        },
        onError: () => {
          if (onDeleteError) {
            onDeleteError(() => run());
          } else {
            showToast({ message: localize('com_ui_error'), status: 'error' });
          }
        },
      });
    setDeleteOpen(false);
    run();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(memory.value);
      showToast({ message: localize('com_ui_copied'), status: 'success' });
    } catch {
      showToast({ message: localize('com_ui_error'), status: 'error' });
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      {/* Edit Button (inline) */}
      <TooltipAnchor
        description={localize('com_ui_edit_memory')}
        side="top"
        render={
          <button
            className={buttonBaseClass}
            aria-label={localize('com_ui_edit')}
            onClick={onEdit}
          >
            <EditIcon size={16} />
          </button>
        }
      />

      {/* Delete Button */}
      <OGDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <OGDialogTrigger asChild>
          <TooltipAnchor
            description={localize('com_ui_delete_memory')}
            side="top"
            render={
              <button
                className={buttonBaseClass}
                aria-label={localize('com_ui_delete')}
                onClick={() => setDeleteOpen(true)}
              >
                {isDeleting ? <Spinner className="size-4" /> : <TrashIcon2 size={16} />}
              </button>
            }
          />
        </OGDialogTrigger>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_ui_delete_memory')}
          className="w-11/12 max-w-lg"
          main={
            <Label className="text-left text-sm font-medium">
              <Trans
                i18nKey="com_ui_delete_confirm_strong"
                values={{
                  title:
                    memory.value.length > 80 ? memory.value.slice(0, 80) + '…' : memory.value,
                }}
                components={{ strong: <strong /> }}
              />
            </Label>
          }
          selection={{
            selectHandler: confirmDelete,
            selectClasses:
              'bg-red-700 dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-800 text-white',
            selectText: localize('com_ui_delete'),
          }}
        />
      </OGDialog>

      {/* Overflow menu (Copy) */}
      <Ariakit.MenuProvider placement="bottom-end">
        <TooltipAnchor
          description={localize('com_ui_more_options')}
          side="top"
          render={
            <Ariakit.MenuButton
              className={buttonBaseClass}
              aria-label={localize('com_ui_more_options')}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </Ariakit.MenuButton>
          }
        />
        <Ariakit.Menu
          gutter={4}
          portal
          className="z-50 min-w-[8rem] rounded-lg border border-border-light bg-surface-secondary p-1 shadow-lg focus:outline-none"
        >
          <Ariakit.MenuItem
            onClick={handleCopy}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-primary outline-none data-[active-item]:bg-surface-tertiary"
          >
            <Copy className="size-3.5" aria-hidden="true" />
            {localize('com_ui_copy')}
          </Ariakit.MenuItem>
        </Ariakit.Menu>
      </Ariakit.MenuProvider>
    </div>
  );
}
