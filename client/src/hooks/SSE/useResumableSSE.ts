import { useEffect, useState, useRef, useCallback } from 'react';
import { v4 } from 'uuid';
import { SSE } from 'sse.js';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import {
  request,
  Constants,
  QueryKeys,
  ErrorTypes,
  apiBaseUrl,
  createPayload,
  ViolationTypes,
  LocalStorageKeys,
  removeNullishValues,
} from 'librechat-data-provider';
import type { TMessage, TPayload, TSubmission, EventSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import {
  useGetStartupConfig,
  useGetUserBalance,
} from '~/data-provider';
import type { ActiveJobsResponse } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { logger } from '~/utils';
import useEventHandlers from './useEventHandlers';
import store from '~/store';

const clearDraft = (conversationId?: string | null) => {
  if (conversationId) {
    localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${conversationId}`);
    localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${conversationId}`);
  } else {
    localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${Constants.NEW_CONVO}`);
    localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${Constants.NEW_CONVO}`);
  }
};

type ChatHelpers = Pick<
  EventHandlerParams,
  | 'setMessages'
  | 'getMessages'
  | 'setConversation'
  | 'setIsSubmitting'
  | 'setSubmission'
  | 'newConversation'
  | 'resetLatestMessage'
>;

const MAX_RETRIES = 5;

/**
 * Hook for resumable SSE streams.
 * Separates generation start (POST) from stream subscription (GET EventSource).
 * Supports auto-reconnection with exponential backoff.
 *
 * Key behavior:
 * - Navigation away does NOT abort the generation (just closes SSE)
 * - Only explicit abort (via stop button → backend abort endpoint) stops generation
 * - Backend emits `done` event with `aborted: true` on abort, handled via finalHandler
 */
