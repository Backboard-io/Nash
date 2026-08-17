import { useEffect, useId, useState } from 'react';
import {
  Spinner,
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { TConversationTag } from 'librechat-data-provider';
import { useConversationTagMutation } from '~/data-provider';
import { useBookmarkContext } from '~/Providers/BookmarkContext';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

interface EditBookmarkDialogProps {
  bookmark: TConversationTag;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Edit Bookmark" modal (Figma frame 54). Real-fields-only: edits the tag
 * (Title) and description (Note). The Figma's Tags chips are omitted because a
 * conversation tag has no sub-tags in the data model.
 */
export default function EditBookmarkDialog({
  bookmark,
  open,
  onOpenChange,
}: EditBookmarkDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { bookmarks } = useBookmarkContext();

  const [draftTag, setDraftTag] = useState(bookmark.tag);
  const [draftDescription, setDraftDescription] = useState(bookmark.description ?? '');

  // Stable per-instance field ids. The Flask /api/tags payload carries no `_id`,
  // so deriving ids from `bookmark._id` would yield `…-undefined` for every card.
  const fieldId = useId();
  const titleId = `edit-bookmark-title-${fieldId}`;
  const noteId = `edit-bookmark-note-${fieldId}`;

  const mutation = useConversationTagMutation({
    context: 'EditBookmarkDialog',
    tag: bookmark.tag,
    options: {
      onSuccess: () => {
        showToast({ message: localize('com_ui_saved'), status: 'success' });
        onOpenChange(false);
      },
      onError: () => {
        showToast({
          message: localize('com_ui_bookmarks_update_error'),
          severity: NotificationSeverity.ERROR,
        });
      },
    },
  });
  const isSaving = mutation.isLoading;

  // Reset drafts whenever the dialog (re)opens or the underlying bookmark changes.
  useEffect(() => {
    if (open) {
      setDraftTag(bookmark.tag);
      setDraftDescription(bookmark.description ?? '');
    }
  }, [open, bookmark.tag, bookmark.description]);

  const trimmedTag = draftTag.trim();
  const trimmedDescription = draftDescription.trim();
  const hasChanges =
    trimmedTag !== bookmark.tag || trimmedDescription !== (bookmark.description ?? '');
  const isDuplicate = bookmarks.some((b) => b.tag === trimmedTag && b.tag !== bookmark.tag);
  const canSave = trimmedTag.length > 0 && hasChanges && !isDuplicate && !isSaving;

  const saveEdit = () => {
    if (!canSave) {
      return;
    }
    mutation.mutate({ tag: trimmedTag, description: trimmedDescription });
  };

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveEdit();
    }
  };

  const handleDescriptionKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveEdit();
    }
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton>
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_bookmarks_edit')}</OGDialogTitle>
        </OGDialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor={titleId}
              className="block text-xs font-medium text-text-secondary"
            >
              {localize('com_ui_bookmarks_title')}
            </label>
            <input
              id={titleId}
              type="text"
              value={draftTag}
              autoFocus
              maxLength={128}
              onChange={(e) => setDraftTag(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              aria-label={localize('com_ui_bookmarks_title')}
              className="h-10 w-full rounded-lg border border-border-medium bg-surface-primary px-3 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={noteId}
              className="block text-xs font-medium text-text-secondary"
            >
              {localize('com_ui_bookmarks_note')}
            </label>
            <textarea
              id={noteId}
              value={draftDescription}
              rows={4}
              maxLength={1048}
              onChange={(e) => setDraftDescription(e.target.value)}
              onKeyDown={handleDescriptionKeyDown}
              aria-label={localize('com_ui_bookmarks_note')}
              className="w-full resize-y rounded-lg border border-border-medium bg-surface-primary p-3 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {isDuplicate && (
            <p role="alert" className="text-xs text-rose-500">
              {localize('com_ui_bookmarks_tag_exists')}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={saveEdit}
              disabled={!canSave}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-purple px-4 py-2 text-sm font-medium text-brand-purple-foreground transition-colors hover:bg-brand-purple-hover active:bg-brand-purple-pressed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {isSaving && <Spinner className="size-3.5" />}
              {isSaving ? localize('com_ui_saving') : localize('com_ui_save')}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              className="inline-flex items-center justify-center rounded-lg bg-surface-tertiary px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {localize('com_ui_cancel')}
            </button>
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
