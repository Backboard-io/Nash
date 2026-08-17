import { useEffect, useRef } from 'react';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import { Constants, tMessageSchema, isAssistantsEndpoint } from 'librechat-data-provider';
import type { TMessage, TConversation, TSubmission, Agents } from 'librechat-data-provider';
import { useStreamStatus } from '~/data-provider';
import { logger } from '~/utils';
import store from '~/store';

/**
 * Build a submission object from resume state for reconnected streams.
 * This provides the minimum data needed for useResumableSSE to subscribe.
 */
function buildSubmissionFromResumeState(
  resumeState: Agents.ResumeState,
  streamId: string,
  messages: TMessage[],
  conversationId: string,
  isTemporary = false,
): TSubmission {
  const userMessageData = resumeState.userMessage;
  const responseMessageId =
    resumeState.responseMessageId ?? `${userMessageData?.messageId ?? 'resume'}_`;

  // Try to find existing user message in the messages array (from database)
  const existingUserMessage = messages.find(
    (m) => m.isCreatedByUser && m.messageId === userMessageData?.messageId,
  );

  // Try to find existing response message in the messages array (from database)
  const existingResponseMessage = messages.find(
    (m) =>
      !m.isCreatedByUser &&
      (m.messageId === responseMessageId || m.parentMessageId === userMessageData?.messageId),
  );

  // Create or use existing user message
  const userMessage: TMessage =
    existingUserMessage ??
    (userMessageData
      ? (tMessageSchema.parse({
          messageId: userMessageData.messageId,
          parentMessageId: userMessageData.parentMessageId ?? Constants.NO_PARENT,
          conversationId: userMessageData.conversationId ?? conversationId,
          text: userMessageData.text ?? '',
          isCreatedByUser: true,
          role: 'user',
          // Keep the user's attached image(s) visible after a mid-generation
          // refresh — without this the reconstructed prompt loses its files.
          files: userMessageData.files,
        }) as TMessage)
      : (messages[messages.length - 2] ??
        ({
          messageId: 'resume_user_msg',
          conversationId,
          text: '',
          isCreatedByUser: true,
        } as TMessage)));

  // ALWAYS use aggregatedContent from resumeState - it has the latest content from the running job.
  // DB content may be stale (saved at disconnect, but generation continued).
  const initialResponse: TMessage = {
    messageId: existingResponseMessage?.messageId ?? responseMessageId,
    parentMessageId: existingResponseMessage?.parentMessageId ?? userMessage.messageId,
    conversationId,
    text: '',
    // aggregatedContent is authoritative - it reflects actual job state
    content: (resumeState.aggregatedContent as TMessage['content']) ?? [],
    isCreatedByUser: false,
    role: 'assistant',
    sender: existingResponseMessage?.sender ?? resumeState.sender,
    model: existingResponseMessage?.model,
    // Restore any images already generated before the refresh, and the
    // image-generation flag so the "Generating image…" placeholder shows even
    // when no image has landed yet.
    generatedMedia: (resumeState.generatedMedia ??
      existingResponseMessage?.generatedMedia) as TMessage['generatedMedia'],
    imageGeneration: resumeState.imageGeneration,
  } as TMessage;

  const conversation: TConversation = {
    conversationId,
    title: 'Resumed Chat',
    endpoint: null,
  } as TConversation;

  return {
    messages,
    userMessage,
    initialResponse,
    conversation,
    isRegenerate: false,
    isTemporary: isTemporary,
    endpointOption: {},
    // Signal to useResumableSSE to subscribe to existing stream instead of starting new
    resumeStreamId: streamId,
  } as TSubmission & { resumeStreamId: string };
}

/**
 * Hook to resume streaming if navigating to a conversation with active generation.
 * Checks stream status via React Query and sets submission if active job found.
 *
 * This hook:
 * 1. Uses useStreamStatus to check for active jobs on navigation
 * 2. If active job found, builds a submission with streamId and sets it
 * 3. useResumableSSE picks up the submission and subscribes to the stream
 *
 * @param messagesLoaded - Whether the messages query has finished loading (prevents race condition)
 */
