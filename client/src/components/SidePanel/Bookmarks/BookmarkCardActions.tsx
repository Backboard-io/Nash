import { useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Pencil, Copy, MoreHorizontal, MessageSquare } from 'lucide-react';
import { Trans } from 'react-i18next';
import {
  Label,
  Spinner,
  OGDialog,
  TrashIcon,
  TooltipAnchor,
  OGDialogTrigger,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TConversationTag } from 'librechat-data-provider';
import { useDeleteConversationTagMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface BookmarkCardActionsProps {
  bookmark: TConversationTag;
  onEdit: () => void;
  onView: () => void;
}

export default function BookmarkCardActions({
  bookmark,
  onEdit,
  onView,
}: BookmarkCardActionsProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteBookmarkMutation = useDeleteConversationTagMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_bookmark_removed') });
      setDeleteOpen(false);
    },
    onError: () => {
      showToast({
        message: localize('com_ui_bookmarks_delete_error'),
        severity: NotificationSeverity.ERROR,
      });
    },
  });

  const isDeleting = deleteBookmarkMutation.isLoading;

  const buttonBaseClass = cn(
    'flex size-7 items-center justify-center rounded-md',
    'transition-colors duration-150',
    'text-text-secondary hover:text-text-primary',
    'hover:bg-surface-tertiary',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy',
  );

  const confirmDelete = () => {
    deleteBookmarkMutation.mutate(bookmark.tag);
  };

  const handleCopy = async () => {
    try {
      const text = bookmark.description
        ? `${bookmark.tag}\n${bookmark.description}`
        : bookmark.tag;
      await navigator.clipboard.writeText(text);
      showToast({ message: localize('com_ui_copied'), status: 'success' });
    } catch {
      showToast({ message: localize('com_ui_error'), status: 'error' });
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      {/* Edit */}
      <TooltipAnchor
        description={localize('com_ui_bookmarks_edit')}
        side="top"
        render={
          <button
            className={buttonBaseClass}
            aria-label={localize('com_ui_bookmarks_edit')}
            onClick={onEdit}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </button>
        }
      />

      {/* Copy */}
      <TooltipAnchor
        description={localize('com_ui_copy')}
        side="top"
        render={
          <button
            className={buttonBaseClass}
            aria-label={localize('com_ui_copy')}
            onClick={handleCopy}
          >
            <Copy className="size-3.5" aria-hidden="true" />
          </button>
        }
      />

      {/* Delete */}
      <OGDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <OGDialogTrigger asChild>
          <TooltipAnchor
            description={localize('com_ui_bookmarks_delete')}
            side="top"
            render={
              <button
                className={buttonBaseClass}
                aria-label={localize('com_ui_bookmarks_delete')}
                onClick={() => setDeleteOpen(true)}
              >
                {isDeleting ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <TrashIcon className="size-3.5" aria-hidden="true" />
                )}
              </button>
            }
          />
        </OGDialogTrigger>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_ui_bookmarks_delete')}
          className="w-11/12 max-w-lg"
          main={
            <Label className="text-left text-sm font-medium">
              <Trans
                i18nKey="com_ui_delete_confirm_strong"
                values={{ title: bookmark.tag }}
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

      {/* Overflow menu — holds the bookmark's primary "view conversations"
          action, which is otherwise only reachable by clicking the card body. */}
      <Ariakit.MenuProvider placement="bottom-end">
        <TooltipAnchor
          description={localize('com_ui_more_options')}
          side="top"
          render={
            <Ariakit.MenuButton
              className={buttonBaseClass}
              aria-label={localize('com_ui_more_options')}
            >
              <MoreHorizontal className="size-3.5" aria-hidden="true" />
            </Ariakit.MenuButton>
          }
        />
        <Ariakit.Menu
          gutter={4}
          portal
          className="z-50 min-w-[10rem] rounded-lg border border-border-light bg-surface-secondary p-1 shadow-lg focus:outline-none"
        >
          <Ariakit.MenuItem
            onClick={onView}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-primary outline-none data-[active-item]:bg-surface-tertiary"
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {localize('com_ui_bookmark_view_conversations')}
          </Ariakit.MenuItem>
        </Ariakit.Menu>
      </Ariakit.MenuProvider>
    </div>
  );
}
