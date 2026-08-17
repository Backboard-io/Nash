import { useRecoilValue } from 'recoil';
import { Constants } from 'librechat-data-provider';
import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import type { TMessage } from 'librechat-data-provider';
import { useMessagesConversation, useMessagesSubmission } from '~/Providers';
import useScrollToRef from '~/hooks/useScrollToRef';
import store from '~/store';

const debounceRate = 150;
const bottomOffset = 24;

export default function useMessageScrolling(messagesTree?: TMessage[] | null) {
  const autoScroll = useRecoilValue(store.autoScroll);

  const scrollableRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const lastConversationIdRef = useRef<string | null | undefined>();
  const lastAutoScrollRef = useRef(autoScroll);
  const pendingConversationScrollRef = useRef<string | null | undefined>();
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const { conversation, conversationId } = useMessagesConversation();
  const { setAbortScroll, isSubmitting, abortScroll } = useMessagesSubmission();

  const timeoutIdRef = useRef<NodeJS.Timeout>();
  const rafIdRef = useRef<number>();

  const debouncedSetShowScrollButton = useCallback((value: boolean) => {
    clearTimeout(timeoutIdRef.current);
    timeoutIdRef.current = setTimeout(() => {
      setShowScrollButton(value);
    }, debounceRate);
  }, []);

  const isNearBottom = useCallback(() => {
    const scrollable = scrollableRef.current;
    if (!scrollable) {
      return true;
    }

    return scrollable.scrollHeight - scrollable.scrollTop - scrollable.clientHeight <= bottomOffset;
  }, []);

  const updateScrollState = useCallback(() => {
    const nearBottom = isNearBottom();
    shouldStickToBottomRef.current = nearBottom;
    debouncedSetShowScrollButton(!nearBottom);
  }, [debouncedSetShowScrollButton, isNearBottom]);

  const scrollToBottomNow = useCallback(() => {
    const scrollable = scrollableRef.current;
    if (!scrollable) {
      return;
    }

    scrollable.scrollTop = scrollable.scrollHeight;
    shouldStickToBottomRef.current = true;
    debouncedSetShowScrollButton(false);
  }, [debouncedSetShowScrollButton]);

  const cancelScheduledScroll = useCallback(() => {
    if (rafIdRef.current != null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = undefined;
    }
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    if (typeof window === 'undefined') {
      scrollToBottomNow();
      return;
    }

    if (rafIdRef.current != null) {
      window.cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = undefined;
        scrollToBottomNow();
      });
    });
  }, [scrollToBottomNow]);

  const scrollableRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      scrollableRef.current = node;

      if (!node || typeof ResizeObserver === 'undefined') {
        return;
      }

      resizeObserverRef.current = new ResizeObserver(() => {
        if (shouldStickToBottomRef.current) {
          scheduleScrollToBottom();
          return;
        }

        updateScrollState();
      });
      resizeObserverRef.current.observe(node);
    },
    [scheduleScrollToBottom, updateScrollState],
  );

  const messagesEndRefCallback = useCallback((node: HTMLDivElement | null) => {
    messagesEndRef.current = node;
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(timeoutIdRef.current);
      resizeObserverRef.current?.disconnect();
      cancelScheduledScroll();
    };
  }, [cancelScheduledScroll]);

  const debouncedHandleScroll = useCallback(() => {
    updateScrollState();
  }, [updateScrollState]);

  const scrollCallback = () => {
    shouldStickToBottomRef.current = true;
    debouncedSetShowScrollButton(false);
  };

  const { scrollToRef: scrollToBottom, handleSmoothToRef } = useScrollToRef({
    targetRef: messagesEndRef,
    callback: scrollCallback,
    smoothCallback: () => {
      scrollCallback();
      setAbortScroll(false);
    },
  });

  useLayoutEffect(() => {
    const didSwitchConversation = conversationId !== lastConversationIdRef.current;
    const didEnableAutoScroll = autoScroll && autoScroll !== lastAutoScrollRef.current;
    lastConversationIdRef.current = conversationId;
    lastAutoScrollRef.current = autoScroll;

    // A new chat changes from the sentinel id to its real id while streaming.
    // Treat that as part of the active submission, not as opening another chat,
    // or the id handoff jumps the viewport mid-response.
    if (
      didSwitchConversation &&
      conversationId !== Constants.NEW_CONVO &&
      autoScroll &&
      !isSubmitting
    ) {
      shouldStickToBottomRef.current = true;
      pendingConversationScrollRef.current = conversationId;
    } else if (didSwitchConversation) {
      pendingConversationScrollRef.current = undefined;
    }

    if (!messagesTree || messagesTree.length === 0) {
      return;
    }

    if (!messagesEndRef.current || !scrollableRef.current) {
      return;
    }

    const firstMessageConversationId = messagesTree[0]?.conversationId;
    const messagesMatchConversation =
      firstMessageConversationId == null || firstMessageConversationId === conversationId;

    if (
      autoScroll &&
      pendingConversationScrollRef.current === conversationId &&
      messagesMatchConversation
    ) {
      pendingConversationScrollRef.current = undefined;
      scheduleScrollToBottom();
      return;
    }
    if (!autoScroll) {
      pendingConversationScrollRef.current = undefined;
    }

    if (abortScroll === true) {
      shouldStickToBottomRef.current = false;
      cancelScheduledScroll();
      scrollToBottom?.cancel();
      return;
    }

    if (isSubmitting) {
      // Follow streaming content only while the user remains near the bottom.
      // Once they scroll up, keep their reading position stable.
      if (shouldStickToBottomRef.current) {
        scheduleScrollToBottom();
      }
      return;
    }

    if (didEnableAutoScroll && conversationId !== Constants.NEW_CONVO) {
      scheduleScrollToBottom();
    }
  }, [
    abortScroll,
    autoScroll,
    cancelScheduledScroll,
    conversationId,
    isSubmitting,
    messagesTree,
    scheduleScrollToBottom,
    scrollToBottom,
  ]);

  return {
    conversation,
    scrollableRef: scrollableRefCallback,
    messagesEndRef: messagesEndRefCallback,
    scrollToBottom,
    showScrollButton,
    handleSmoothToRef,
    debouncedHandleScroll,
  };
}
