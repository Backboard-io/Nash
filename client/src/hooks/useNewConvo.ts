import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { useRecoilState, useRecoilValue, useSetRecoilState, useRecoilCallback } from 'recoil';
import {
  Constants,
  FileSources,
  Permissions,
  EModelEndpoint,
  isParamEndpoint,
  PermissionTypes,
  getEndpointField,
  isAgentsEndpoint,
  LocalStorageKeys,
  isEphemeralAgentId,
  isAssistantsEndpoint,
  getDefaultParamsEndpoint,
  getModelName,
} from 'librechat-data-provider';
import type {
  TPreset,
  TSubmission,
  TModelsConfig,
  TConversation,
  TEndpointsConfig,
} from 'librechat-data-provider';
import type { AssistantListItem } from '~/common';
import {
  updateLastSelectedModel,
  getLocalStorageItems,
  getDefaultModelSpec,
  getDefaultEndpoint,
  getModelSpecPreset,
  buildDefaultConvo,
  logger,
} from '~/utils';
import { useDeleteFilesMutation, useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import useAssistantListMap from './Assistants/useAssistantListMap';
import { useResetChatBadges } from './useChatBadges';
import { useApplyModelSpecEffects } from './Agents';
import { usePauseGlobalAudio } from './Audio';
import { useHasAccess } from '~/hooks';
import store from '~/store';

// Ticket #2: a brand-new chat with no persona/model preference defaults to
// OpenAI GPT-4.1. Mirrors FALLBACK_MODEL in api/routes/chat.py.
const DEFAULT_NEW_CHAT_MODEL = 'openai/gpt-4.1';

const useNewConvo = (index = 0) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: startupConfig } = useGetStartupConfig();
  const applyModelSpecEffects = useApplyModelSpecEffects();
  const clearAllConversations = store.useClearConvoState();
  const defaultPreset = useRecoilValue(store.defaultPreset);
  const defaultChatModel = useRecoilValue<string>(store.defaultChatModel);
  const defaultPersona = useRecoilValue<string>(store.defaultPersona);
  const { setConversation } = store.useCreateConversationAtom(index);
  const [files, setFiles] = useRecoilState(store.filesByIndex(index));
  const saveBadgesState = useRecoilValue<boolean>(store.saveBadgesState);
  const activeFolderId = useRecoilValue(store.activeFolderId);
  const clearAllLatestMessages = store.useClearLatestMessages(`useNewConvo ${index}`);
  const setSubmission = useSetRecoilState<TSubmission | null>(store.submissionByIndex(index));
  const setIsSubmitting = useSetRecoilState(store.isSubmittingFamily(index));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(index));
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(index));
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();

  const hasAgentAccess = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.USE,
  });

  const modelsQuery = useGetModelsQuery();
  const assistantsListMap = useAssistantListMap();
  const { pauseGlobalAudio } = usePauseGlobalAudio(index);
  const saveDrafts = useRecoilValue<boolean>(store.saveDrafts);
  const resetBadges = useResetChatBadges();

  const getSelectableModels = useCallback(
    (modelsConfig: TModelsConfig | undefined, endpoint: EModelEndpoint | undefined): string[] => {
      if (!endpoint) {
        return [];
      }

      const endpointModels = modelsConfig?.[endpoint] ?? [];
      return endpointModels.map(getModelName);
    },
    [],
  );

  const { mutateAsync } = useDeleteFilesMutation({
    onSuccess: () => {
      console.log('Files deleted');
    },
    onError: (error) => {
      console.log('Error deleting files:', error);
    },
  });

  const switchToConversation = useRecoilCallback(
    () =>
      async (
        conversation: TConversation,
        preset: Partial<TPreset> | null = null,
        modelsData?: TModelsConfig,
        buildDefault?: boolean,
        keepLatestMessage?: boolean,
        keepAddedConvos?: boolean,
        disableFocus?: boolean,
        _disableParams?: boolean,
      ) => {
        const modelsConfig = modelsData ?? modelsQuery.data;
        const { endpoint = null } = conversation;
        const buildDefaultConversation = (endpoint === null || buildDefault) ?? false;
        const activePreset =
          // use default preset only when it's defined,
          // preset is not provided,
          // endpoint matches or is null (to allow endpoint change),
          // and buildDefaultConversation is true
          defaultPreset &&
          !preset &&
          (defaultPreset.endpoint === endpoint || !endpoint) &&
          buildDefaultConversation
            ? defaultPreset
            : preset;

        const disableParams =
          _disableParams ??
          (activePreset?.presetId != null &&
            activePreset.presetId &&
            activePreset.presetId === defaultPreset?.presetId);

        if (buildDefaultConversation) {
          let defaultEndpoint = getDefaultEndpoint({
            convoSetup: activePreset ?? conversation,
            endpointsConfig,
          });

          // If the selected endpoint is agents but user doesn't have access, find an alternative
          // Skip this check for existing agent conversations (they have agent_id set)
          // Also check localStorage for new conversations restored after refresh
          const { lastConversationSetup } = getLocalStorageItems();
          const storedAgentId =
            isAgentsEndpoint(lastConversationSetup?.endpoint) && lastConversationSetup?.agent_id;
          const isExistingAgentConvo =
            isAgentsEndpoint(defaultEndpoint) &&
            ((conversation.agent_id && !isEphemeralAgentId(conversation.agent_id)) ||
              (storedAgentId && !isEphemeralAgentId(storedAgentId)));
          if (
            defaultEndpoint &&
            isAgentsEndpoint(defaultEndpoint) &&
            !hasAgentAccess &&
            !isExistingAgentConvo
          ) {
            defaultEndpoint = Object.keys(endpointsConfig ?? {}).find(
              (ep) => !isAgentsEndpoint(ep as EModelEndpoint) && endpointsConfig?.[ep],
            ) as EModelEndpoint | undefined;
          }

          if (!defaultEndpoint) {
            // Find first available endpoint that's not agents (if no access) or any endpoint
            defaultEndpoint = Object.keys(endpointsConfig ?? {}).find((ep) => {
              if (
                isAgentsEndpoint(ep as EModelEndpoint) &&
                !hasAgentAccess &&
                !isExistingAgentConvo
              ) {
                return false;
              }
              return !!endpointsConfig?.[ep];
            }) as EModelEndpoint;
          }

          // Nash per-user defaults: seed brand-new default conversations with
          // the user's preferred persona or chat model. Only applied when no
          // preset is driving the convo and nothing was explicitly chosen, so
          // these compose with explicit selections instead of overriding them.
          const agentsAvailable = !!endpointsConfig?.[EModelEndpoint.agents];
          let seedDefaultPersona = false;
          if (!activePreset && !conversation.agent_id && !conversation.model) {
            // A default chat model wins over a default persona, and it must
            // apply no matter which endpoint owns it. The Settings "default
            // model" dropdown aggregates models across EVERY endpoint, so the
            // chosen model frequently isn't in the current default endpoint (nor
            // the agents endpoint) — matching only those two silently dropped it
            // and the chat fell back to gpt-4.1. Find whichever endpoint
            // actually offers the model, switch to it, and set the model.
            let appliedDefaultModel = false;
            if (defaultChatModel) {
              const owningEndpoint = getSelectableModels(modelsConfig, defaultEndpoint).includes(
                defaultChatModel,
              )
                ? defaultEndpoint
                : (Object.keys(modelsConfig ?? {}) as EModelEndpoint[]).find((ep) =>
                    getSelectableModels(modelsConfig, ep).includes(defaultChatModel),
                  );
              if (owningEndpoint) {
                defaultEndpoint = owningEndpoint;
                conversation.model = defaultChatModel;
                appliedDefaultModel = true;
              }
            }
            if (appliedDefaultModel) {
              // model applied above — nothing else to seed.
            } else if (defaultPersona && agentsAvailable && !isExistingAgentConvo) {
              // A persona is an agent; route through the agents endpoint. The
              // agent_id is applied after buildDefaultConvo (below) so parseConvo
              // cannot clobber it.
              defaultEndpoint = EModelEndpoint.agents;
              seedDefaultPersona = true;
            } else if (
              getSelectableModels(modelsConfig, defaultEndpoint).includes(DEFAULT_NEW_CHAT_MODEL)
            ) {
              // Ticket #2: with no persona or chat-model preference, a brand-new
              // chat defaults to OpenAI GPT-4.1 — not the latest-sorted model
              // (MODEL_PRIORITY puts gpt-5.x first) nor Backboard's Anthropic
              // fallback. Explicit selections and the Settings default above win.
              conversation.model = DEFAULT_NEW_CHAT_MODEL;
            }
          }

          const endpointType = getEndpointField(endpointsConfig, defaultEndpoint, 'type');
          if (!conversation.endpointType && endpointType) {
            conversation.endpointType = endpointType;
          } else if (conversation.endpointType && !endpointType) {
            conversation.endpointType = undefined;
          }

          const isAssistantEndpoint = isAssistantsEndpoint(defaultEndpoint);
          const assistants: AssistantListItem[] = assistantsListMap[defaultEndpoint] ?? [];
          const currentAssistantId = conversation.assistant_id ?? '';
          const currentAssistant = assistantsListMap[defaultEndpoint]?.[currentAssistantId] as
            | AssistantListItem
            | undefined;

          if (currentAssistantId && !currentAssistant) {
            conversation.assistant_id = undefined;
          }

          if (!currentAssistantId && isAssistantEndpoint) {
            conversation.assistant_id =
              localStorage.getItem(
                `${LocalStorageKeys.ASST_ID_PREFIX}${index}${defaultEndpoint}`,
              ) ?? assistants[0]?.id;
          }

          if (
            currentAssistantId &&
            isAssistantEndpoint &&
            conversation.conversationId === Constants.NEW_CONVO
          ) {
            const assistant = assistants.find((asst) => asst.id === currentAssistantId);
            conversation.model = assistant?.model;
            updateLastSelectedModel({
              endpoint: defaultEndpoint,
              model: conversation.model,
            });
          }

          if (currentAssistantId && !isAssistantEndpoint) {
            conversation.assistant_id = undefined;
          }

          const models = getSelectableModels(modelsConfig, defaultEndpoint);
          const defaultParamsEndpoint = getDefaultParamsEndpoint(endpointsConfig, defaultEndpoint);
          conversation = buildDefaultConvo({
            conversation,
            lastConversationSetup: activePreset as TConversation,
            endpoint: defaultEndpoint,
            models,
            defaultParamsEndpoint,
          });

          // Apply the default persona after buildDefaultConvo so parseConvo
          // can't clobber it. Gated on the pre-build decision (seedDefaultPersona)
          // rather than re-inferring from the endpoint, so we never override an
          // explicit model just because the resolved endpoint happens to be agents.
          // Personas are real (non-ephemeral) agents that bring their own model,
          // so clear any seeded model.
          if (seedDefaultPersona && !conversation.agent_id) {
            conversation.agent_id = defaultPersona;
            conversation.model = undefined;
          }
        }

        if (disableParams === true) {
          conversation.disableParams = true;
        }

        if (!(keepAddedConvos ?? false)) {
          clearAllConversations(true);
        }
        const isCancelled = conversation.conversationId?.startsWith('_');
        if (isCancelled) {
          logger.log(
            'conversation',
            'Cancelled conversation, setting to `new` in `useNewConvo`',
            conversation,
          );
          setConversation({
            ...conversation,
            conversationId: Constants.NEW_CONVO as string,
          });
        } else {
          logger.log('conversation', 'Setting conversation from `useNewConvo`', conversation);
          setConversation(conversation);
        }
        setIsSubmitting(false);
        setShowStopButton(false);
        setActiveRunId(null);
        setSubmission({} as TSubmission);
        if (!(keepLatestMessage ?? false)) {
          logger.log('latest_message', 'Clearing all latest messages');
          clearAllLatestMessages();
        }
        if (isCancelled) {
          return;
        }

        const searchParamsString = searchParams?.toString();
        const getParams = () => (searchParamsString ? `?${searchParamsString}` : '');

        if (conversation.conversationId === Constants.NEW_CONVO && !modelsData) {
          const appTitle = localStorage.getItem(LocalStorageKeys.APP_TITLE) ?? '';
          if (appTitle) {
            document.title = appTitle;
          }
          const path = `/c/${Constants.NEW_CONVO}${getParams()}`;
          navigate(path, { state: { focusChat: true } });
          return;
        }

        const path = `/c/${conversation.conversationId}${getParams()}`;
        navigate(path, {
          replace: true,
          state: disableFocus ? {} : { focusChat: true },
        });
      },
    [
      endpointsConfig,
      defaultPreset,
      defaultChatModel,
      defaultPersona,
      assistantsListMap,
      modelsQuery.data,
      hasAgentAccess,
      getSelectableModels,
      setIsSubmitting,
      setShowStopButton,
      setActiveRunId,
    ],
  );

  const newConversation = useCallback(
    function createNewConvo({
      template: _template = {},
      preset: _preset,
      modelsData,
      disableFocus,
      buildDefault = true,
      keepLatestMessage = false,
      keepAddedConvos = false,
      keepFiles = false,
      disableParams,
    }: {
      template?: Partial<TConversation>;
      preset?: Partial<TPreset>;
      modelsData?: TModelsConfig;
      buildDefault?: boolean;
      disableFocus?: boolean;
      keepLatestMessage?: boolean;
      keepAddedConvos?: boolean;
      keepFiles?: boolean;
      disableParams?: boolean;
    } = {}) {
      pauseGlobalAudio();
      if (!saveBadgesState) {
        resetBadges();
      }

      const templateConvoId = _template.conversationId ?? '';
      const paramEndpoint =
        isParamEndpoint(_template.endpoint ?? '', _template.endpointType ?? '') === true ||
        isParamEndpoint(_preset?.endpoint ?? '', _preset?.endpointType ?? '');
      const template =
        paramEndpoint === true && templateConvoId && templateConvoId === Constants.NEW_CONVO
          ? { endpoint: _template.endpoint }
          : _template;

      const templateFolderId = (template as { folderId?: string | null }).folderId;
      const resolvedFolderId = templateFolderId !== undefined ? templateFolderId : activeFolderId;
      const conversation = {
        conversationId: Constants.NEW_CONVO as string,
        title: 'New Chat',
        endpoint: null,
        ...template,
        createdAt: '',
        updatedAt: '',
        ...(resolvedFolderId ? { folderId: resolvedFolderId } : {}),
      };

      let preset = _preset;
      const result = getDefaultModelSpec(startupConfig);
      const defaultModelSpec = result?.default ?? result?.last;
      if (
        !preset &&
        startupConfig &&
        (startupConfig.modelSpecs?.prioritize === true ||
          (startupConfig.interface?.modelSelect ?? true) !== true ||
          (result?.last != null && Object.keys(_template).length === 0)) &&
        defaultModelSpec
      ) {
        preset = getModelSpecPreset(defaultModelSpec);
      }

      applyModelSpecEffects({
        startupConfig,
        specName: preset?.spec,
        convoId: conversation.conversationId,
      });

      // Swapping the endpoint/model on an unsent draft comes through here too.
      // That is not a new chat, so the composer's attachments must survive it.
      if (
        conversation.conversationId === Constants.NEW_CONVO &&
        !modelsData &&
        !keepFiles
      ) {
        const filesToDelete = Array.from(files.values())
          .filter(
            (file) =>
              file.filepath != null &&
              file.filepath !== '' &&
              file.source &&
              !(file.embedded ?? false) &&
              file.temp_file_id,
          )
          .map((file) => ({
            file_id: file.file_id,
            embedded: !!(file.embedded ?? false),
            filepath: file.filepath as string,
            source: file.source as FileSources, // Ensure that the source is of type FileSources
          }));

        setFiles(new Map());
        localStorage.setItem(LocalStorageKeys.FILES_TO_DELETE, JSON.stringify({}));

        if (!saveDrafts && filesToDelete.length > 0) {
          mutateAsync({ files: filesToDelete });
        }
      }

      switchToConversation(
        conversation,
        preset,
        modelsData,
        buildDefault,
        keepLatestMessage,
        keepAddedConvos,
        disableFocus,
        disableParams,
      );
    },
    [
      files,
      setFiles,
      saveDrafts,
      mutateAsync,
      resetBadges,
      startupConfig,
      saveBadgesState,
      activeFolderId,
      pauseGlobalAudio,
      switchToConversation,
      applyModelSpecEffects,
    ],
  );

  return {
    switchToConversation,
    newConversation,
  };
};

export default useNewConvo;
