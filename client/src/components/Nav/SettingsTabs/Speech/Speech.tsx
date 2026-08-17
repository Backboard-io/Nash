import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import * as Tabs from '@radix-ui/react-tabs';
import { useOnClickOutside } from '@librechat/client';
import { useGetCustomConfigSpeechQuery } from 'librechat-data-provider/react-query';
import {
  CloudBrowserVoicesSwitch,
  AutomaticPlaybackSwitch,
  TextToSpeechSwitch,
  EngineTTSDropdown,
  CacheTTSSwitch,
  VoiceDropdown,
  PlaybackRate,
} from './TTS';
import {
  AutoTranscribeAudioSwitch,
  LanguageSTTDropdown,
  SpeechToTextSwitch,
  AutoSendTextSelector,
  EngineSTTDropdown,
  DecibelSelector,
} from './STT';
import ConversationModeSwitch from './ConversationModeSwitch';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

function Speech() {
  const localize = useLocalize();

  const [confirmClear, setConfirmClear] = useState(false);
  const { data } = useGetCustomConfigSpeechQuery();

  const [sttExternal, setSttExternal] = useState(false);
  const [ttsExternal, setTtsExternal] = useState(false);
  const [advancedMode, setAdvancedMode] = useRecoilState(store.advancedMode);
  const [autoTranscribeAudio, setAutoTranscribeAudio] = useRecoilState(store.autoTranscribeAudio);
  const [conversationMode, setConversationMode] = useRecoilState(store.conversationMode);
  const [speechToText, setSpeechToText] = useRecoilState(store.speechToText);
  const [textToSpeech, setTextToSpeech] = useRecoilState(store.textToSpeech);
  const [cacheTTS, setCacheTTS] = useRecoilState(store.cacheTTS);
  const [engineSTT, setEngineSTT] = useRecoilState<string>(store.engineSTT);
  const [languageSTT, setLanguageSTT] = useRecoilState<string>(store.languageSTT);
  const [decibelValue, setDecibelValue] = useRecoilState(store.decibelValue);
  const [autoSendText, setAutoSendText] = useRecoilState(store.autoSendText);
  const [engineTTS, setEngineTTS] = useRecoilState<string>(store.engineTTS);
  const [voice, setVoice] = useRecoilState(store.voice);
  const [cloudBrowserVoices, setCloudBrowserVoices] = useRecoilState<boolean>(
    store.cloudBrowserVoices,
  );
  const [languageTTS, setLanguageTTS] = useRecoilState<string>(store.languageTTS);
  const [automaticPlayback, setAutomaticPlayback] = useRecoilState(store.automaticPlayback);
  const [playbackRate, setPlaybackRate] = useRecoilState(store.playbackRate);

  const updateSetting = useCallback(
    (key: string, newValue: string | number) => {
      const settings = {
        sttExternal: { value: sttExternal, setFunc: setSttExternal },
        ttsExternal: { value: ttsExternal, setFunc: setTtsExternal },
        conversationMode: { value: conversationMode, setFunc: setConversationMode },
        advancedMode: { value: advancedMode, setFunc: setAdvancedMode },
        speechToText: { value: speechToText, setFunc: setSpeechToText },
        textToSpeech: { value: textToSpeech, setFunc: setTextToSpeech },
        cacheTTS: { value: cacheTTS, setFunc: setCacheTTS },
        engineSTT: { value: engineSTT, setFunc: setEngineSTT },
        languageSTT: { value: languageSTT, setFunc: setLanguageSTT },
        autoTranscribeAudio: { value: autoTranscribeAudio, setFunc: setAutoTranscribeAudio },
        decibelValue: { value: decibelValue, setFunc: setDecibelValue },
        autoSendText: { value: autoSendText, setFunc: setAutoSendText },
        engineTTS: { value: engineTTS, setFunc: setEngineTTS },
        voice: { value: voice, setFunc: setVoice },
        cloudBrowserVoices: { value: cloudBrowserVoices, setFunc: setCloudBrowserVoices },
        languageTTS: { value: languageTTS, setFunc: setLanguageTTS },
        automaticPlayback: { value: automaticPlayback, setFunc: setAutomaticPlayback },
        playbackRate: { value: playbackRate, setFunc: setPlaybackRate },
      };

      const setting = settings[key];
      if (setting) {
        setting.setFunc(newValue);
      }
    },
    [
      sttExternal,
      ttsExternal,
      conversationMode,
      advancedMode,
      speechToText,
      textToSpeech,
      cacheTTS,
      engineSTT,
      languageSTT,
      autoTranscribeAudio,
      decibelValue,
      autoSendText,
      engineTTS,
      voice,
      cloudBrowserVoices,
      languageTTS,
      automaticPlayback,
      playbackRate,
      setSttExternal,
      setTtsExternal,
      setConversationMode,
      setAdvancedMode,
      setSpeechToText,
      setTextToSpeech,
      setCacheTTS,
      setEngineSTT,
      setLanguageSTT,
      setAutoTranscribeAudio,
      setDecibelValue,
      setAutoSendText,
      setEngineTTS,
      setVoice,
      setCloudBrowserVoices,
      setLanguageTTS,
      setAutomaticPlayback,
      setPlaybackRate,
    ],
  );

  useEffect(() => {
    if (data && data.message !== 'not_found') {
      Object.entries(data).forEach(([key, value]) => {
        // Only apply config values as defaults if no user preference exists in localStorage
        const existingValue = localStorage.getItem(key);
        if (existingValue === null && key !== 'sttExternal' && key !== 'ttsExternal') {
          updateSetting(key, value);
        } else if (key === 'sttExternal' || key === 'ttsExternal') {
          updateSetting(key, value);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Reset engineTTS if it is set to a removed/invalid value (e.g., 'edge')
  // TODO: remove this once the 'edge' engine is fully deprecated
  useEffect(() => {
    const validEngines = ['browser', 'external'];
    if (!validEngines.includes(engineTTS)) {
      setEngineTTS('browser');
    }
  }, [engineTTS, setEngineTTS]);

  const contentRef = useRef(null);
  useOnClickOutside(contentRef, () => confirmClear && setConfirmClear(false), []);

  return (
    <Tabs.Root
      defaultValue={'simple'}
      orientation="horizontal"
      value={advancedMode ? 'advanced' : 'simple'}
    >
      {/* §5: a two-way choice is a filter strip — only the selected one wears
          a chip, the rest are plain labels. It was two full-width buttons with
          `shadow-lg`, a `bg-secondary` active fill and unsized 24px icons, so
          a toggle between two views outweighed every setting under it. */}
      {/* The sticky backing has to be the panel's own fill. --sunken here
          was darker than the panel behind it, so the strip read as a band
          laid across the page rather than part of it. */}
      <div className="sticky -top-1 z-50 mb-4 bg-presentation pb-1 pt-1">
        <Tabs.List className="flex items-center gap-1">
          {[
            { value: 'simple', label: localize('com_ui_simple'), onSelect: () => setAdvancedMode(false) },
            { value: 'advanced', label: localize('com_ui_advanced'), onSelect: () => setAdvancedMode(true) },
          ].map((tab) => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              onClick={tab.onSelect}
              style={{ userSelect: 'none' }}
              className={cn(
                'inline-flex shrink-0 items-center whitespace-nowrap rounded-[9px] border-0 px-[15px] py-[7px]',
                'text-[12.5px] font-medium leading-[18.75px] transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'bg-transparent text-text-secondary-alt hover:bg-surface-primary-alt hover:text-text-primary',
                'radix-state-active:bg-surface-secondary radix-state-active:text-text-primary',
                'radix-state-active:hover:bg-surface-hover',
              )}
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </div>

      <Tabs.Content value={'simple'} tabIndex={-1}>
        <div className="flex flex-col gap-3 text-[13.5px] leading-[20px] text-text-primary">
          <h3 className="text-base font-semibold text-text-primary">
            {localize('com_nav_speech_to_text')}
          </h3>
          <SpeechToTextSwitch />
          <EngineSTTDropdown external={sttExternal} />
          <LanguageSTTDropdown />
          <div className="h-px bg-border-subtle" role="none" />
          <h3 className="text-base font-semibold text-text-primary">
            {localize('com_nav_text_to_speech')}
          </h3>
          <TextToSpeechSwitch />
          <EngineTTSDropdown external={ttsExternal} />
          <VoiceDropdown />
        </div>
      </Tabs.Content>

      <Tabs.Content value={'advanced'} tabIndex={-1}>
        <div className="flex flex-col gap-3 text-[13.5px] leading-[20px] text-text-primary">
          <ConversationModeSwitch />
          <div className="mt-2 h-px bg-border-subtle" role="none" />
          <h3 className="text-base font-semibold text-text-primary">
            {localize('com_nav_speech_to_text')}
          </h3>
          <SpeechToTextSwitch />

          <EngineSTTDropdown external={sttExternal} />

          <LanguageSTTDropdown />
          <div className="pb-2">
            <AutoTranscribeAudioSwitch />
          </div>
          {autoTranscribeAudio && (
            <div className="pb-2">
              <DecibelSelector />
            </div>
          )}
          <div className="pb-2">
            <AutoSendTextSelector />
          </div>
          <div className="h-px bg-border-subtle" role="none" />
          <h3 className="text-base font-semibold text-text-primary">
            {localize('com_nav_text_to_speech')}
          </h3>
          <div className="pb-3">
            <TextToSpeechSwitch />
          </div>
          <AutomaticPlaybackSwitch />
          <EngineTTSDropdown external={ttsExternal} />
          <VoiceDropdown />
          {engineTTS === 'browser' && (
            <div className="pb-2">
              <CloudBrowserVoicesSwitch />
            </div>
          )}
          <div className="pb-2">
            <PlaybackRate />
          </div>
          <CacheTTSSwitch />
        </div>
      </Tabs.Content>
    </Tabs.Root>
  );
}

export default React.memo(Speech);
