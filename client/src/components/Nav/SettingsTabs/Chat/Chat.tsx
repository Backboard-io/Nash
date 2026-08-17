import { memo } from 'react';
import { showThinkingAtom } from '~/store/showThinking';
import FontSizeSelector from './FontSizeSelector';
import ChatDirection from './ChatDirection';
import ToggleSwitch from '../ToggleSwitch';
import store from '~/store';
import ChatAssistantPromptCard from '~/components/ChatAssistantPrompt/ChatAssistantPromptCard';

const toggleSwitchConfigs = [
  {
    stateAtom: store.enterToSend,
    localizationKey: 'com_nav_enter_to_send' as const,
    switchId: 'enterToSend',
    hoverCardText: 'com_nav_info_enter_to_send' as const,
    key: 'enterToSend',
  },
  {
    stateAtom: store.maximizeChatSpace,
    localizationKey: 'com_nav_maximize_chat_space' as const,
    switchId: 'maximizeChatSpace',
    hoverCardText: undefined,
    key: 'maximizeChatSpace',
  },
  {
    stateAtom: store.centerFormOnLanding,
    localizationKey: 'com_nav_center_chat_input' as const,
    switchId: 'centerFormOnLanding',
    hoverCardText: undefined,
    key: 'centerFormOnLanding',
  },
  {
    stateAtom: showThinkingAtom,
    localizationKey: 'com_nav_show_thinking' as const,
    switchId: 'showThinking',
    hoverCardText: undefined,
    key: 'showThinking',
  },
  {
    stateAtom: store.showCode,
    localizationKey: 'com_nav_show_code' as const,
    switchId: 'showCode',
    hoverCardText: undefined,
    key: 'showCode',
  },
  {
    stateAtom: store.LaTeXParsing,
    localizationKey: 'com_nav_latex_parsing' as const,
    switchId: 'latexParsing',
    hoverCardText: 'com_nav_info_latex_parsing' as const,
    key: 'latexParsing',
  },
  {
    stateAtom: store.saveDrafts,
    localizationKey: 'com_nav_save_drafts' as const,
    switchId: 'saveDrafts',
    hoverCardText: 'com_nav_info_save_draft' as const,
    key: 'saveDrafts',
  },
  {
    stateAtom: store.showScrollButton,
    localizationKey: 'com_nav_scroll_button' as const,
    switchId: 'showScrollButton',
    hoverCardText: undefined,
    key: 'showScrollButton',
  },
  {
    stateAtom: store.fallbackModel,
    localizationKey: 'com_nav_fallback_model' as const,
    switchId: 'fallbackModel',
    hoverCardText: 'com_nav_info_fallback_model' as const,
    key: 'fallbackModel',
  },
  {
    stateAtom: store.saveBadgesState,
    localizationKey: 'com_nav_save_badges_state' as const,
    switchId: 'showBadges',
    hoverCardText: 'com_nav_info_save_badges_state' as const,
    key: 'showBadges',
  },
  {
    stateAtom: store.modularChat,
    localizationKey: 'com_nav_modular_chat' as const,
    switchId: 'modularChat',
    hoverCardText: undefined,
    key: 'modularChat',
  },
  {
    stateAtom: store.defaultTemporaryChat,
    localizationKey: 'com_nav_default_temporary_chat' as const,
    switchId: 'defaultTemporaryChat',
    hoverCardText: 'com_nav_info_default_temporary_chat' as const,
    key: 'defaultTemporaryChat',
  },
];

function Chat() {
  return (
    <div className="flex flex-col divide-y divide-border-subtle text-[13.5px] leading-[20px] text-text-primary">
      <section aria-labelledby="chat-assistant-prompt-heading" className="pb-4">
        <h2 id="chat-assistant-prompt-heading" className="sr-only">
          Chat assistant system prompt
        </h2>
        <ChatAssistantPromptCard className="w-full" />
      </section>
      <div className="py-[15px]">
        <FontSizeSelector />
      </div>
      <div className="py-[15px]">
        <ChatDirection />
      </div>
      {toggleSwitchConfigs.map((config) => (
        <div key={config.key} className="py-[15px]">
          <ToggleSwitch
            stateAtom={config.stateAtom}
            localizationKey={config.localizationKey}
            hoverCardText={config.hoverCardText}
            switchId={config.switchId}
          />
        </div>
      ))}
    </div>
  );
}

export default memo(Chat);