export default function useResumableSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
) {
  const queryClient = useQueryClient();
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(runIndex));

  const { token, isAuthenticated } = useAuthContext();

  /**
   * Optimistically add a job ID to the active jobs cache.
   * Called when generation starts.
   */
  const addActiveJob = useCallback(
    (jobId: string) => {
      queryClient.setQueryData<ActiveJobsResponse>([QueryKeys.activeJobs], (old) => ({
        activeJobIds: [...new Set([...(old?.activeJobIds ?? []), jobId])],
      }));
    },
    [queryClient],
  );

  /**
   * Optimistically remove a job ID from the active jobs cache.
   * Called when generation completes, aborts, or errors.
   */
  const removeActiveJob = useCallback(
    (jobId: string) => {
      queryClient.setQueryData<ActiveJobsResponse>([QueryKeys.activeJobs], (old) => ({
        activeJobIds: (old?.activeJobIds ?? []).filter((id) => id !== jobId),
      }));
    },
    [queryClient],
  );
  const [_completed, setCompleted] = useState(new Set());
  const [streamId, setStreamId] = useState<string | null>(null);
  const setAbortScroll = useSetRecoilState(store.abortScrollFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));

  const sseRef = useRef<SSE | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const submissionRef = useRef<TSubmission | null>(null);
  const finalReceivedRef = useRef(false);

  const {
    setMessages,
    getMessages,
    setConversation,
    setIsSubmitting,
    setSubmission,
    newConversation,
    resetLatestMessage,
  } = chatHelpers;

  const logClientState = useCallback(
    (stage: string, extra?: Record<string, unknown>) => {
      logger.debug('nash:stream', stage, {
        runIndex,
        streamId,
        submissionConversationId: submissionRef.current?.conversation?.conversationId,
        reconnectAttempt: reconnectAttemptRef.current,
        ...extra,
      });
    },
    [runIndex, streamId],
  );

  const {
    stepHandler,
    finalHandler,
    errorHandler,
    clearStepMaps,
    messageHandler,
    contentHandler,
    createdHandler,
    syncStepMessage,
    attachmentHandler,
    resetContentHandler,
  } = useEventHandlers({
    setMessages,
    getMessages,
    setCompleted,
    isAddedRequest,
    setConversation,
    setIsSubmitting,
    setSubmission,
    newConversation,
    setShowStopButton,
    resetLatestMessage,
  });

  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });

  /**
   * Subscribe to stream via SSE library (supports custom headers)
   * Follows same auth pattern as useSSE
   * @param isResume - If true, adds ?resume=true to trigger sync event from server
   */
  const subscribeToStream = useCallback(
    (currentStreamId: string, currentSubmission: TSubmission, isResume = false) => {
      let { userMessage } = currentSubmission;
      let textIndex: number | null = null;

      finalReceivedRef.current = false;
      const baseUrl = `${apiBaseUrl()}/api/agents/chat/stream/${encodeURIComponent(currentStreamId)}`;
      const url = isResume ? `${baseUrl}?resume=true` : baseUrl;
      logger.debug('[ResumableSSE] Subscribing to stream:', url, { isResume });

      const sessionKey = (() => { try { return sessionStorage.getItem('nash_session_key'); } catch { return null; } })();
      const sse = new SSE(url, {
        // Google/OAuth sessions are authenticated by the httpOnly session cookie.
        // sse.js does not send cross-origin cookies unless credentials are enabled.
        withCredentials: true,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(sessionKey ? { 'X-Session-Key': sessionKey } : {}),
        },
        method: 'GET',
      });
      sseRef.current = sse;

      sse.addEventListener('open', () => {
        logger.debug('[nash:stream] connected – waiting for events (final=done)');
        logClientState('sse_open', { currentStreamId, isResume });
        setAbortScroll(false);
        // Restore UI state on successful connection (including reconnection)
        setIsSubmitting(true);
        setShowStopButton(true);
        reconnectAttemptRef.current = 0;
      });

      sse.addEventListener('message', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);

          if (data.final != null) {
            logger.debug('[nash:stream] FINAL received – stream done', {
              aborted: data.aborted,
              conversationId: data.conversation?.conversationId,
              hasResponseMessage: !!data.responseMessage,
            });
            logClientState('final_received', {
              currentStreamId,
              finalConversationId: data.conversation?.conversationId,
              aborted: data.aborted,
              hasResponseMessage: !!data.responseMessage,
            });
            clearDraft(currentSubmission.conversation?.conversationId);
            try {
              finalHandler(data, currentSubmission as EventSubmission);
              logClientState('final_handler_completed', {
                currentStreamId,
                finalConversationId: data.conversation?.conversationId,
              });
            } catch (error) {
              console.error('[ResumableSSE] Error in finalHandler:', error);
              logClientState('final_handler_error', {
                currentStreamId,
                error: error instanceof Error ? error.message : String(error),
              });
              setIsSubmitting(false);
              setShowStopButton(false);
            }
            // Clear handler maps on stream completion to prevent memory leaks
            clearStepMaps();
            // Optimistically remove from active jobs
            removeActiveJob(currentStreamId);
            (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();
            finalReceivedRef.current = true;
            sse.close();
            setStreamId(null);
            logClientState('final_cleanup_complete', { currentStreamId });
            return;
          }

          if (data.created != null) {
            logger.debug('[ResumableSSE] Received CREATED event', {
              messageId: data.message?.messageId,
              conversationId: data.message?.conversationId,
            });
            const runId = v4();
            setActiveRunId(runId);
            userMessage = {
              ...userMessage,
              ...data.message,
              overrideParentMessageId: userMessage.overrideParentMessageId,
            };
            createdHandler(data, { ...currentSubmission, userMessage } as EventSubmission);
            return;
          }

          if (data.event === 'attachment' && data.data) {
            attachmentHandler({
              data: data.data,
              submission: currentSubmission as EventSubmission,
            });
            return;
          }

          if (data.event != null) {
            stepHandler(data, { ...currentSubmission, userMessage } as EventSubmission);
            return;
          }

          if (data.sync != null) {
            logger.debug('[ResumableSSE] SYNC received', {
              runSteps: data.resumeState?.runSteps?.length ?? 0,
            });

            const runId = v4();
            setActiveRunId(runId);

            // Replay run steps
            if (data.resumeState?.runSteps) {
              for (const runStep of data.resumeState.runSteps) {
                stepHandler({ event: 'on_run_step', data: runStep }, {
                  ...currentSubmission,
                  userMessage,
                } as EventSubmission);
              }
            }

            // Set message content from aggregatedContent
            if (data.resumeState?.aggregatedContent && userMessage?.messageId) {
              const messages = getMessages() ?? [];
              const userMsgId = userMessage.messageId;
              const serverResponseId = data.resumeState.responseMessageId;

              // Find the EXACT response message - prioritize responseMessageId from server
              // This is critical when there are multiple responses to the same user message
              let responseIdx = -1;
              if (serverResponseId) {
                responseIdx = messages.findIndex((m) => m.messageId === serverResponseId);
              }
              // Fallback: find by parentMessageId pattern (for new messages)
              if (responseIdx < 0) {
                responseIdx = messages.findIndex(
                  (m) =>
                    !m.isCreatedByUser &&
                    (m.messageId === `${userMsgId}_` || m.parentMessageId === userMsgId),
                );
              }

              logger.debug('[ResumableSSE] SYNC update', {
                userMsgId,
                serverResponseId,
                responseIdx,
                foundMessageId: responseIdx >= 0 ? messages[responseIdx]?.messageId : null,
                messagesCount: messages.length,
                aggregatedContentLength: data.resumeState.aggregatedContent?.length,
              });

              if (responseIdx >= 0) {
                // Update existing response message with aggregatedContent
                const updated = [...messages];
                const oldContent = updated[responseIdx]?.content;
                updated[responseIdx] = {
                  ...updated[responseIdx],
                  content: data.resumeState.aggregatedContent,
                  // Restore images produced before the refresh and the
                  // image-generation flag so the container/placeholder render.
                  generatedMedia:
                    data.resumeState.generatedMedia ?? updated[responseIdx]?.generatedMedia,
                  imageGeneration:
                    data.resumeState.imageGeneration ?? updated[responseIdx]?.imageGeneration,
                };
                logger.debug('[ResumableSSE] SYNC updating message', {
                  messageId: updated[responseIdx]?.messageId,
                  oldContentLength: Array.isArray(oldContent) ? oldContent.length : 0,
                  newContentLength: data.resumeState.aggregatedContent?.length,
                });
                setMessages(updated);
                // Sync both content handler and step handler with the updated message
                // so subsequent deltas build on synced content, not stale content
                resetContentHandler();
                syncStepMessage(updated[responseIdx]);
                logger.debug('[ResumableSSE] SYNC complete, handlers synced');
              } else {
                // Add new response message
                const responseId = serverResponseId ?? `${userMsgId}_`;
                setMessages([
                  ...messages,
                  {
                    messageId: responseId,
                    parentMessageId: userMsgId,
                    conversationId: currentSubmission.conversation?.conversationId ?? '',
                    text: '',
                    content: data.resumeState.aggregatedContent,
                    isCreatedByUser: false,
                    generatedMedia: data.resumeState.generatedMedia,
                    imageGeneration: data.resumeState.imageGeneration,
                  } as TMessage,
                ]);
              }
            }

            setIsSubmitting(true);
            setShowStopButton(true);
            return;
          }

          if (data.type === 'tool_status') {
            // Transient "the assistant is doing tool work" status line (web
            // search, document export). Stored on the assistant message and shown
            // by ToolStatusIndicator until reply text streams or 'done' arrives.
            const messageId = data.messageId as string;
            const active = data.status === 'active';
            const label = (data.label as string) ?? '';
            const all = (getMessages?.() ?? []) as TMessage[];
            const updated = all.map((m) =>
              m.messageId === messageId
                ? ({ ...m, toolStatus: active && label ? { label } : undefined } as TMessage)
                : m,
            );
            setMessages(updated);
            return;
          }

          if (data.type === 'image') {
            // Backboard Image Tool — accumulate on the in-progress assistant message.
            const messageId = data.messageId as string;
            const image = data.image as {
              documentId: string;
              mimeType: string;
              url: string;
              fileSizeBytes?: number;
            };
            const all = (getMessages?.() ?? []) as TMessage[];
            const updated = all.map((m) =>
              m.messageId === messageId
                ? { ...m, generatedMedia: [...(m.generatedMedia ?? []), image] }
                : m,
            );
            setMessages(updated);
            return;
          }
          if (data.type != null) {
            const { text, index } = data;
            if (text != null && index !== textIndex) {
              textIndex = index;
            }
            contentHandler({ data, submission: currentSubmission as EventSubmission });
            logger.debug('[nash:stream] event: text chunk', {
              index: data.index,
              textLength: data.text?.value?.length ?? 0,
            });
            return;
          }

          if (data.message != null) {
            const text = data.text ?? data.response;
            const initialResponse = {
              ...(currentSubmission.initialResponse as TMessage),
              parentMessageId: data.parentMessageId,
              messageId: data.messageId,
            };
            messageHandler(text, { ...currentSubmission, userMessage, initialResponse });
          }
        } catch (error) {
          console.error('[ResumableSSE] Error processing message:', error);
        }
      });

      /**
       * Error event handler - handles BOTH:
       * 1. HTTP-level errors (responseCode present) - 404, 401, network failures
       * 2. Server-sent error events (event: error with data) - known errors like ViolationTypes/ErrorTypes
       *
       * Order matters: check responseCode first since HTTP errors may also include data
       */
      sse.addEventListener('error', async (e: MessageEvent) => {
        (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();

        /* @ts-ignore - sse.js types don't expose responseCode */
        const responseCode = e.responseCode;

        // 404 means job doesn't exist (completed/deleted) - don't retry
        if (responseCode === 404) {
          logger.debug('[ResumableSSE] Stream not found (404) - job completed or expired');
          logClientState('stream_404_cleanup', { currentStreamId });
          sse.close();
          removeActiveJob(currentStreamId);
          setIsSubmitting(false);
          setShowStopButton(false);
          setStreamId(null);
          reconnectAttemptRef.current = 0;
          return;
        }

        // Session-only auth: a 401 here means the session_key cookie is gone.
        // Let the error flow naturally — the next regular axios request will hit
        // the response interceptor and redirect to /login.

        /**
         * Server-sent error event (event: error with data) - no responseCode.
         * These are known errors (ErrorTypes, ViolationTypes) that should be displayed to user.
         * Only check e.data if there's no HTTP responseCode, since HTTP errors may also have body data.
         */
        if (!responseCode && e.data) {
          logger.debug('[ResumableSSE] Server-sent error event received:', e.data);
          sse.close();
          removeActiveJob(currentStreamId);


          try {
            const errorData = JSON.parse(e.data);
            const errorString = errorData.error ?? errorData.message ?? JSON.stringify(errorData);

            // Check if it's a known error type (ViolationTypes or ErrorTypes)
            let isKnownError = false;
            try {
              const parsed =
                typeof errorString === 'string' ? JSON.parse(errorString) : errorString;
              const errorType = parsed?.type ?? parsed?.code;
              if (errorType) {
                const violationValues = Object.values(ViolationTypes) as string[];
                const errorTypeValues = Object.values(ErrorTypes) as string[];
                isKnownError =
                  violationValues.includes(errorType) || errorTypeValues.includes(errorType);
              }
            } catch {
              // Not JSON or parsing failed - treat as generic error
            }

            logger.debug('[ResumableSSE] Error type check:', { isKnownError, errorString });

            // Display the error to user via errorHandler
            errorHandler({
              data: { text: errorString } as unknown as Parameters<typeof errorHandler>[0]['data'],
              submission: currentSubmission as EventSubmission,
            });
          } catch (parseError) {
            console.error('[ResumableSSE] Failed to parse server error:', parseError);
            errorHandler({
              data: { text: e.data } as unknown as Parameters<typeof errorHandler>[0]['data'],
              submission: currentSubmission as EventSubmission,
            });
          }

          setIsSubmitting(false);
          setShowStopButton(false);
          setStreamId(null);
          reconnectAttemptRef.current = 0;
          return;
        }

        // Spurious error fired by sse.js when sse.close() is called after a completed stream.
        // Do not reconnect - the stream already finished successfully.
        if (finalReceivedRef.current) {
          return;
        }

        // Network failure or unknown HTTP error - attempt reconnection with backoff
        logger.debug('[ResumableSSE] Stream error (network failure) - will attempt reconnect', {
          responseCode,
          hasData: !!e.data,
        });
        logClientState('stream_error', { currentStreamId, responseCode, hasData: !!e.data });

        if (reconnectAttemptRef.current < MAX_RETRIES) {
          // Increment counter BEFORE close() so abort handler knows we're reconnecting
          reconnectAttemptRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current - 1), 30000);

          logger.debug(
            `[ResumableSSE] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current}/${MAX_RETRIES})`,
          );
          logClientState('reconnect_scheduled', {
            currentStreamId,
            delay,
            attempt: reconnectAttemptRef.current,
          });

          sse.close();

          reconnectTimeoutRef.current = setTimeout(() => {
            if (submissionRef.current) {
              // Reconnect with isResume=true to get sync event with any missed content
              subscribeToStream(currentStreamId, submissionRef.current, true);
            }
          }, delay);

          // Keep UI in "submitting" state during reconnection attempts
          // so user knows we're still trying (abort handler may have reset these)
          setIsSubmitting(true);
          setShowStopButton(true);
        } else {
          console.error('[ResumableSSE] Max reconnect attempts reached');
          logClientState('max_retries_reached', { currentStreamId });
          sse.close();
          errorHandler({ data: undefined, submission: currentSubmission as EventSubmission });
          // Optimistically remove from active jobs on max retries
          removeActiveJob(currentStreamId);
          setIsSubmitting(false);
          setShowStopButton(false);
          setStreamId(null);
        }
      });

      /**
       * Abort event - fired when sse.close() is called (intentional close).
       * This happens on cleanup/navigation OR when error handler closes to reconnect.
       * Only reset state if we're NOT in a reconnection cycle.
       */
      sse.addEventListener('abort', () => {
        // If we're in a reconnection cycle, don't reset state
        // (error handler will set up the reconnect timeout)
        if (reconnectAttemptRef.current > 0) {
          logger.debug('[ResumableSSE] Stream closed for reconnect - preserving state');
          logClientState('abort_for_reconnect', { currentStreamId });
          return;
        }

        logger.debug('[ResumableSSE] Stream aborted (intentional close) - no reconnect');
        logClientState('abort_no_reconnect', { currentStreamId });
        // Clear any pending reconnect attempts
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        // Reset UI state - useResumeOnLoad will restore if user returns to this conversation
        setIsSubmitting(false);
        setShowStopButton(false);
        setStreamId(null);
      });

      // Start the SSE connection
      sse.stream();

      // Debug hooks for testing reconnection vs clean close behavior (dev only)
      if (import.meta.env.DEV) {
        const debugWindow = window as Window & {
          __sse?: SSE;
          __killNetwork?: () => void;
          __closeClean?: () => void;
        };
        debugWindow.__sse = sse;

        /** Simulate network drop - triggers error event → reconnection */
        debugWindow.__killNetwork = () => {
          logger.debug('[Debug] Simulating network drop...');
          // @ts-ignore - sse.js types are incorrect, dispatchEvent actually takes Event
          sse.dispatchEvent(new Event('error'));
        };

        /** Simulate clean close (navigation away) - triggers abort event → no reconnection */
        debugWindow.__closeClean = () => {
          logger.debug('[Debug] Simulating clean close (navigation away)...');
          sse.close();
        };
      }
    },
    [
      token,
      setAbortScroll,
      setActiveRunId,
      setShowStopButton,
      finalHandler,
      createdHandler,
      attachmentHandler,
      stepHandler,
      contentHandler,
      resetContentHandler,
      syncStepMessage,
      clearStepMaps,
      messageHandler,
      errorHandler,
      setIsSubmitting,
      getMessages,
      setMessages,
      startupConfig?.balance?.enabled,
      balanceQuery,
      removeActiveJob,
    ],
  );

  /**
   * Start generation (POST request that returns streamId)
   * Uses request.post which has axios interceptors for automatic token refresh.
   * Retries up to 3 times on network errors with exponential backoff.
   */
  const startGeneration = useCallback(
    async (currentSubmission: TSubmission): Promise<string | null> => {
      const payloadData = createPayload(currentSubmission);
      let { payload } = payloadData;
      payload = removeNullishValues(payload) as TPayload;

      clearStepMaps();

      const url = payloadData.server;

      const maxRetries = 3;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Use request.post which handles auth token refresh via axios interceptors
          const data = (await request.post(url, payload)) as { streamId: string };
          logger.debug('[ResumableSSE] Generation started:', { streamId: data.streamId });
          return data.streamId;
        } catch (error) {
          lastError = error;
          // Check if it's a network error (retry) vs server error (don't retry)
          const isNetworkError =
            error instanceof Error &&
            'code' in error &&
            (error.code === 'ERR_NETWORK' || error.code === 'ERR_INTERNET_DISCONNECTED');

          if (isNetworkError && attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
            logger.debug(
              `[ResumableSSE] Network error starting generation, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          // Don't retry: either not a network error or max retries reached
          break;
        }
      }

      console.error('[ResumableSSE] Error starting generation:', lastError);

      const axiosError = lastError as { response?: { data?: Record<string, unknown> } };
      const errorData = axiosError?.response?.data;
      if (errorData) {
        const errorText = JSON.stringify(errorData);
        errorHandler({
          data: { text: errorText } as unknown as Parameters<typeof errorHandler>[0]['data'],
          submission: currentSubmission as EventSubmission,
        });
      } else {
        errorHandler({ data: undefined, submission: currentSubmission as EventSubmission });
      }
      setIsSubmitting(false);
      return null;
    },
    [clearStepMaps, errorHandler, setIsSubmitting],
  );

  useEffect(() => {
    if (!submission || Object.keys(submission).length === 0) {
      logger.debug('[ResumableSSE] No submission, cleaning up');
      // Clear reconnect timeout if submission is cleared
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Close SSE but do NOT dispatch cancel - navigation should not abort
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      setStreamId(null);
      reconnectAttemptRef.current = 0;
      submissionRef.current = null;
      return;
    }

    const resumeStreamId = (submission as TSubmission & { resumeStreamId?: string }).resumeStreamId;
    logger.debug('[ResumableSSE] Effect triggered', {
      conversationId: submission.conversation?.conversationId,
      hasResumeStreamId: !!resumeStreamId,
      resumeStreamId,
      userMessageId: submission.userMessage?.messageId,
    });

    submissionRef.current = submission;

    const initStream = async () => {
      logClientState('init_stream', {
        resumeStreamId,
        submissionConversationId: submission.conversation?.conversationId,
      });
      setIsSubmitting(true);
      setShowStopButton(true);

      if (resumeStreamId) {
        // Resume: just subscribe to existing stream, don't start new generation
        logger.debug('[ResumableSSE] Resuming existing stream:', resumeStreamId);
        logClientState('resume_existing_stream', { resumeStreamId });
        setStreamId(resumeStreamId);
        // Optimistically add to active jobs (in case it's not already there)
        addActiveJob(resumeStreamId);
        subscribeToStream(resumeStreamId, submission, true); // isResume=true
      } else {
        // New generation: start and then subscribe
        logger.debug('[ResumableSSE] Starting NEW generation');
        logClientState('start_new_generation', {
          submissionConversationId: submission.conversation?.conversationId,
        });
        const newStreamId = await startGeneration(submission);
        if (newStreamId) {
          setStreamId(newStreamId);
          logClientState('generation_started', { newStreamId });
          // Optimistically add to active jobs
          addActiveJob(newStreamId);
          subscribeToStream(newStreamId, submission);
        } else {
          console.error('[ResumableSSE] Failed to get streamId from startGeneration');
          logClientState('generation_start_failed');
        }
      }
    };

    initStream();

    return () => {
      logger.debug('[ResumableSSE] Cleanup - closing SSE, resetting UI state');
      logClientState('effect_cleanup');
      // Cleanup on unmount/navigation - close connection but DO NOT abort backend
      // Reset UI state so it doesn't leak to other conversations
      // If user returns to this conversation, useResumeOnLoad will restore the state
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Reset reconnect counter before closing (so abort handler doesn't think we're reconnecting)
      reconnectAttemptRef.current = 0;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      // Clear handler maps to prevent memory leaks and stale state
      clearStepMaps();
      // Reset UI state on cleanup - useResumeOnLoad will restore if needed
      setIsSubmitting(false);
      setShowStopButton(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission]);

  return { streamId };
}
