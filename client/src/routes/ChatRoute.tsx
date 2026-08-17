import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useRecoilCallback, useRecoilValue } from 'recoil';
import { Spinner, useToastContext } from '@librechat/client';
import { Constants, EModelEndpoint } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import type { TPreset } from 'librechat-data-provider';
import {
  useNewConvo,
  useAppStartup,
  useAssistantListMap,
  useIdChangeEffect,
  useLocalize,
} from '~/hooks';
import { useGetConvoIdQuery, useGetStartupConfig, useGetEndpointsQuery } from '~/data-provider';
import { getDefaultModelSpec, getModelSpecPreset, logger, isNotFoundError } from '~/utils';
import { ToolCallsMapProvider } from '~/Providers';
import { readPendingChatDraft, clearPendingChatDraft } from '~/utils/auth/pendingChat';
import ChatView from '~/components/Chat/ChatView';
import { NotificationSeverity } from '~/common';
import useAuthRedirect from './useAuthRedirect';
import temporaryStore from '~/store/temporary';
import store from '~/store';

export default function ChatRoute() {
  const { data: startupConfig } = useGetStartupConfig();
  const { isAuthenticated, user, roles } = useAuthRedirect();
  const resumedPendingDraftRef = useRef(false);

  const defaultTemporaryChat = useRecoilValue(temporaryStore.defaultTemporaryChat);
  const setIsTemporary = useRecoilCallback(
    ({ set }) =>
      (value: boolean) => {
        set(temporaryStore.isTemporary, value);
      },
    [],
  );
  useAppStartup({ startupConfig, user });

  const index = 0;
  const { conversationId = '' } = useParams();
  useIdChangeEffect(conversationId);
  const { hasSetConversation, conversation } = store.useCreateConversationAtom(index);
  const { newConversation } = useNewConvo();
  const defaultChatModel = useRecoilValue<string>(store.defaultChatModel);
  const defaultPersona = useRecoilValue<string>(store.defaultPersona);
  const { showToast } = useToastContext();
  const localize = useLocalize();

  const modelsQuery = useGetModelsQuery();
  const initialConvoQuery = useGetConvoIdQuery(conversationId, {
    enabled:
      isAuthenticated && conversationId !== Constants.NEW_CONVO && !hasSetConversation.current,
  });
  const endpointsQuery = useGetEndpointsQuery();
  const assistantListMap = useAssistantListMap();

  const isTemporaryChat = conversation && conversation.expiredAt ? true : false;

  useEffect(() => {
    if (conversationId === Constants.NEW_CONVO) {
      setIsTemporary(defaultTemporaryChat);
    } else if (isTemporaryChat) {
      setIsTemporary(isTemporaryChat);
    } else {
      setIsTemporary(false);
    }
  }, [conversationId, isTemporaryChat, setIsTemporary, defaultTemporaryChat]);

  /**
   * Re-apply the user's Settings default (model/persona) to an OPEN, empty new
   * chat when it changes, so a new default takes effect WITHOUT a page refresh.
   * The main effect below builds the conversation only once per mount (guarded
   * by hasSetConversation), so a Settings change never reaches an already-open
   * new chat on its own. We skip the initial render (the default's starting
   * value) and only rebuild a brand-new NEW_CONVO — never an in-progress chat.
   */
  const didInitDefaultsRef = useRef(false);
  useEffect(() => {
    if (!didInitDefaultsRef.current) {
      didInitDefaultsRef.current = true;
      return;
    }
    if (conversationId === Constants.NEW_CONVO && modelsQuery.data && endpointsQuery.data) {
      // No template → conversation.model is unset → useNewConvo re-applies the
      // (now-changed) Settings default instead of keeping the old model.
      newConversation({ modelsData: modelsQuery.data });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultChatModel, defaultPersona]);

  /** This effect is mainly for the first conversation state change on first load of the page.
   *  Adjusting this may have unintended consequences on the conversation state.
   */
  useEffect(() => {
    // Wait for roles to load for authenticated users so hasAgentAccess has a definitive value in useNewConvo
    const rolesLoaded = !isAuthenticated || roles?.USER != null;
    const shouldSetConvo =
      (startupConfig &&
        rolesLoaded &&
        !hasSetConversation.current &&
        !modelsQuery.data?.initial) ??
      false;
    /* Early exit if startupConfig is not loaded and conversation is already set and only initial models have loaded */
    if (!shouldSetConvo) {
      return;
    }

    if (
      conversationId === Constants.NEW_CONVO &&
      endpointsQuery.data &&
      modelsQuery.data &&
      !isAuthenticated
    ) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      logger.log('conversation', 'ChatRoute, anonymous preview new convo effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: conversation ? conversation : undefined,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });

      hasSetConversation.current = true;
    } else if (conversationId === Constants.NEW_CONVO && endpointsQuery.data && modelsQuery.data) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      logger.log('conversation', 'ChatRoute, new convo effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: conversation ? conversation : undefined,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });

      hasSetConversation.current = true;
    } else if (initialConvoQuery.data && endpointsQuery.data && modelsQuery.data) {
      logger.log('conversation', 'ChatRoute initialConvoQuery', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        /* this is necessary to load all existing settings */
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    } else if (
      conversationId &&
      endpointsQuery.data &&
      modelsQuery.data &&
      initialConvoQuery.isError &&
      isNotFoundError(initialConvoQuery.error)
    ) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      showToast({
        message: localize('com_ui_conversation_not_found'),
        severity: NotificationSeverity.WARNING,
      });
      logger.log(
        'conversation',
        'ChatRoute initialConvoQuery isNotFoundError',
        initialConvoQuery.error,
      );
      newConversation({
        modelsData: modelsQuery.data,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });
      hasSetConversation.current = true;
    } else if (
      conversationId === Constants.NEW_CONVO &&
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      logger.log('conversation', 'ChatRoute new convo, assistants effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: conversation ? conversation : undefined,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });
      hasSetConversation.current = true;
    } else if (
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      logger.log('conversation', 'ChatRoute convo, assistants effect', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    }
    /* Creates infinite render if all dependencies included due to newConversation invocations exceeding call stack before hasSetConversation.current becomes truthy */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuthenticated,
    roles,
    startupConfig,
    initialConvoQuery.data,
    initialConvoQuery.isError,
    endpointsQuery.data,
    modelsQuery.data,
    assistantListMap,
  ]);

  useEffect(() => {
    if (!isAuthenticated || resumedPendingDraftRef.current) {
      return;
    }

    const pendingDraft = readPendingChatDraft();
    if (!pendingDraft?.text) {
      return;
    }

    resumedPendingDraftRef.current = true;

    if (pendingDraft.autoSend) {
      clearPendingChatDraft();
      newConversation({
        modelsData: modelsQuery.data,
        template: (pendingDraft.conversation as TPreset | null) ?? undefined,
        preset: (pendingDraft.conversation as TPreset | null) ?? undefined,
      });

      window.setTimeout(() => {
        const submitEvent = new CustomEvent('submitPendingChatDraft', {
          detail: {
            text: pendingDraft.text,
            addedConversation: pendingDraft.addedConversation ?? undefined,
          },
        });
        window.dispatchEvent(submitEvent);
      }, 50);
      return;
    }

    clearPendingChatDraft();
  }, [isAuthenticated, modelsQuery.data, newConversation]);

  if (
    endpointsQuery.isLoading ||
    (isAuthenticated && modelsQuery.isLoading)
  ) {
    return (
      <div className="flex h-screen items-center justify-center" aria-live="polite" role="status">
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <ToolCallsMapProvider conversationId={conversation?.conversationId ?? conversationId ?? ''}>
        <ChatView index={index} />
      </ToolCallsMapProvider>
    );
  }

  // if not a conversation
  if (conversation?.conversationId === Constants.SEARCH) {
    return null;
  }
  // if conversationId not match
  if (conversation?.conversationId !== conversationId && !conversation) {
    return null;
  }
  // if conversationId is null
  if (!conversationId) {
    return null;
  }

  return (
    <ToolCallsMapProvider conversationId={conversation.conversationId ?? ''}>
      <ChatView index={index} />
    </ToolCallsMapProvider>
  );
}
