import { useCallback, useMemo } from 'react';
import { ContentTypes } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';

import type {
  Text,
  TMessage,
  ImageFile,
  ContentPart,
  PartMetadata,
  TContentData,
  ContentMetadata,
  EventSubmission,
  TMessageContentParts,
} from 'librechat-data-provider';
import { addFileToCache } from '~/utils';

type TUseContentHandler = {
  setMessages: (messages: TMessage[]) => void;
  getMessages: () => TMessage[] | undefined;
};

type TContentHandler = {
  data: TContentData;
  submission: EventSubmission;
};

export default function useContentHandler({ setMessages, getMessages }: TUseContentHandler) {
  const queryClient = useQueryClient();
  const messageMap = useMemo(() => new Map<string, TMessage>(), []);

  /** Reset the message map - call this after sync to prevent stale state from overwriting synced content */
  const resetMessageMap = useCallback(() => {
    messageMap.clear();
  }, [messageMap]);

  const handler = useCallback(
    ({ data, submission }: TContentHandler) => {
      const { type, messageId, thread_id, conversationId, index, agentId, groupId } = data;

      const _messages = getMessages();
      let messages =
        _messages?.filter((m) => m.messageId !== messageId).map((msg) => ({ ...msg, thread_id })) ??
        [];
      // If the messages cache is momentarily empty (e.g. during a new-chat
      // conversation-id transition, while a "Loading image…" status streams as
      // this response's text), do NOT collapse the whole thread to just this
      // streaming message — that wipes the user's prompt, their attached image,
      // and every earlier message until the response completes. Fall back to the
      // submitted context so the prompt + prior messages stay on screen the
      // whole time.
      if (messages.length === 0) {
        const submittedContext = [
          ...((submission.messages as TMessage[] | undefined) ?? []),
          submission.userMessage,
        ].filter(Boolean) as TMessage[];
        messages = submittedContext
          .filter((m) => m.messageId !== messageId)
          .map((msg) => ({ ...msg, thread_id }));
      }
      const userMessage = messages[messages.length - 1] as TMessage | undefined;

      const { initialResponse } = submission;

      let response = messageMap.get(messageId);
      if (!response) {
        // Check if message already exists in current messages (e.g., after sync)
        // Use that as base instead of stale initialResponse
        const existingMessage = _messages?.find((m) => m.messageId === messageId);
        response = {
          ...(existingMessage ?? (initialResponse as TMessage)),
          parentMessageId:
            existingMessage?.parentMessageId ?? initialResponse.parentMessageId,
          conversationId,
          messageId,
          thread_id,
        };
        messageMap.set(messageId, response);
      }

      // TODO: handle streaming for non-text
      const textPart: Text | string | undefined = data[ContentTypes.TEXT];
      const part: ContentPart =
        textPart != null && typeof textPart === 'string' ? { value: textPart } : data[type];

      if (type === ContentTypes.IMAGE_FILE) {
        addFileToCache(queryClient, part as ImageFile & PartMetadata);
      }

      /* spreading the content array to avoid mutation */
      response.content = [...(response.content ?? [])];

      // Preserve agentId/groupId (parallel-response column tagging, set by
      // createDualMessageContent's placeholder) across the first real delta
      // at this index — a plain overwrite would silently drop them and break
      // the side-by-side compare-mode layout mid-stream. The event itself
      // may also carry them directly (e.g. the added model's one-shot
      // result), which takes priority since it's the freshest signal.
      const existingPart = response.content[index] as
        | (TMessageContentParts & Partial<ContentMetadata>)
        | undefined;
      const resolvedAgentId = agentId ?? existingPart?.agentId;
      const resolvedGroupId = groupId ?? existingPart?.groupId;
      response.content[index] = {
        ...(resolvedAgentId != null ? { agentId: resolvedAgentId } : {}),
        ...(resolvedGroupId != null ? { groupId: resolvedGroupId } : {}),
        type,
        [type]: part,
      } as TMessageContentParts;
      if (type === ContentTypes.TEXT) {
        response.text = typeof textPart === 'string' ? textPart : ((part as Text)?.value ?? '');
      }

      const lastContentPart = response.content[response.content.length - 1];
      const initialContentPart = initialResponse.content?.[0];
      if (
        type !== ContentTypes.TEXT &&
        initialContentPart != null &&
        lastContentPart != null &&
        ((lastContentPart.type === ContentTypes.TOOL_CALL &&
          lastContentPart[ContentTypes.TOOL_CALL]?.progress === 1) ||
          lastContentPart.type === ContentTypes.IMAGE_FILE)
      ) {
        response.content.push(initialContentPart);
      }

      setMessages([...messages, response]);
    },
    [queryClient, getMessages, messageMap, setMessages],
  );

  return { contentHandler: handler, resetContentHandler: resetMessageMap };
}
