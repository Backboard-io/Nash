import React, { memo, useMemo, useRef, useState } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { ChevronRight, Image as ImageIcon, Paperclip, Settings, X } from 'lucide-react';
import { FileUpload } from '@librechat/client';
import {
  Tools,
  Constants,
  Providers,
  supportsFiles,
  EModelEndpoint,
  mergeFileConfig,
  getEndpointField,
  isAgentsEndpoint,
  getEndpointFileConfig,
  bedrockDocumentExtensions,
  isDocumentSupportedProvider,
  PermissionTypes,
  Permissions,
} from 'librechat-data-provider';
import { useChatContext, useBadgeRowContext, useAgentsMapContext } from '~/Providers';
import { useGetFileConfig, useGetEndpointsQuery } from '~/data-provider';
import { useAgentToolPermissions, useFileHandling, useHasAccess, useLocalize } from '~/hooks';
import { ServerIcon, WaveformIcon } from '~/components/svg/NashComposerIcons';
import NashBottomSheet from '~/components/ui/NashBottomSheet';
import VoiceModeButton from '../Voice/VoiceModeButton';
import { MobileMCPSheet } from './MCPSelect';
import store, { ephemeralAgentByConvoId } from '~/store';
import { cn } from '~/utils';

/** Figma icon/tempChat — same exported vector as TemporaryChatToggle (17-grid). */
function TempChatIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M14.875 8.14585C14.8687 9.16222 14.6052 10.1605 14.1091 11.0475C13.613 11.9346 12.9004 12.6817 12.0377 13.2191C11.1751 13.7565 10.1904 14.0668 9.17541 14.121C8.16047 14.1752 7.14833 13.9716 6.23329 13.5292L2.47913 14.5208L3.47079 10.8375C3.06387 10.0251 2.84611 9.13105 2.83384 8.22248C2.82158 7.3139 3.01512 6.41433 3.39996 5.5912C3.7848 4.76806 4.35096 4.0427 5.05601 3.4695C5.76106 2.89629 6.5867 2.4901 7.47106 2.28137C8.35542 2.07264 9.27556 2.06678 10.1625 2.26424C11.0494 2.4617 11.8802 2.85735 12.5925 3.42154C13.3048 3.98572 13.8801 4.70381 14.2754 5.52199C14.6707 6.34016 14.8757 7.23719 14.875 8.14585Z"
        stroke="currentColor"
        strokeWidth="1.41667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 4.95831V7.79165L10.2708 8.85415"
        stroke="currentColor"
        strokeWidth="1.41667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Divider() {
  return <div className="mx-3 h-px bg-surface-primary-alt dark:bg-border-light" aria-hidden="true" />;
}

