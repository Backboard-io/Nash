import { useState, useId, useRef, memo, useCallback, useMemo } from 'react';
import * as Ariakit from '@ariakit/react';
import { useParams, useNavigate } from 'react-router-dom';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { DropdownPopup, Spinner, useToastContext } from '@librechat/client';
import {
  Ellipsis,
  Share2,
  CopyPlus,
  Archive,
  Pen,
  Trash,
  FolderInput,
  FolderMinus,
  Pin,
  PinOff,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import type { TMessage } from 'librechat-data-provider';
import {
  useDuplicateConversationMutation,
  useDeleteConversationMutation,
  useUpdateConversationMutation,
  useGetStartupConfig,
  useArchiveConvoMutation,
  useFoldersQuery,
  useMoveConvoToFolderMutation,
} from '~/data-provider';
import { useLocalize, useNavigateToConvo, useNewConvo } from '~/hooks';
import { NotificationSeverity } from '~/common';
import { useChatContext } from '~/Providers';
import DeleteButton from './DeleteButton';
import ShareButton from './ShareButton';
import { cn } from '~/utils';

function ConvoOptions({
  conversationId,
  title,
  retainView,
  renameHandler,
  isPopoverActive,
  setIsPopoverActive,
  isActiveConvo,
  isPinned = false,
  isShiftHeld = false,
  folderId = null,
}: {
  conversationId: string | null;
  title: string | null;
  retainView: () => void;
  renameHandler: (e: MouseEvent) => void;
  isPopoverActive: boolean;
  setIsPopoverActive: (open: boolean) => void;
  isActiveConvo: boolean;
  isPinned?: boolean;
  isShiftHeld?: boolean;
  folderId?: string | null;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { index } = useChatContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { navigateToConvo } = useNavigateToConvo(index);
  const { showToast } = useToastContext();

  const navigate = useNavigate();
  const { conversationId: currentConvoId } = useParams();
  const { newConversation } = useNewConvo();

  const menuId = useId();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  /* §13 "Flyouts from the sidebar": chat row menu is
     left: panel.right + 10, top: trigger.top - 8, position fixed — the
     sidebar clips its own overflow, so an absolutely-positioned menu would
     be cut off at the panel edge. */
  const [dropDirection, setDropDirection] = useState<'beside' | 'down'>('beside');

  const getMenuAnchorRect = useCallback(() => {
    const trigger = menuTriggerRef.current?.getBoundingClientRect();
    if (!trigger) {
      return null;
    }
    const panel = document.getElementById('chat-history-nav')?.getBoundingClientRect();
    const panelRight = panel?.right ?? trigger.right;

    /* Horizontal fallback: on a phone the drawer owns the width, so the menu
       drops below the trigger and travels down instead of sideways. */
    if (panelRight + 206 > window.innerWidth) {
      setDropDirection('down');
      return { x: trigger.left, y: trigger.bottom + 8, width: 0, height: 0 };
    }
    setDropDirection('beside');

    /* Clamped so a row near the bottom cannot push the menu off screen. */
    const top = Math.min(trigger.top - 8, window.innerHeight - 240 - 16);
    return { x: panelRight + 10, y: Math.max(16, top), width: 0, height: 0 };
  }, []);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const archiveConvoMutation = useArchiveConvoMutation();

  const deleteMutation = useDeleteConversationMutation({
    onSuccess: () => {
      if (currentConvoId === conversationId || currentConvoId === 'new') {
        newConversation();
        navigate('/c/new', { replace: true });
      }
      retainView();
      showToast({
        message: localize('com_ui_convo_delete_success'),
        severity: NotificationSeverity.SUCCESS,
        showIcon: true,
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_convo_delete_error'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    },
  });

  const duplicateConversation = useDuplicateConversationMutation({
    onSuccess: (data) => {
      navigateToConvo(data.conversation);
      showToast({
        message: localize('com_ui_duplication_success'),
        status: 'success',
      });
      setIsPopoverActive(false);
    },
    onMutate: () => {
      showToast({
        message: localize('com_ui_duplication_processing'),
        status: 'info',
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_duplication_error'),
        status: 'error',
      });
    },
  });

  const { data: folders } = useFoldersQuery();
  const moveToFolderMutation = useMoveConvoToFolderMutation({
    onSuccess: () => {
      showToast({ message: 'Conversation moved', status: 'success' });
      setIsPopoverActive(false);
    },
  });

  const updateConvoMutation = useUpdateConversationMutation(conversationId ?? '');

  const isDuplicateLoading = duplicateConversation.isLoading;
  const isArchiveLoading = archiveConvoMutation.isLoading;
  const isDeleteLoading = deleteMutation.isLoading;

  const shareHandler = useCallback(() => {
    setShowShareDialog(true);
  }, []);

  const deleteHandler = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);

  const handleInstantDelete = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      const convoId = conversationId ?? '';
      if (!convoId) {
        return;
      }
      const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, convoId]);
      const thread_id = messages?.[messages.length - 1]?.thread_id;
      const endpoint = messages?.[messages.length - 1]?.endpoint;
      deleteMutation.mutate({ conversationId: convoId, thread_id, endpoint, source: 'button' });
    },
    [conversationId, deleteMutation, queryClient],
  );

  const handleArchiveClick = useCallback(
    async (e?: MouseEvent) => {
      e?.stopPropagation();
      const convoId = conversationId ?? '';
      if (!convoId) {
        return;
      }

      archiveConvoMutation.mutate(
        { conversationId: convoId, isArchived: true },
        {
          onSuccess: () => {
            setAnnouncement(localize('com_ui_convo_archived'));
            setTimeout(() => {
              setAnnouncement('');
            }, 10000);
            if (currentConvoId === convoId || currentConvoId === 'new') {
              newConversation();
              navigate('/c/new', { replace: true });
            }
            retainView();
            setIsPopoverActive(false);
          },
          onError: () => {
            showToast({
              message: localize('com_ui_archive_error'),
              severity: NotificationSeverity.ERROR,
              showIcon: true,
            });
          },
        },
      );
    },
    [
      conversationId,
      currentConvoId,
      archiveConvoMutation,
      navigate,
      newConversation,
      retainView,
      setIsPopoverActive,
      showToast,
      localize,
    ],
  );

  const handleDuplicateClick = useCallback(() => {
    duplicateConversation.mutate({
      conversationId: conversationId ?? '',
    });
  }, [conversationId, duplicateConversation]);

  const handlePinClick = useCallback(() => {
    const convoId = conversationId ?? '';
    if (!convoId) {
      return;
    }
    updateConvoMutation.mutate(
      { conversationId: convoId, isPinned: !isPinned },
      {
        onSuccess: () => {
          setIsPopoverActive(false);
        },
        onError: () => {
          showToast({
            message: localize('com_ui_error'),
            severity: NotificationSeverity.ERROR,
            showIcon: true,
          });
        },
      },
    );
  }, [conversationId, isPinned, updateConvoMutation, setIsPopoverActive, showToast, localize]);

  const folderItems = useMemo(() => {
    if (!folders?.length) {
      return [];
    }
    const isInFolder = folderId != null && folderId !== '';
    const items = folders
      .filter((folder) => folder.folderId !== folderId)
      .map((folder) => ({
        label: folder.name,
        onClick: () => {
          if (conversationId) {
            moveToFolderMutation.mutate({ conversationId, folderId: folder.folderId });
          }
        },
        icon: <FolderInput className="icon-sm mr-2" aria-hidden="true" />,
      }));
    if (isInFolder) {
      items.push({
        label: localize('com_folder_remove'),
        onClick: () => {
          if (conversationId) {
            moveToFolderMutation.mutate({ conversationId, folderId: null });
          }
        },
        icon: <FolderMinus className="icon-sm mr-2" aria-hidden="true" />,
      });
    }
    return items;
  }, [folders, folderId, conversationId, moveToFolderMutation, localize]);

  const dropdownItems = useMemo(
    () => [
      {
        label: localize('com_ui_share'),
        onClick: shareHandler,
        icon: <Share2 className="icon-sm mr-2" aria-hidden="true" />,
        show: startupConfig && startupConfig.sharedLinksEnabled,
        ariaHasPopup: 'dialog' as const,
        ariaControls: 'share-conversation-dialog',
        /** NOTE: THE FOLLOWING PROPS ARE REQUIRED FOR MENU ITEMS THAT OPEN DIALOGS */
        hideOnClick: false,
        ref: shareButtonRef,
        render: (props) => <button {...props} />,
      },
      {
        label: localize('com_ui_rename'),
        onClick: renameHandler,
        icon: <Pen className="icon-sm mr-2" aria-hidden="true" />,
      },
      {
        label: localize('com_ui_duplicate'),
        onClick: handleDuplicateClick,
        hideOnClick: false,
        icon: isDuplicateLoading ? (
          <Spinner className="size-4" />
        ) : (
          <CopyPlus className="icon-sm mr-2" aria-hidden="true" />
        ),
      },
      ...(folderItems.length > 0
        ? [
          {
            label: localize('com_folder_move_to'),
            onClick: () => {},
            icon: <FolderInput className="icon-sm mr-2" aria-hidden="true" />,
            subItems: folderItems,
          },
        ]
        : []),
      {
        label: isPinned ? localize('com_ui_unpin') : localize('com_ui_pin'),
        onClick: handlePinClick,
        hideOnClick: false,
        icon: isPinned ? (
          <PinOff className="icon-sm mr-2" aria-hidden="true" />
        ) : (
          <Pin className="icon-sm mr-2" aria-hidden="true" />
        ),
      },
      {
        label: localize('com_ui_archive'),
        onClick: handleArchiveClick,
        hideOnClick: false,
        icon: isArchiveLoading ? (
          <Spinner className="size-4" />
        ) : (
          <Archive className="icon-sm mr-2" aria-hidden="true" />
        ),
      },
      {
        label: localize('com_ui_delete'),
        onClick: deleteHandler,
        icon: <Trash className="icon-sm mr-2" aria-hidden="true" />,
        ariaHasPopup: 'dialog' as const,
        ariaControls: 'delete-conversation-dialog',
        /** NOTE: THE FOLLOWING PROPS ARE REQUIRED FOR MENU ITEMS THAT OPEN DIALOGS */
        hideOnClick: false,
        ref: deleteButtonRef,
        render: (props) => <button {...props} />,
      },
    ],
    [
      localize,
      shareHandler,
      startupConfig,
      renameHandler,
      deleteHandler,
      folderItems,
      isPinned,
      isArchiveLoading,
      isDuplicateLoading,
      handleArchiveClick,
      handleDuplicateClick,
      handlePinClick,
    ],
  );

  const buttonClassName = cn(
    'inline-flex h-6 w-6 items-center justify-center rounded-[6px] border-none p-0 text-sm font-medium ring-ring-primary transition-all duration-hover ease-nash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50',
    isActiveConvo === true || isPopoverActive
      ? 'opacity-100'
      : 'opacity-0 focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[open]:opacity-100',
  );

  if (isShiftHeld && isActiveConvo && !isPopoverActive && !showShareDialog && !showDeleteDialog) {
    return (
      <div className="flex items-center gap-0.5">
        <button
          aria-label={localize('com_ui_archive')}
          className={cn(buttonClassName, 'hover:bg-surface-hover')}
          onClick={handleArchiveClick}
          disabled={isArchiveLoading}
        >
          {isArchiveLoading ? (
            <Spinner className="size-3.5" />
          ) : (
            <Archive className="h-3.5 w-3.5 text-text-secondary" aria-hidden={true} />
          )}
        </button>
        <button
          aria-label={localize('com_ui_delete')}
          className={cn(buttonClassName, 'hover:bg-surface-hover')}
          onClick={handleInstantDelete}
          disabled={isDeleteLoading}
        >
          {isDeleteLoading ? (
            <Spinner className="size-3.5" />
          ) : (
            <Trash className="h-3.5 w-3.5 text-text-secondary" aria-hidden={true} />
          )}
        </button>
      </div>
    );
  }

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <DropdownPopup
        portal={true}
        menuId={menuId}
        focusLoop={true}
        /* §13: 206 wide, measured from the PANEL's right edge, never the
           trigger's — the trigger is inset, so anchoring to it puts the menu
           back on top of the sidebar. A zero-width anchor at the target point
           with placement right-start and no gutter lands it exactly. */
        className={cn(
          'z-[125] w-[206px] rounded-[14px] !border-0 p-1.5',
          'nash-menu',
          dropDirection === 'down' ? 'animate-popover' : 'nash-flyout',
        )}
        /* Rows sit back in the secondary tone and lift to primary on hover,
           matching the Library / Memories / MCP flyout. */
        itemClassName="gap-[11px] rounded-[9px] px-[10px] py-[9px] text-[13px] font-normal text-text-secondary hover:bg-surface-active hover:text-text-primary focus:bg-surface-active focus:text-text-primary"
        iconClassName="text-text-tertiary"
        placement={dropDirection === 'down' ? 'bottom-start' : 'right-start'}
        gutter={0}
        getAnchorRect={getMenuAnchorRect}
        unmountOnHide={true}
        isOpen={isPopoverActive}
        setIsOpen={setIsPopoverActive}
        trigger={
          <Ariakit.MenuButton
            ref={menuTriggerRef}
            id={`conversation-menu-${conversationId}`}
            aria-label={localize('com_nav_convo_menu_options')}
            aria-expanded={isPopoverActive}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center gap-2 rounded-[6px] border-none p-0 text-sm font-medium ring-ring-primary transition-all duration-hover ease-nash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50',
              isActiveConvo === true || isPopoverActive
                ? 'opacity-100'
                : 'opacity-0 focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[open]:opacity-100',
            )}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLButtonElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
              }
            }}
          >
            <Ellipsis className="h-3.5 w-3.5 text-text-secondary" aria-hidden={true} />
          </Ariakit.MenuButton>
        }
        items={dropdownItems}
      />
      {showShareDialog && (
        <ShareButton
          conversationId={conversationId ?? ''}
          open={showShareDialog}
          onOpenChange={setShowShareDialog}
          triggerRef={shareButtonRef}
        />
      )}
      {showDeleteDialog && (
        <DeleteButton
          title={title ?? ''}
          retainView={retainView}
          triggerRef={deleteButtonRef}
          setMenuOpen={setIsPopoverActive}
          showDeleteDialog={showDeleteDialog}
          conversationId={conversationId ?? ''}
          setShowDeleteDialog={setShowDeleteDialog}
        />
      )}
    </>
  );
}

export default memo(ConvoOptions, (prevProps, nextProps) => {
  return (
    prevProps.conversationId === nextProps.conversationId &&
    prevProps.title === nextProps.title &&
    prevProps.isPopoverActive === nextProps.isPopoverActive &&
    prevProps.isActiveConvo === nextProps.isActiveConvo &&
    prevProps.isPinned === nextProps.isPinned &&
    prevProps.isShiftHeld === nextProps.isShiftHeld &&
    prevProps.folderId === nextProps.folderId
  );
});
