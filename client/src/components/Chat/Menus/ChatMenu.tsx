import { useState, useId, useRef, useCallback, useMemo } from 'react';
import * as Ariakit from '@ariakit/react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Ellipsis,
  CopyPlus,
  Archive,
  Pen,
  Trash,
  FolderInput,
  FolderMinus,
  Pin,
  PinOff,
  PlusCircle,
  Bookmark,
  BookmarkPlus,
} from 'lucide-react';
import { BookmarkFilledIcon, BookmarkIcon } from '@radix-ui/react-icons';
import type { MouseEvent } from 'react';
import { QueryKeys, isAssistantsEndpoint } from 'librechat-data-provider';
import type {
  TConversation,
  TConversationTag,
  TTagConversationResponse,
} from 'librechat-data-provider';
import type * as t from '~/common';
import { DropdownPopup, Spinner, TooltipAnchor, useToastContext } from '@librechat/client';
import {
  useDuplicateConversationMutation,
  useUpdateConversationMutation,
  useArchiveConvoMutation,
  useConversationTagsQuery,
  useTagConversationMutation,
  useFoldersQuery,
  useMoveConvoToFolderMutation,
} from '~/data-provider';
import DeleteButton from '~/components/Conversations/ConvoOptions/DeleteButton';
import { BookmarkEditDialog } from '~/components/Bookmarks';
import { BookmarkContext } from '~/Providers/BookmarkContext';
import { useChatContext, useAddedChatContext } from '~/Providers';
import { useLocalize, useNavigateToConvo, useNewConvo, useBookmarkSuccess } from '~/hooks';
import { NotificationSeverity, mainTextareaId } from '~/common';

/**
 * Header "⋯" overflow menu for the active conversation. Owns the conversation
 * actions (Rename, Duplicate, Pin, folder add/remove, Archive, Delete) plus the
 * controls that used to live as standalone header buttons: Bookmarks and the
 * multi-conversation (split view) action. Share/Export items are injected by
 * Header via `prependItems`.
 */