const rowClassName = cn(
  'flex h-12 w-full items-center justify-between rounded-[10px] px-3',
  'transition-colors hover:bg-surface-active focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

/**
 * Mobile "Add to Chat" bottom sheet (Figma sheet-model-v3): opened by the
 * composer Plus on small screens, it hosts the features that live in the
 * desktop composer tool row — Add File, Create Image, Temp Chat, MCP Servers,
 * Voice Mode and Settings. Must be rendered inside BadgeRowProvider.
 */
function MobileToolsSheet({
  open,
  onClose,
  disableInputs = false,
}: {
  open: boolean;
  onClose: () => void;
  disableInputs?: boolean;
}) {
  const localize = useLocalize();
  const inputRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<HTMLDivElement>(null);
  const [mcpSheetOpen, setMcpSheetOpen] = useState(false);

  const { conversation, isSubmitting, newConversation } = useChatContext();
  const { conversationId, imageGeneration } = useBadgeRowContext();
  const { toggleState: imageToggle, setToggleState: setImageToggle } = imageGeneration;
  const imageOn = imageToggle === true;

  const [isTemporary, setIsTemporary] = useRecoilState(store.isTemporary);
  const setShowSettings = useSetRecoilState(store.showSettings);
  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(
    ephemeralAgentByConvoId(conversationId ?? Constants.NEW_CONVO),
  );

  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });

  const { handleFileChange } = useFileHandling();
  const agentsMap = useAgentsMapContext();
  const { endpoint } = conversation ?? { endpoint: null };
  const agentId = conversation?.agent_id;
  const { provider } = useAgentToolPermissions(agentId, ephemeralAgent);

  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { data: fileConfig = null } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });

  const endpointType = useMemo(
    () =>
      getEndpointField(endpointsConfig, endpoint, 'type') ||
      (endpoint as EModelEndpoint | undefined),
    [endpoint, endpointsConfig],
  );

  const useResponsesApi = useMemo(() => {
    if (!agentId || conversation?.useResponsesApi) {
      return conversation?.useResponsesApi;
    }
    return agentsMap?.[agentId]?.model_parameters?.useResponsesApi;
  }, [agentId, conversation?.useResponsesApi, agentsMap]);

  const canUploadFiles = useMemo(() => {
    const endpointFileConfig = getEndpointFileConfig({ endpoint, fileConfig, endpointType });
    const endpointSupportsFiles: boolean = supportsFiles[endpointType ?? endpoint ?? ''] ?? false;
    return (
      isAgentsEndpoint(endpoint) ||
      (endpointSupportsFiles && !(endpointFileConfig?.disabled ?? false))
    );
  }, [endpoint, fileConfig, endpointType]);

  /** Same accept rules as AttachFileMenu's primary upload item. */
  const acceptTypes = useMemo(() => {
    let currentProvider = provider || endpoint;
    if (currentProvider?.toLowerCase() === Providers.OPENROUTER) {
      currentProvider = Providers.OPENROUTER;
    }
    const isAzureWithResponsesApi =
      currentProvider === EModelEndpoint.azureOpenAI && useResponsesApi;
    if (
      isDocumentSupportedProvider(endpointType) ||
      isDocumentSupportedProvider(currentProvider ?? undefined) ||
      isAzureWithResponsesApi
    ) {
      if (currentProvider === Providers.GOOGLE || currentProvider === Providers.OPENROUTER) {
        return `image/*,.heif,.heic,${bedrockDocumentExtensions},video/*,audio/*`;
      }
      return `image/*,.heif,.heic,${bedrockDocumentExtensions}`;
    }
    return 'image/*,.heif,.heic';
  }, [provider, endpoint, endpointType, useResponsesApi]);

  const handleAddFile = () => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.value = '';
    inputRef.current.accept = acceptTypes;
    inputRef.current.click();
    inputRef.current.accept = '';
    onClose();
  };

  const handleCreateImage = () => {
    setImageToggle(!imageOn);
    onClose();
  };

  const hasMessages =
    Array.isArray(conversation?.messages) && (conversation?.messages.length ?? 0) >= 1;

  const handleTempChat = () => {
    const next = !isTemporary;
    setIsTemporary(next);
    if (next) {
      setEphemeralAgent((prev) => ({
        ...(prev || {}),
        [Tools.memory]: 'Off',
      }));
    }
    if (hasMessages) {
      newConversation();
    }
    onClose();
  };

  const handleMcpServers = () => {
    onClose();
    setMcpSheetOpen(true);
  };

  const handleVoiceMode = () => {
    onClose();
    voiceRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-label="Open voice mode"]')
      ?.click();
  };

  const handleSettings = () => {
    onClose();
    setShowSettings(true);
  };

  return (
    <>
      <FileUpload
        ref={inputRef}
        handleFileChange={(e) => {
          handleFileChange(e);
        }}
      >
        <span className="hidden" aria-hidden="true" />
      </FileUpload>
      <div ref={voiceRef} className="hidden" aria-hidden="true">
        <VoiceModeButton />
      </div>
      {canUseMcp && <MobileMCPSheet open={mcpSheetOpen} onClose={() => setMcpSheetOpen(false)} />}
      <NashBottomSheet open={open} onClose={onClose} ariaLabel={localize('com_ui_add_to_chat')}>
        <div className="px-4 pb-4">
          <div className="flex h-5 items-center justify-center">
            <div
              className="h-1 w-9 rounded-full bg-text-secondary-alt dark:bg-border-light"
              aria-hidden="true"
            />
          </div>
          <div className="flex items-center justify-between pb-2.5 pt-1">
            <span className="text-[18px] font-semibold leading-[27px] text-text-primary">
              {localize('com_ui_add_to_chat')}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={localize('com_ui_close')}
              className="flex size-7 items-center justify-center rounded-full bg-surface-hover text-text-secondary transition-colors hover:bg-surface-active"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-stretch gap-2.5">
            <button
              type="button"
              onClick={handleAddFile}
              disabled={disableInputs || !canUploadFiles}
              aria-label={localize('com_ui_add_file')}
              className={cn(
                'flex h-[81px] flex-1 flex-col items-center gap-1.5 rounded-[14px] bg-surface-hover pb-3.5 pt-[18px] text-text-secondary',
                'transition-colors hover:bg-surface-active focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              <Paperclip size={24} aria-hidden="true" />
              <span className="text-[12.5px] leading-[18.75px] text-text-primary dark:text-text-secondary">
                {localize('com_ui_add_file')}
              </span>
            </button>
            <button
              type="button"
              onClick={handleCreateImage}
              aria-label={localize('com_ui_create_image')}
              aria-pressed={imageOn}
              className={cn(
                'flex h-[81px] flex-1 flex-col items-center gap-1.5 rounded-[14px] pb-3.5 pt-[18px]',
                'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                imageOn
                  ? 'bg-brand-purple/10 text-brand-purple hover:bg-brand-purple/20'
                  : 'bg-surface-hover text-text-secondary hover:bg-surface-active',
              )}
            >
              <ImageIcon size={24} aria-hidden="true" />
              <span
                className={cn(
                  'text-[12.5px] leading-[18.75px]',
                  imageOn
                    ? 'text-brand-purple'
                    : 'text-text-primary dark:text-text-secondary',
                )}
              >
                {localize('com_ui_create_image')}
              </span>
            </button>
          </div>
          <div className="h-3" aria-hidden="true" />
          <div className="rounded-[14px] bg-surface-hover p-1">
            <button
              type="button"
              onClick={handleTempChat}
              disabled={isSubmitting}
              aria-label={
                isTemporary
                  ? localize('com_ui_temporary_off')
                  : localize('com_ui_temporary_on')
              }
              aria-pressed={isTemporary}
              className={rowClassName}
            >
              <span className="flex items-center gap-3">
                <span className={cn(isTemporary ? 'text-brand-purple' : 'text-text-secondary')}>
                  <TempChatIcon size={18} />
                </span>
                <span className="text-[14.5px] leading-[21.75px] text-text-primary">
                  {localize('com_ui_temp_chat')}
                </span>
              </span>
              {isTemporary && (
                <span className="size-2 rounded-full bg-brand-purple" aria-hidden="true" />
              )}
            </button>
            {canUseMcp && (
              <>
                <Divider />
                <button
                  type="button"
                  onClick={handleMcpServers}
                  aria-label={localize('com_ui_mcp_servers')}
                  aria-haspopup="dialog"
                  className={rowClassName}
                >
                  <span className="flex items-center gap-3">
                    <ServerIcon size={18} className="text-text-secondary" />
                    <span className="text-[14.5px] leading-[21.75px] text-text-primary">
                      {localize('com_ui_mcp_servers')}
                    </span>
                  </span>
                  <ChevronRight size={14} className="text-text-secondary" aria-hidden="true" />
                </button>
              </>
            )}
            <Divider />
            <button
              type="button"
              onClick={handleVoiceMode}
              aria-label={localize('com_ui_voice_mode')}
              className={rowClassName}
            >
              <span className="flex items-center gap-3">
                <WaveformIcon size={18} className="text-text-secondary" />
                <span className="text-[14.5px] leading-[21.75px] text-text-primary">
                  {localize('com_ui_voice_mode')}
                </span>
              </span>
            </button>
          </div>
          <div className="h-3" aria-hidden="true" />
          <div className="rounded-[14px] bg-surface-hover p-1">
            <button
              type="button"
              onClick={handleSettings}
              aria-label={localize('com_nav_settings')}
              className={rowClassName}
            >
              <span className="flex items-center gap-3">
                <Settings size={18} className="text-text-secondary" aria-hidden="true" />
                <span className="text-[14.5px] leading-[21.75px] text-text-primary">
                  {localize('com_nav_settings')}
                </span>
              </span>
              <ChevronRight size={14} className="text-text-secondary" aria-hidden="true" />
            </button>
          </div>
        </div>
      </NashBottomSheet>
    </>
  );
}

export default memo(MobileToolsSheet);