export default function useResumeOnLoad(
  conversationId: string | undefined,
  getMessages: () => TMessage[] | undefined,
  runIndex = 0,
  messagesLoaded = true,
) {
  const setSubmission = useSetRecoilState(store.submissionByIndex(runIndex));
  const currentSubmission = useRecoilValue(store.submissionByIndex(runIndex));
  const currentConversation = useRecoilValue(store.conversationByIndex(runIndex));
  const endpoint = currentConversation?.endpoint;
  const endpointType = currentConversation?.endpointType;
  const actualEndpoint = endpointType ?? endpoint;
  const resumableEnabled = !isAssistantsEndpoint(actualEndpoint);
  // Track conversations we've already processed (either resumed or skipped)
  const processedConvoRef = useRef<string | null>(null);

  // Check for active stream when conversation changes
  // Allow check if no submission OR submission is for a different conversation (stale)
  const submissionConvoId = currentSubmission?.conversation?.conversationId;
  const currentConversationId = currentConversation?.conversationId;
  const hasActiveSubmissionForThisConvo =
    !!currentSubmission &&
    (submissionConvoId === conversationId || currentConversationId === conversationId);

  const shouldCheck =
    resumableEnabled &&
    messagesLoaded && // Wait for messages to load before checking
    !hasActiveSubmissionForThisConvo && // Allow if no submission or stale submission
    !!conversationId &&
    conversationId !== Constants.NEW_CONVO &&
    processedConvoRef.current !== conversationId; // Don't re-check processed convos

  const { data: streamStatus, isSuccess } = useStreamStatus(conversationId, shouldCheck);

  useEffect(() => {
    logger.debug('[ResumeOnLoad] Effect check', {
      resumableEnabled,
      conversationId,
      messagesLoaded,
      hasCurrentSubmission: !!currentSubmission,
      currentSubmissionConvoId: currentSubmission?.conversation?.conversationId,
      currentConversationId,
      isSuccess,
      streamStatusActive: streamStatus?.active,
      streamStatusStreamId: streamStatus?.streamId,
      processedConvoRef: processedConvoRef.current,
    });

    if (!resumableEnabled || !conversationId || conversationId === Constants.NEW_CONVO) {
      logger.debug('[ResumeOnLoad] Skipping - not enabled or new convo');
      return;
    }

    // Wait for messages to load to avoid race condition where sync overwrites then DB overwrites
    if (!messagesLoaded) {
      logger.debug('[ResumeOnLoad] Waiting for messages to load');
      return;
    }

    // Don't resume if we already have an active submission FOR THIS CONVERSATION
    // A stale submission with undefined/different conversationId should not block us
    if (hasActiveSubmissionForThisConvo) {
      logger.debug('[ResumeOnLoad] Skipping - already have active submission for this conversation');
      // Mark as processed so we don't try again
      processedConvoRef.current = conversationId;
      return;
    }

    // If there's a stale submission for a different conversation, log it but continue
    if (currentSubmission && submissionConvoId !== conversationId) {
      logger.debug(
        '[ResumeOnLoad] Found submission mismatch, will check whether route is already covered by current conversation state',
        {
          staleConvoId: submissionConvoId,
          currentConvoId: conversationId,
          currentConversationId,
        },
      );
    }

    // Wait for stream status query to complete
    if (!isSuccess || !streamStatus) {
      logger.debug('[ResumeOnLoad] Waiting for stream status query');
      return;
    }

    // Don't process the same conversation twice
    if (processedConvoRef.current === conversationId) {
      logger.debug('[ResumeOnLoad] Skipping - already processed this conversation');
      return;
    }

    // Check if there's an active job to resume
    // DON'T mark as processed here - only mark when we actually create a submission
    // This prevents stale cache data from blocking subsequent resume attempts
    if (!streamStatus.active || !streamStatus.streamId) {
      logger.debug('[ResumeOnLoad] No active job to resume for:', conversationId);
      return;
    }

    // Mark as processed NOW - we verified there's an active job and will create submission
    processedConvoRef.current = conversationId;

    logger.debug('[ResumeOnLoad] Found active job, creating submission...', {
      streamId: streamStatus.streamId,
      status: streamStatus.status,
      resumeState: streamStatus.resumeState,
    });

    const messages = getMessages() || [];

    // Build submission from resume state if available
    if (streamStatus.resumeState) {
      const submission = buildSubmissionFromResumeState(
        streamStatus.resumeState,
        streamStatus.streamId,
        messages,
        conversationId,
        streamStatus.isTemporary ?? false,
      );
      logger.debug('[ResumeOnLoad] Set submission from resumeState', {
        conversationId,
        streamId: streamStatus.streamId,
        responseMessageId: streamStatus.resumeState.responseMessageId,
      });
      setSubmission(submission);
    } else {
      // Minimal submission without resume state
      const lastUserMessage = [...messages].reverse().find((m) => m.isCreatedByUser);
      const submission = {
        messages,
        userMessage:
          lastUserMessage ?? ({ messageId: 'resume', conversationId, text: '' } as TMessage),
        initialResponse: {
          messageId: 'resume_',
          conversationId,
          text: '',
          content: streamStatus.aggregatedContent ?? [{ type: 'text', text: '' }],
        } as TMessage,
        conversation: { conversationId, title: 'Resumed Chat' } as TConversation,
        isRegenerate: false,
        isTemporary: streamStatus.isTemporary ?? false,
        endpointOption: {},
        // Signal to useResumableSSE to subscribe to existing stream instead of starting new
        resumeStreamId: streamStatus.streamId,
      } as TSubmission & { resumeStreamId: string };
      logger.debug('[ResumeOnLoad] Set minimal submission', {
        conversationId,
        streamId: streamStatus.streamId,
      });
      setSubmission(submission);
    }
  }, [
    conversationId,
    resumableEnabled,
    messagesLoaded,
    hasActiveSubmissionForThisConvo,
    submissionConvoId,
    currentConversationId,
    currentSubmission,
    isSuccess,
    streamStatus,
    getMessages,
    setSubmission,
  ]);

  // Reset processedConvoRef when conversation changes to allow re-checking
  useEffect(() => {
    // Always reset when conversation changes - this allows resuming when navigating back
    if (conversationId !== processedConvoRef.current) {
      logger.debug('[ResumeOnLoad] Resetting processedConvoRef for new conversation:', {
        old: processedConvoRef.current,
        new: conversationId,
      });
      processedConvoRef.current = null;
    }
  }, [conversationId]);
}
