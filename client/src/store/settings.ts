import { atom } from 'recoil';
import { SettingsViews, LocalStorageKeys } from 'librechat-data-provider';
import { atomWithLocalStorage } from '~/store/utils';
import type { TOptionSettings } from '~/common';

// Static atoms without localStorage
const staticAtoms = {
  abortScroll: atom<boolean>({ key: 'abortScroll', default: false }),
  optionSettings: atom<TOptionSettings>({ key: 'optionSettings', default: {} }),
  currentSettingsView: atom<SettingsViews>({
    key: 'currentSettingsView',
    default: SettingsViews.default,
  }),
  showPopover: atom<boolean>({ key: 'showPopover', default: false }),
  // Which controls panel is open in the left slide-out (nav link id, e.g. 'agents',
  // 'memories', 'files', 'bookmarks', 'prompts'); null when closed.
  openControlPanel: atom<string | null>({ key: 'openControlPanel', default: null }),
};

const localStorageAtoms = {
  // General settings
  autoScroll: atomWithLocalStorage('autoScroll', false),
  hideSidePanel: atomWithLocalStorage('hideSidePanel', false),
  enableUserMsgMarkdown: atomWithLocalStorage<boolean>(
    LocalStorageKeys.ENABLE_USER_MSG_MARKDOWN,
    true,
  ),
  keepScreenAwake: atomWithLocalStorage('keepScreenAwake', true),

  // Chat settings
  enterToSend: atomWithLocalStorage('enterToSend', true),
  maximizeChatSpace: atomWithLocalStorage('maximizeChatSpace', false),
  chatDirection: atomWithLocalStorage('chatDirection', 'LTR'),
  showCode: atomWithLocalStorage(LocalStorageKeys.SHOW_ANALYSIS_CODE, true),
  saveDrafts: atomWithLocalStorage('saveDrafts', true),
  showScrollButton: atomWithLocalStorage('showScrollButton', true),
  showThinking: atomWithLocalStorage('showThinking', false),
  saveBadgesState: atomWithLocalStorage('saveBadgesState', false),
  fallbackModel: atomWithLocalStorage('fallbackModel', true),

  // Beta features settings
  modularChat: atomWithLocalStorage('modularChat', true),
  LaTeXParsing: atomWithLocalStorage('LaTeXParsing', true),
  centerFormOnLanding: atomWithLocalStorage('centerFormOnLanding', true),
  showFooter: atomWithLocalStorage('showFooter', true),

  // Commands settings
  atCommand: atomWithLocalStorage('atCommand', true),
  plusCommand: atomWithLocalStorage('plusCommand', true),
  slashCommand: atomWithLocalStorage('slashCommand', true),

  // Speech settings
  conversationMode: atomWithLocalStorage('conversationMode', false),
  advancedMode: atomWithLocalStorage('advancedMode', false),

  speechToText: atomWithLocalStorage('speechToText', true),
  engineSTT: atomWithLocalStorage('engineSTT', 'browser'),
  languageSTT: atomWithLocalStorage('languageSTT', ''),
  autoTranscribeAudio: atomWithLocalStorage('autoTranscribeAudio', false),
  decibelValue: atomWithLocalStorage('decibelValue', -45),
  autoSendText: atomWithLocalStorage('autoSendText', -1),

  textToSpeech: atomWithLocalStorage('textToSpeech', true),
  engineTTS: atomWithLocalStorage('engineTTS', 'browser'),
  voice: atomWithLocalStorage<string | undefined>('voice', undefined),
  cloudBrowserVoices: atomWithLocalStorage('cloudBrowserVoices', false),
  languageTTS: atomWithLocalStorage('languageTTS', ''),
  automaticPlayback: atomWithLocalStorage('automaticPlayback', false),
  playbackRate: atomWithLocalStorage<number | null>('playbackRate', null),
  cacheTTS: atomWithLocalStorage('cacheTTS', true),

  // Account settings
  UsernameDisplay: atomWithLocalStorage('UsernameDisplay', true),

  // Nash preferences (Settings → Preferences). Persisted per user (browser),
  // like every other setting here. Empty string means "use the system
  // default" — new conversations and per-turn requests only override when a
  // value is set, so these compose with the backend defaults rather than
  // duplicating them on the client.
  defaultChatModel: atomWithLocalStorage<string>('defaultChatModel', ''),
  defaultImageModel: atomWithLocalStorage<string>('defaultImageModel', ''),
  defaultTTSVoice: atomWithLocalStorage<string>('defaultTTSVoice', ''),
  defaultPersona: atomWithLocalStorage<string>('defaultPersona', ''),
};

export default { ...staticAtoms, ...localStorageAtoms };
