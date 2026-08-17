import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Constants, QueryKeys } from 'librechat-data-provider';
import { useToastContext, useMediaQuery } from '@librechat/client';
import { Pin } from 'lucide-react';
import type { TConversation } from 'librechat-data-provider';
import { useUpdateConversationMutation, useMoveConvoToFolderMutation } from '~/data-provider';
import { useNavigateToConvo, useLocalize, useShiftKey } from '~/hooks';
import { NotificationSeverity } from '~/common';
import { ConvoOptions } from './ConvoOptions';
import RenameForm from './RenameForm';
import { cn, logger, updateConvoInAllQueries } from '~/utils';
import { pinButtonClass, PIN_GLYPH_SIZE } from '~/components/ui/pinStyles';
import { CONVO_DRAG_TYPE, CONVO_DRAG_FROM, convoDrag } from './dragTypes';
import ConvoLink from './ConvoLink';
import store from '~/store';

interface ConversationProps {
  conversation: TConversation;
  retainView: () => void;
  toggleNav: () => void;
  isGenerating?: boolean;
}

export default function Conversation({
  conversation,
  retainView,
  toggleNav,
  isGenerating = false,
}: ConversationProps) {
  const params = useParams();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const queryClient = useQueryClient();
  const { navigateToConvo } = useNavigateToConvo();
  const currentConvoId = useMemo(() => params.conversationId, [params.conversationId]);
  const updateConvoMutation = useUpdateConversationMutation(currentConvoId ?? '');
  const moveConvoToFolder = useMoveConvoToFolderMutation();
  const activeConvos = useRecoilValue(store.allConversationsSelector);
  const setActiveFolderId = useSetRecoilState(store.activeFolderId);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const isShiftHeld = useShiftKey();
  const { conversationId, title = '' } = conversation;

  const [titleInput, setTitleInput] = useState(title || '');
  const [renaming, setRenaming] = useState(false);
  const [isPopoverActive, setIsPopoverActive] = useState(false);
  // Lazy-load ConvoOptions to avoid running heavy hooks for all conversations
  const [hasInteracted, setHasInteracted] = useState(false);
  /* Pointer over the pin or the ⋯: those gestures are theirs alone, so the
     row stops being draggable while the cursor is on them. dragstart fires on
     the draggable ROW, not the child under the cursor, so the only way to
     exempt a control is to disarm the row itself. */
  const [overControls, setOverControls] = useState(false);

  const previousTitle = useRef(title);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (title !== previousTitle.current) {
      setTitleInput(title as string);
      previousTitle.current = title;
    }
  }, [title]);

  const isActiveConvo = useMemo(() => {
    if (conversationId === Constants.NEW_CONVO) {
      return currentConvoId === Constants.NEW_CONVO;
    }

    if (currentConvoId !== Constants.NEW_CONVO) {
      return currentConvoId === conversationId;
    } else {
      const latestConvo = activeConvos?.[0];
      return latestConvo === conversationId;
    }
  }, [currentConvoId, conversationId, activeConvos]);

  const handleRename = () => {
    setIsPopoverActive(false);
    setTitleInput(title as string);
    setRenaming(true);
  };

  const handleRenameSubmit = async (newTitle: string) => {
    if (!conversationId || newTitle === title) {
      setRenaming(false);
      return;
    }

    try {
      await updateConvoMutation.mutateAsync({
        conversationId,
        title: newTitle.trim() || localize('com_ui_untitled'),
      });
      setRenaming(false);
    } catch (error) {
      logger.error('Error renaming conversation', error);
      setTitleInput(title as string);
      showToast({
        message: localize('com_ui_rename_failed'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
      setRenaming(false);
    }
  };

  const handleCancelRename = () => {
    setTitleInput(title as string);
    setRenaming(false);
  };

  const handleMouseEnter = useCallback(() => {
    if (!hasInteracted) {
      setHasInteracted(true);
    }
  }, [hasInteracted]);

  const handleMouseLeave = useCallback(() => {
    if (!isPopoverActive) {
      setHasInteracted(false);
    }
    /* The row's controls are revealed by `group-hover` OR `group-focus-within`,
     * and clicking one with the mouse leaves focus behind on it — so the pin or
     * the ⋯ stayed lit after the pointer had gone. Dropping that focus as the
     * pointer leaves means nothing outlives the hover. A keyboard user never
     * fires mouseleave, so their focus ring is untouched, and focus is left
     * alone while a menu is open because the menu owns it. */
    if (isPopoverActive) {
      return;
    }
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && containerRef.current?.contains(focused) === true) {
      focused.blur();
    }
  }, [isPopoverActive]);

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      // Don't reset if focus is moving to a child element within this container
      if (e.currentTarget.contains(e.relatedTarget as Node)) {
        return;
      }
      if (!isPopoverActive) {
        setHasInteracted(false);
      }
    },
    [isPopoverActive],
  );

  const handlePopoverOpenChange = useCallback((open: boolean) => {
    setIsPopoverActive(open);
    if (!open) {
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container && !container.contains(document.activeElement)) {
          setHasInteracted(false);
        }
      });
    }
  }, []);

  const handleNavigation = (ctrlOrMetaKey: boolean) => {
    if (ctrlOrMetaKey) {
      toggleNav();
      const baseUrl = window.location.origin;
      const path = `/c/${conversationId}`;
      window.open(baseUrl + path, '_blank');
      return;
    }

    if (currentConvoId === conversationId || isPopoverActive) {
      return;
    }

    toggleNav();
    setActiveFolderId(null);

    if (typeof title === 'string' && title.length > 0) {
      document.title = title;
    }

    navigateToConvo(conversation, {
      currentConvoId,
      resetLatestMessage: !(conversationId ?? '') || conversationId === Constants.NEW_CONVO,
    });
  };

  const isPinned = conversation.isPinned === true;
  const isInFolder = (conversation.folderId ?? null) != null;

  const convoOptionsProps = {
    title,
    retainView,
    renameHandler: handleRename,
    isActiveConvo,
    conversationId,
    isPopoverActive,
    setIsPopoverActive: handlePopoverOpenChange,
    isPinned,
    isShiftHeld: isActiveConvo ? isShiftHeld : false,
    folderId: conversation.folderId ?? null,
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'group relative flex h-12 w-full items-center rounded-[8px] pr-[9px] outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white md:h-8',
        /* §5: two rungs above the sidebar for the selected row, one for a row
           merely under the pointer. At three the active chat was the darkest
           thing in the sidebar, heavier in light than the sidebar's own edge. */
        isActiveConvo || isPopoverActive ? 'bg-surface-hover' : 'hover:bg-surface-secondary',
      )}
      role="button"
      tabIndex={renaming ? -1 : 0}
      aria-label={localize('com_ui_conversation_label', {
        title: title || localize('com_ui_untitled'),
      })}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleBlur}
      onClick={(e) => {
        if (renaming) {
          return;
        }
        if (e.button === 0) {
          handleNavigation(e.ctrlKey || e.metaKey);
        }
      }}
      onKeyDown={(e) => {
        if (renaming) {
          return;
        }
        if (e.target !== e.currentTarget) {
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleNavigation(false);
        }
      }}
      style={{ cursor: renaming ? 'default' : 'pointer' }}
      data-testid="convo-item"
      draggable={!renaming && !overControls}
      onDragEnd={() => {
        /* Dragged out of a folder and dropped on nothing: the chat leaves the
           folder and returns to its date group, which is where it lived before
           it was filed. A drag that a folder accepted has already been dealt
           with, and one that never started in a folder has nowhere to go. */
        const from = conversation.folderId;
        if (convoDrag.handled || from == null || from === '' || conversationId == null) {
          return;
        }
        moveConvoToFolder.mutate(
          { conversationId, folderId: null },
          {
            onError: () =>
              showToast({
                message: localize('com_ui_error'),
                severity: NotificationSeverity.ERROR,
              }),
          },
        );
      }}
      onDragStart={(e) => {
        if (conversationId == null) {
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(CONVO_DRAG_TYPE, conversationId);
        /* Where it came from, so a drop back onto the same folder is a no-op
           rather than a pointless round trip. */
        e.dataTransfer.setData(CONVO_DRAG_FROM, conversation.folderId ?? '');
        convoDrag.handled = false;
        /* A plain-text payload as well, so dropping outside the app degrades
           to the title rather than an empty drag image. */
        e.dataTransfer.setData('text/plain', title || '');
      }}
    >
      {renaming ? (
        <RenameForm
          titleInput={titleInput}
          setTitleInput={setTitleInput}
          onSubmit={handleRenameSubmit}
          onCancel={handleCancelRename}
          localize={localize}
        />
      ) : (
        <ConvoLink
          isActiveConvo={isActiveConvo}
          isPopoverActive={isPopoverActive}
          title={title}
          onRename={handleRename}
          isSmallScreen={isSmallScreen}
          localize={localize}
        >
          {isGenerating ? (
            <svg
              className="h-4 w-4 flex-shrink-0 animate-spin text-text-primary"
              viewBox="0 0 24 24"
              fill="none"
              aria-label={localize('com_ui_generating')}
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : null}
        </ConvoLink>
      )}
      {/* Row-states card (state crops):
            rest            -> nothing trailing
            hover           -> upright pin (click pins) + ... fade in
            selected        -> nothing until hovered
            pinned rest     -> pin shows because the chat is pinned
            pinned hover    -> glyph swaps to the slashed pin (click unpins), ... joins */}
      {/* Not in a folder. Filing a chat and pinning it are two ways of saying
          the same thing — "keep this one to hand" — and offering both inside a
          folder means the folder's own ordering is silently overridden by a
          control the user set somewhere else. Pinning stays on the loose list,
          which is the one that needs it. */}
      {/* No pin inside a folder, and no reserved slot either — the ⋯ takes the
          rightmost position instead of floating one control in from the edge.
          A folder row's title therefore runs 26px longer than a loose one,
          which is the trade for putting the ⋯ where the eye looks for it. */}
      {!renaming && !isInFolder && (
        <button
          type="button"
          onMouseEnter={() => setOverControls(true)}
          onMouseLeave={() => setOverControls(false)}
          data-testid="convo-pin"
          aria-label={localize(isPinned ? 'com_ui_unpin' : 'com_ui_pin')}
          aria-pressed={isPinned}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            /* A mouse click leaves focus sitting on this button, and the row
               reveals its controls on `group-focus-within` — so the pin stayed
               visible after the pointer had gone. `detail > 0` means a pointer
               activated it; keyboard activation reports 0 and keeps its focus,
               because for a keyboard user that ring is the only thing saying
               where they are. */
            if (e.detail > 0) {
              e.currentTarget.blur();
            }
            if (!conversationId) {
              return;
            }
            const next = !isPinned;
            /* Flip the cached row first: waiting for the refetch left the pin
               looking untouched for as long as the round trip took — and with
               a Pinned section, the row stayed in the wrong group too. The
               server call still runs; a failure puts it back. */
            updateConvoInAllQueries(queryClient, conversationId, (c) => ({
              ...c,
              isPinned: next,
            }));
            updateConvoMutation.mutate(
              { conversationId, isPinned: next },
              {
                /* Trust the response, do not re-read. Invalidating here fired a
                   refetch the instant the write returned, and a list read that
                   had not caught up put the old value straight back over the
                   optimistic one — the pin reappearing until a refresh. The
                   PUT's own response is the authoritative row, so apply that
                   and leave the rest of the cache alone. */
                onSuccess: (updated) =>
                  updateConvoInAllQueries(queryClient, conversationId, (c) => ({
                    ...c,
                    isPinned: updated?.isPinned ?? next,
                  })),
                onError: () => {
                  updateConvoInAllQueries(queryClient, conversationId, (c) => ({
                    ...c,
                    isPinned: !next,
                  }));
                  showToast({
                    message: localize('com_ui_error'),
                    severity: NotificationSeverity.ERROR,
                  });
                },
              },
            );
          }}
          className={cn(
            // Figma `.chatrow .pin`: pulled 8px into the row's own padding so
            // the glyph sits where the spec puts it, and order-2 to keep it to
            // the RIGHT of the ⋯ menu. Everything else is the shared pin.
            'order-2 -mr-2',
            /* Always visible on a touch device. The pin reveals itself on
               hover, and there is no hover on a phone — so an unpinned chat's
               pin was `opacity-0 pointer-events-none` with nothing that could
               ever bring it back, and pinning simply did not exist on mobile. */
            pinButtonClass(isPinned, isSmallScreen),
          )}
        >
          <Pin size={PIN_GLYPH_SIZE} aria-hidden="true" />
        </button>
      )}
      <div
        onMouseEnter={() => setOverControls(true)}
        onMouseLeave={() => setOverControls(false)}
        className={cn(
          // order-1: the ⋯ menu sits to the LEFT of the pin. With no pin —
          // inside a folder — it is the last control, so it moves out toward
          // the edge the pin would have held. Only half the pin's -8 though:
          // the pin is a 12px glyph in a 26px box and carries its own inset,
          // where the ⋯ is `justify-end` and would sit hard against the edge.
          'order-1 flex w-[26px] flex-shrink-0 items-center justify-end overflow-hidden',
          isInFolder && '-mr-1',
          'transition-[width,margin,opacity] duration-hover',
          // The slot holds its width whether or not the icons are showing, so
          // a title truncates at the same point at rest as it does on hover —
          // it no longer reflows the moment the cursor lands on the row.
          /* Touch has no hover to reveal these with, so on a phone the slot is
             simply always on — same reasoning as the pin above. */
          isPopoverActive || isSmallScreen
            ? 'pointer-events-auto opacity-100'
            : cn(
                'pointer-events-none opacity-0',
                'group-focus-within:pointer-events-auto group-focus-within:opacity-100',
                'group-hover:pointer-events-auto group-hover:opacity-100',
                isActiveConvo && isShiftHeld && 'group-hover:w-[56px]',
              ),
        )}
        // Removing aria-hidden to fix accessibility issue: ARIA hidden element must not be focusable or contain focusable elements
        // but not sure what its original purpose was, so leaving the property commented out until it can be cleared safe to delete.
        // aria-hidden={!(isPopoverActive || isActiveConvo)}
      >
        {/* Only render ConvoOptions when user interacts (hover/focus) or for active conversation */}
        {!renaming && (hasInteracted || isActiveConvo || isSmallScreen) && (
          <ConvoOptions {...convoOptionsProps} />
        )}
      </div>
    </div>
  );
}
