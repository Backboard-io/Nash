import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Constants, QueryKeys } from 'librechat-data-provider';
import { useToastContext, useMediaQuery } from '@librechat/client';
import { Pin, PinOff } from 'lucide-react';
import type { TConversation } from 'librechat-data-provider';
import { useUpdateConversationMutation } from '~/data-provider';
import { useNavigateToConvo, useLocalize, useShiftKey } from '~/hooks';
import { NotificationSeverity } from '~/common';
import { ConvoOptions } from './ConvoOptions';
import RenameForm from './RenameForm';
import { cn, logger } from '~/utils';
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
        isActiveConvo || isPopoverActive ? 'bg-surface-active' : 'hover:bg-surface-hover',
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
      {!renaming && (
        <button
          type="button"
          data-testid="convo-pin"
          aria-label={localize(isPinned ? 'com_ui_unpin' : 'com_ui_pin')}
          aria-pressed={isPinned}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!conversationId) {
              return;
            }
            updateConvoMutation.mutate(
              { conversationId, isPinned: !isPinned },
              {
                onSuccess: () => queryClient.invalidateQueries([QueryKeys.allConversations]),
                onError: () =>
                  showToast({
                    message: localize('com_ui_error'),
                    severity: NotificationSeverity.ERROR,
                  }),
              },
            );
          }}
          className={cn(
            'ml-1 flex flex-shrink-0 items-center rounded-[4px] text-text-secondary transition-colors',
            'hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isPinned
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
          )}
        >
          {isPinned ? (
            <>
              <Pin size={14} aria-hidden="true" className="group-hover:hidden" />
              <PinOff size={14} aria-hidden="true" className="hidden group-hover:block" />
            </>
          ) : (
            <Pin size={14} aria-hidden="true" />
          )}
        </button>
      )}
      <div
        className={cn(
          'flex flex-shrink-0 items-center justify-end overflow-hidden',
          'transition-[width,margin,opacity] duration-150',
          // The slot only claims width once it is actually shown. Reserving it
          // permanently pushed the trailing pin 33px in from the row edge, so it
          // no longer lined up with the section and folder chevrons.
          isPopoverActive
            ? 'pointer-events-auto w-[26px] opacity-100'
            : cn(
                'pointer-events-none w-0 opacity-0',
                'group-focus-within:pointer-events-auto group-focus-within:w-[26px] group-focus-within:opacity-100',
                'group-hover:pointer-events-auto group-hover:w-[26px] group-hover:opacity-100',
                isActiveConvo && isShiftHeld && 'group-hover:w-[56px]',
              ),
        )}
        // Removing aria-hidden to fix accessibility issue: ARIA hidden element must not be focusable or contain focusable elements
        // but not sure what its original purpose was, so leaving the property commented out until it can be cleared safe to delete.
        // aria-hidden={!(isPopoverActive || isActiveConvo)}
      >
        {/* Only render ConvoOptions when user interacts (hover/focus) or for active conversation */}
        {!renaming && (hasInteracted || isActiveConvo) && <ConvoOptions {...convoOptionsProps} />}
      </div>
    </div>
  );
}
