import { useState } from 'react';
import { OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import { AlertCircleIcon } from '~/components/svg/NashMemoriesIcons';
import type { ScopedMemory } from './types';
import type { BookmarkView } from '~/components/SidePanel/Bookmarks/BookmarkControls';
import { useUpdateMemoryMutation } from '~/data-provider';
import MemoryCardActions from './MemoryCardActions';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MemoryCardProps {
  memory: ScopedMemory;
  hasUpdateAccess: boolean;
  view?: BookmarkView;
}

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export default function MemoryCard({ memory, hasUpdateAccess, view = 'list' }: MemoryCardProps) {
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
      /* §1: tokens, not four inline hexes. */
      <div className="flex flex-col gap-2 rounded-[13px] border border-border-destructive bg-surface-destructive-subtle p-4">
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
            className="flex h-7 items-center rounded-[7px] border border-border-destructive px-3 text-[12px] font-medium leading-[18px] text-text-destructive transition-colors hover:bg-black/5 dark:hover:bg-white/5"
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
        /* §3: a card is radius 13 with 16 of padding and one 12px gap — the
           Bookmarks folder card's geometry, which every card in the app now
           shares. This was radius 12 on lopsided padding with two inline hexes
           for its border. */
        'nash-card flex flex-col gap-2.5 rounded-[13px] p-4 transition-colors',
      )}
    >
      {/* The memory itself, first and in --t1. The card used to lead with
          "1 token · Aug 21 · Global" in the loudest position and put the fact
          you actually saved underneath in --t2 — the metadata was the headline
          and the content was the footnote. */}
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            'min-w-0 text-[13.5px] leading-[20.9px] text-text-primary',
            /* A fixed three-line box in a grid, not "up to three lines": with
               `line-clamp` alone a one-word memory made a short card and a long
               one made a tall card, so a page of them was a ragged staircase.
               The height is the same whatever the text; only how much of it
               you see changes. */
            view === 'grid' ? 'line-clamp-3 h-[63px]' : 'truncate',
          )}
        >
          {memory.value}
        </p>
        {hasUpdateAccess && !isEditing && (
          <div className="-mr-1 -mt-1 shrink-0">
            <MemoryCardActions
              memory={memory}
              onEdit={startEdit}
              onDeleteError={(retry) => setDeleteRetry(() => retry)}
            />
          </div>
        )}
      </div>

      {/* Then where it applies and when — quiet, and in that order: the scope
          is the one thing that differs between otherwise identical rows. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-[18px] text-text-tertiary">
        <span className="inline-flex min-w-0 shrink items-center rounded-[6px] bg-surface-active px-2 py-[3px] text-[11px] font-medium leading-[16px] text-text-secondary">
          <span className="truncate">
            {memory.scope === 'workspace'
              ? (memory.folderName ?? localize('com_ui_memory_scope_workspace'))
              : localize('com_ui_memory_scope_global')}
          </span>
        </span>
        <span className="shrink-0">{formatDate(memory.updated_at)}</span>
        {memory.tokenCount !== undefined && (
          <>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {memory.tokenCount}{' '}
              {localize(memory.tokenCount === 1 ? 'com_ui_token' : 'com_ui_tokens')}
            </span>
          </>
        )}
      </div>

      <OGDialog open={isEditing} onOpenChange={(open) => (open ? undefined : cancelEdit())}>
        <OGDialogTemplate
          title={localize('com_ui_edit_memory')}
          className="w-11/12 max-w-[520px]"
          main={
            <textarea
              value={draft}
              autoFocus
              rows={8}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label={localize('com_ui_edit_memory')}
              /* Fixed height, scrolls. §6: a box that grows as you type moves
                 the buttons under your cursor while you are still writing, and
                 the resize grip in the corner was a second way to do the same
                 thing. */
              className="h-[220px] w-full resize-none overflow-y-auto rounded-[10px] border-0 bg-surface-secondary p-3 text-[13px] leading-[20px] text-text-primary focus:outline-none"
            />
          }
          selection={{
            selectHandler: saveEdit,
            selectClasses: 'bg-text-primary text-surface-primary hover:opacity-90',
            selectText: localize('com_ui_save'),
            isLoading: isSaving,
            /* §11: a form's primary stays disabled until the form is valid —
               here, until the value has actually changed. */
            disabled: !canSave,
          }}
        />
      </OGDialog>
    </div>
  );
}