export default function ChatMenu({
  renameHandler,
  hasAccessToBookmarks = false,
  hasAccessToMultiConvo = false,
  prependItems,
}: {
  renameHandler: () => void;
  hasAccessToBookmarks?: boolean;
  hasAccessToMultiConvo?: boolean;
  prependItems?: t.MenuItemProps[];
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const { conversation, index } = useChatContext();
  const { setConversation: setAddedConvo } = useAddedChatContext();
  const { navigateToConvo } = useNavigateToConvo(index);
  const { newConversation } = useNewConvo();

  const menuId = useId();
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const newBookmarkRef = useRef<HTMLButtonElement>(null);
  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBookmarkDialog, setShowBookmarkDialog] = useState(false);

  const conversationId = conversation?.conversationId ?? null;
  const title = conversation?.title ?? '';
  const isPinned = conversation?.isPinned ?? false;
  const folderId = conversation?.folderId ?? null;
  const isInFolder = folderId != null && folderId !== '';
  const isTemporary = conversation?.expiredAt != null;
  const tagsList = Array.isArray(conversation?.tags) ? conversation.tags : [];

  const isReal =
    conversationId != null && conversationId !== 'new' && conversationId !== 'search';

  const { data: folders } = useFoldersQuery();
  const { data: allBookmarks } = useConversationTagsQuery();
  const updateConvoTags = useBookmarkSuccess(conversationId ?? '');

  const moveToFolderMutation = useMoveConvoToFolderMutation({
    onSuccess: () => {
      setIsPopoverActive(false);
    },
  });

  const updateConvoMutation = useUpdateConversationMutation(conversationId ?? '');
  const archiveConvoMutation = useArchiveConvoMutation();
  const tagMutation = useTagConversationMutation(conversationId ?? '', {
    onSuccess: (data: TTagConversationResponse | { tags?: string[] }) => {
      const newTags = Array.isArray(data) ? data : (data?.tags ?? []);
      updateConvoTags(newTags);
    },
    onError: () => {
      showToast({
        message: localize('com_ui_error'),
        severity: NotificationSeverity.ERROR,
      });
    },
  });
  const duplicateConversation = useDuplicateConversationMutation({
    onSuccess: (data) => {
      navigateToConvo(data.conversation);
      showToast({ message: localize('com_ui_duplication_success'), status: 'success' });
      setIsPopoverActive(false);
    },
    onMutate: () => {
      showToast({ message: localize('com_ui_duplication_processing'), status: 'info' });
    },
    onError: () => {
      showToast({ message: localize('com_ui_duplication_error'), status: 'error' });
    },
  });

  const isDuplicateLoading = duplicateConversation.isLoading;
  const isArchiveLoading = archiveConvoMutation.isLoading;

  const folderName = useMemo(
    () => folders?.find((folder) => folder.folderId === folderId)?.name ?? '',
    [folders, folderId],
  );

  const handleDuplicateClick = useCallback(() => {
    duplicateConversation.mutate({ conversationId: conversationId ?? '' });
  }, [conversationId, duplicateConversation]);

  const handlePinClick = useCallback(() => {
    if (!conversationId) {
      return;
    }
    updateConvoMutation.mutate(
      { conversationId, isPinned: !isPinned },
      {
        onSuccess: () => setIsPopoverActive(false),
        onError: () => {
          showToast({
            message: localize('com_ui_error'),
            severity: NotificationSeverity.ERROR,
            showIcon: true,
          });
        },
      },
    );
  }, [conversationId, isPinned, updateConvoMutation, showToast, localize]);

  const handleArchiveClick = useCallback(() => {
    if (!conversationId) {
      return;
    }
    archiveConvoMutation.mutate(
      { conversationId, isArchived: true },
      {
        onSuccess: () => {
          setIsPopoverActive(false);
          newConversation();
          navigate('/c/new', { replace: true });
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
  }, [conversationId, archiveConvoMutation, newConversation, navigate, showToast, localize]);

  const handleRemoveFromFolder = useCallback(() => {
    if (conversationId) {
      moveToFolderMutation.mutate({ conversationId, folderId: null });
    }
  }, [conversationId, moveToFolderMutation]);

  const handleBookmarkToggle = useCallback(
    (tag: string) => {
      if (!tag || !conversationId) {
        return;
      }
      const allTags =
        queryClient.getQueryData<TConversationTag[]>([QueryKeys.conversationTags]) ?? [];
      const existingTags = allTags.map((t) => t.tag);
      const filteredTags = tagsList.filter((t) => existingTags.includes(t));
      const newTags = filteredTags.includes(tag)
        ? filteredTags.filter((t) => t !== tag)
        : [...filteredTags, tag];
      tagMutation.mutate({ tags: newTags, tag });
    },
    [tagsList, conversationId, tagMutation, queryClient],
  );

  const handleAddMultiConvo = useCallback(() => {
    const { title: _t, ...convo } = conversation ?? ({} as TConversation);
    setAddedConvo?.({ ...convo, title: '' } as TConversation);
    const textarea = document.getElementById(mainTextareaId);
    textarea?.focus();
  }, [conversation, setAddedConvo]);

  const folderSubItems = useMemo(() => {
    if (!folders?.length) {
      return [];
    }
    return folders
      .filter((folder) => folder.folderId !== folderId)
      .map((folder) => ({
        label: folder.name,
        onClick: () => {
          if (conversationId) {
            moveToFolderMutation.mutate({ conversationId, folderId: folder.folderId });
          }
        },
        icon: <FolderInput className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      }));
  }, [folders, folderId, conversationId, moveToFolderMutation]);

  const folderItem = useMemo(() => {
    if (isInFolder) {
      return {
        label: localize('com_folder_remove_from', { folder: folderName }),
        onClick: handleRemoveFromFolder,
        hideOnClick: false,
        icon: <FolderMinus className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      };
    }
    if (folderSubItems.length > 0) {
      return {
        label: localize('com_folder_move_to'),
        onClick: () => {},
        icon: <FolderInput className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
        subItems: folderSubItems,
      };
    }
    return null;
  }, [isInFolder, folderName, folderSubItems, handleRemoveFromFolder, localize]);

  const showBookmarks = hasAccessToBookmarks && isReal && !isTemporary;
  const showMultiConvo =
    hasAccessToMultiConvo &&
    conversation != null &&
    !isAssistantsEndpoint(conversation.endpoint);

  const bookmarkItem = useMemo<t.MenuItemProps | null>(() => {
    if (!showBookmarks) {
      return null;
    }
    const subItems: t.MenuItemProps[] = [
      {
        id: '%___new___bookmark___%',
        label: localize('com_ui_bookmarks_new'),
        icon: <BookmarkPlus className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
        hideOnClick: false,
        ref: newBookmarkRef,
        render: (props) => <button {...props} />,
        onClick: () => setShowBookmarkDialog(true),
      },
    ];
    for (const tag of allBookmarks ?? []) {
      const isSelected = tagsList.includes(tag.tag);
      subItems.push({
        id: tag.tag,
        label: tag.tag,
        hideOnClick: false,
        icon: isSelected ? (
          <BookmarkFilledIcon className="icon-sm mr-2 text-text-primary" aria-hidden="true" />
        ) : (
          <BookmarkIcon className="icon-sm mr-2 text-text-primary" aria-hidden="true" />
        ),
        onClick: () => handleBookmarkToggle(tag.tag),
        disabled: tagMutation.isLoading,
        ariaChecked: isSelected,
      });
    }
    return {
      label: localize('com_ui_bookmarks'),
      icon: <Bookmark className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      subItems,
    };
  }, [showBookmarks, allBookmarks, tagsList, tagMutation.isLoading, handleBookmarkToggle, localize]);

  const dropdownItems = useMemo(() => {
    const items: t.MenuItemProps[] = [...(prependItems ?? [])];

    if (items.length > 0 && (bookmarkItem || showMultiConvo)) {
      items.push({ separate: true });
    }
    if (bookmarkItem) {
      items.push(bookmarkItem);
    }
    if (showMultiConvo) {
      items.push({
        label: localize('com_ui_add_multi_conversation'),
        onClick: handleAddMultiConvo,
        icon: <PlusCircle className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      });
    }

    if (!isReal) {
      return items;
    }

    if (items.length > 0) {
      items.push({ separate: true });
    }

    items.push(
      {
        label: localize('com_ui_rename'),
        onClick: renameHandler,
        icon: <Pen className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      },
      {
        label: localize('com_ui_duplicate'),
        onClick: handleDuplicateClick,
        hideOnClick: false,
        icon: isDuplicateLoading ? (
          <Spinner className="size-4" />
        ) : (
          <CopyPlus className="icon-sm mr-2 text-text-primary" aria-hidden="true" />
        ),
      },
      {
        label: isPinned ? localize('com_ui_unpin') : localize('com_ui_pin'),
        onClick: handlePinClick,
        hideOnClick: false,
        icon: isPinned ? (
          <PinOff className="icon-sm mr-2 text-text-primary" aria-hidden="true" />
        ) : (
          <Pin className="icon-sm mr-2 text-text-primary" aria-hidden="true" />
        ),
      },
      ...(folderItem ? [folderItem] : []),
      {
        label: localize('com_ui_archive'),
        onClick: handleArchiveClick,
        hideOnClick: false,
        icon: isArchiveLoading ? (
          <Spinner className="size-4" />
        ) : (
          <Archive className="icon-sm mr-2 text-text-primary" aria-hidden="true" />
        ),
      },
      {
        label: localize('com_ui_delete'),
        onClick: () => setShowDeleteDialog(true),
        className: 'text-red-500',
        icon: <Trash className="icon-sm mr-2 text-red-500" aria-hidden="true" />,
        /** NOTE: THE FOLLOWING PROPS ARE REQUIRED FOR MENU ITEMS THAT OPEN DIALOGS */
        hideOnClick: false,
        ref: deleteButtonRef,
        render: (props: React.HTMLAttributes<HTMLButtonElement>) => <button {...props} />,
      },
    );

    return items;
  }, [
    prependItems,
    bookmarkItem,
    showMultiConvo,
    handleAddMultiConvo,
    isReal,
    localize,
    renameHandler,
    handleDuplicateClick,
    isDuplicateLoading,
    isPinned,
    handlePinClick,
    folderItem,
    handleArchiveClick,
    isArchiveLoading,
  ]);

  if (dropdownItems.length === 0) {
    return null;
  }

  return (
    <BookmarkContext.Provider value={{ bookmarks: allBookmarks || [] }}>
      <DropdownPopup
        portal={true}
        menuId={menuId}
        focusLoop={true}
        className="z-[125]"
        unmountOnHide={true}
        isOpen={isPopoverActive}
        setIsOpen={setIsPopoverActive}
        trigger={
          <TooltipAnchor
            description={localize('com_nav_convo_menu_options')}
            render={
              <Ariakit.MenuButton
                id="chat-menu-button"
                aria-label={localize('com_nav_convo_menu_options')}
                data-testid="chat-header-menu"
                className="inline-flex size-9 flex-shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-50 radix-state-open:bg-surface-hover radix-state-open:text-brand-purple"
                onClick={(e: MouseEvent<HTMLButtonElement>) => e.stopPropagation()}
              >
                <Ellipsis size={18} aria-hidden="true" />
              </Ariakit.MenuButton>
            }
          />
        }
        items={dropdownItems}
      />
      {showDeleteDialog && (
        <DeleteButton
          title={title}
          retainView={() => {}}
          triggerRef={deleteButtonRef}
          setMenuOpen={setIsPopoverActive}
          showDeleteDialog={showDeleteDialog}
          conversationId={conversationId ?? ''}
          setShowDeleteDialog={setShowDeleteDialog}
        />
      )}
      {showBookmarks && (
        <BookmarkEditDialog
          tags={tagsList}
          open={showBookmarkDialog}
          setTags={updateConvoTags}
          setOpen={setShowBookmarkDialog}
          triggerRef={newBookmarkRef}
          conversationId={conversationId ?? ''}
          context="ChatMenu - BookmarkEditDialog"
        />
      )}
    </BookmarkContext.Provider>
  );
}
