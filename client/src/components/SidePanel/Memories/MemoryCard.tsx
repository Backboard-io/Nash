import { useState } from 'react';
import { Spinner, useToastContext } from '@librechat/client';
import { AlertCircleIcon } from '~/components/svg/NashMemoriesIcons';
import type { TUserMemory } from 'librechat-data-provider';
import { useUpdateMemoryMutation } from '~/data-provider';
import MemoryCardActions from './MemoryCardActions';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MemoryCardProps {
  memory: TUserMemory;
  hasUpdateAccess: boolean;
}

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export default function MemoryCard({ memory, hasUpdateAccess }: MemoryCardProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(memory.value);
  const [deleteRetry, setDeleteRetry] = useState<null | (() => void)>(null);

  const { mutate: updateMemory, isLoading: isSaving } = useUpdateMemoryMutation();

  const startEdit = () => {
    setDraft(memory.value);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraft(memory.value);
    setIsEditing(false);
  };

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && trimmed !== memory.value && !isSaving;

  const saveEdit = () => {
    if (!canSave) {
      return;
    }
    updateMemory(
      { key: memory.key, value: trimmed },
      {
        onSuccess: () => {
          showToast({ message: localize('com_ui_saved'), status: 'success' });
          setIsEditing(false);
        },
        onError: () => {
          showToast({ message: localize('com_ui_error'), status: 'error' });
        },
      },
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

  if (deleteRetry) {
    return (
      <div className="flex flex-col gap-2 rounded-[12px] border border-[#F4A0AE] bg-[#FDE8EF] pb-[14px] pl-[18px] pr-4 pt-[14px] dark:border-[#8B2238] dark:bg-[#2D1520]">
        <div className="flex items-center gap-2">
          <AlertCircleIcon size={15} className="shrink-0 text-text-destructive" />
          <span className="text-[12.5px] font-medium leading-[18.75px] text-text-destructive">
            {localize('com_ui_memory_delete_failed')}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              const retry = deleteRetry;
              setDeleteRetry(null);
              retry();
            }}
            className="flex h-7 items-center rounded-[7px] border border-[#F4A0AE] px-3 text-[12px] font-medium leading-[18px] text-text-destructive transition-colors hover:bg-black/5 dark:border-[#8B2238] dark:hover:bg-white/5"
          >
            {localize('com_ui_retry')}
          </button>
          <button
            type="button"
            onClick={() => setDeleteRetry(null)}
            className="flex h-7 items-center rounded-[7px] px-2.5 text-[12px] leading-[18px] text-text-destructive transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            {localize('com_ui_dismiss')}
          </button>
        </div>
        <p className="truncate text-[13px] font-light leading-[20.1px] text-text-destructive opacity-75">
          {memory.value}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-[12px] border border-[#E7E8EA] bg-surface-secondary pb-4 pl-5 pr-4 pt-4 transition-colors dark:border-[#181A1E]',
        !isEditing && 'hover:border-border-medium',
      )}
    >
      {/* Row 1: Metadata + Actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] leading-[18px] text-text-secondary-alt">
          {memory.tokenCount !== undefined && (
            <>
              <span className="shrink-0 font-medium">
                {memory.tokenCount}{' '}
                {localize(memory.tokenCount === 1 ? 'com_ui_token' : 'com_ui_tokens')}
              </span>
              <span aria-hidden="true" className="text-text-tertiary">·</span>
            </>
          )}
          <span className="shrink-0">{formatDate(memory.updated_at)}</span>
          <span aria-hidden="true" className="text-text-tertiary">·</span>
          <span className="inline-flex shrink-0 items-center rounded-[5px] bg-brand-purple px-2 py-[3px] text-[10.5px] font-medium leading-none text-white">
            {localize('com_ui_memory_scope_global')}
          </span>
        </div>
        {hasUpdateAccess && !isEditing && (
          <div className="shrink-0">
            <MemoryCardActions memory={memory} onEdit={startEdit} onDeleteError={(retry) => setDeleteRetry(() => retry)} />
          </div>
        )}
      </div>

      {/* Row 2: Value (view) or Editor (edit) */}
      {isEditing ? (
        <div>
          <textarea
            value={draft}
            autoFocus
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={localize('com_ui_edit_memory')}
            className="w-full resize-y rounded-lg border border-border-medium bg-surface-primary p-2.5 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={saveEdit}
              disabled={!canSave}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-purple px-3 py-1.5 text-sm font-medium text-brand-purple-foreground transition-colors hover:bg-brand-purple-hover active:bg-brand-purple-pressed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {isSaving && <Spinner className="size-3.5" />}
              {localize('com_ui_save')}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={isSaving}
              className="inline-flex items-center justify-center rounded-lg bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {localize('com_ui_cancel')}
            </button>
          </div>
        </div>
      ) : (
        <p className="truncate text-[13.5px] font-light leading-[20.9px] text-text-secondary">
          {memory.value}
        </p>
      )}
    </div>
  );
}
