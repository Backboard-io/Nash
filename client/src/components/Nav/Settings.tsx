import React, { useEffect, useState, useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { SettingsTabValues } from 'librechat-data-provider';
import {
  BarChart3,
  MessageSquare,
  Command,
  Search,
} from 'lucide-react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import {
  GearIcon,
  DataIcon,
  UserIcon,
  SpeechIcon,
  useMediaQuery,
  PersonalizationIcon,
} from '@librechat/client';
import type { TDialogProps } from '~/common';
import {
  General,
  Chat,
  Commands,
  Speech,
  Personalization,
  Data,
  Account,
  Analytics,
} from './SettingsTabs';
import usePersonalizationAccess from '~/hooks/usePersonalizationAccess';
import { useLocalize, TranslationKeys } from '~/hooks';
import { cn } from '~/utils';

export default function Settings({
  open,
  onOpenChange,
  initialTab,
}: TDialogProps & { initialTab?: SettingsTabValues }) {
  const isSmallScreen = useMediaQuery('(max-width: 767px)');
  const localize = useLocalize();
  const [activeTab, setActiveTab] = useState(SettingsTabValues.GENERAL);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, open]);

  const tabRefs = useRef({});
  const { hasAnyPersonalizationFeature, hasMemoryOptOut } = usePersonalizationAccess();

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const tabs: SettingsTabValues[] = [
      SettingsTabValues.GENERAL,
      SettingsTabValues.CHAT,
      SettingsTabValues.COMMANDS,
      SettingsTabValues.SPEECH,
      ...(hasAnyPersonalizationFeature ? [SettingsTabValues.PERSONALIZATION] : []),
      SettingsTabValues.DATA,
      SettingsTabValues.ANALYTICS,
      SettingsTabValues.ACCOUNT,
    ];
    const currentIndex = tabs.indexOf(activeTab);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveTab(tabs[(currentIndex + 1) % tabs.length]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length]);
        break;
      case 'Home':
        event.preventDefault();
        setActiveTab(tabs[0]);
        break;
      case 'End':
        event.preventDefault();
        setActiveTab(tabs[tabs.length - 1]);
        break;
    }
  };

  const settingsTabs: {
    value: SettingsTabValues;
    icon: React.JSX.Element;
    label: TranslationKeys;
    description: TranslationKeys;
  }[] = [
    {
      value: SettingsTabValues.GENERAL,
      icon: <GearIcon />,
      label: 'com_nav_setting_general',
      description: 'com_nav_setting_general_desc',
    },
    {
      value: SettingsTabValues.CHAT,
      icon: <MessageSquare className="icon-sm" aria-hidden="true" />,
      label: 'com_nav_setting_chat',
      description: 'com_nav_setting_chat_desc',
    },
    {
      value: SettingsTabValues.COMMANDS,
      icon: <Command className="icon-sm" aria-hidden="true" />,
      label: 'com_nav_commands',
      description: 'com_nav_setting_commands_desc',
    },
    {
      value: SettingsTabValues.SPEECH,
      icon: <SpeechIcon className="icon-sm" aria-hidden="true" />,
      label: 'com_nav_setting_speech',
      description: 'com_nav_setting_speech_desc',
    },
    ...(hasAnyPersonalizationFeature
      ? [
          {
            value: SettingsTabValues.PERSONALIZATION,
            icon: <PersonalizationIcon />,
            label: 'com_nav_setting_personalization' as TranslationKeys,
            description: 'com_nav_setting_personalization_desc' as TranslationKeys,
          },
        ]
      : []),
    {
      value: SettingsTabValues.DATA,
      icon: <DataIcon />,
      label: 'com_nav_setting_data',
      description: 'com_nav_setting_data_desc',
    },
    {
      value: SettingsTabValues.ANALYTICS,
      icon: <BarChart3 className="icon-sm" aria-hidden="true" />,
      label: 'com_nav_setting_analytics',
      description: 'com_nav_setting_analytics_desc',
    },
    {
      value: SettingsTabValues.ACCOUNT,
      icon: <UserIcon />,
      label: 'com_nav_setting_account',
      description: 'com_nav_setting_account_desc',
    },
  ];

  const activeMeta = settingsTabs.find((tab) => tab.value === activeTab);

  const handleTabChange = (value: string) => {
    setActiveTab(value as SettingsTabValues);
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filteredTabs = normalizedQuery
    ? settingsTabs.filter(({ label }) => localize(label).toLowerCase().includes(normalizedQuery))
    : settingsTabs;
  const isAnalyticsTab = activeTab === SettingsTabValues.ANALYTICS;
  const settingsPanelWidth = isAnalyticsTab
    ? 'md:w-[960px] lg:w-[1040px] xl:w-[1120px]'
    : 'md:w-[720px]';
  const settingsPanelHeight = isAnalyticsTab
    ? 'max-h-[94vh] md:h-[760px]'
    : 'max-h-[90vh] md:h-[640px]';

  return (
    <Transition appear show={open}>
      <Dialog as="div" className="relative z-50" onClose={onOpenChange}>
        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm dark:bg-black/60"
            aria-hidden="true"
          />
        </TransitionChild>

        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <div className={cn('fixed inset-0 flex w-screen items-center justify-center p-4')}>
            <DialogPanel
              className={cn(
                'relative w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl rounded-b-lg bg-background pb-6 shadow-2xl backdrop-blur-2xl transition-all duration-300 ease-out animate-in sm:rounded-2xl',
                settingsPanelHeight,
                settingsPanelWidth,
              )}
            >
              <DialogTitle as="div" className="sr-only">
                {localize('com_nav_settings')}
              </DialogTitle>
              <button
                type="button"
                aria-label={localize('com_ui_close_settings')}
                className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
                onClick={() => onOpenChange(false)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <line x1="18" x2="6" y1="6" y2="18"></line>
                  <line x1="6" x2="18" y1="6" y2="18"></line>
                </svg>
                <span className="sr-only">{localize('com_ui_close_settings')}</span>
              </button>
              <div
                className={cn(
                  'scrollbar-gutter-stable scrollbar-hover max-h-[90vh] overflow-auto px-6 pt-6 transition-all duration-300 ease-out md:h-full md:max-h-none md:overflow-hidden',
                  settingsPanelWidth,
                )}
              >
                <Tabs.Root
                  value={activeTab}
                  onValueChange={handleTabChange}
                  className="flex flex-col gap-6 md:h-full md:min-h-0 md:flex-row md:gap-8"
                  orientation="vertical"
                >
                  <div
                    className={cn(
                      'flex flex-shrink-0 flex-col',
                      isSmallScreen ? 'w-full' : 'md:w-[210px]',
                    )}
                  >
                    <div className="relative mb-4">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={localize('com_ui_search')}
                        aria-label={localize('com_ui_search')}
                        className="w-full rounded-xl border border-border-light bg-surface-secondary py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-brand-purple focus:outline-none focus:ring-1 focus:ring-brand-purple"
                      />
                    </div>
                    <span className="mb-1 px-2 text-xs font-medium text-text-secondary">
                      {localize('com_nav_settings')}
                    </span>
                    <Tabs.List
                      aria-label="Settings"
                      className={cn(
                        'min-w-auto max-w-auto relative flex flex-nowrap overflow-auto sm:max-w-none',
                        isSmallScreen ? 'flex-row rounded-xl bg-surface-secondary' : 'flex-col',
                      )}
                      onKeyDown={handleKeyDown}
                    >
                      {filteredTabs.length === 0 && (
                        <span className="px-2 py-1.5 text-sm text-text-secondary">
                          {localize('com_files_no_results')}
                        </span>
                      )}
                      {filteredTabs.map(({ value, label }) => (
                        <Tabs.Trigger
                          key={value}
                          className={cn(
                            'group relative z-10 m-0.5 flex items-center justify-start rounded-lg px-3 py-2 text-sm transition-all duration-200 ease-in-out',
                            isSmallScreen
                              ? 'flex-1 justify-center text-nowrap px-3 py-1.5 text-text-secondary radix-state-active:bg-surface-hover radix-state-active:text-text-primary'
                              : 'bg-transparent text-text-secondary hover:text-text-primary radix-state-active:bg-surface-tertiary radix-state-active:text-text-primary',
                          )}
                          value={value}
                          ref={(el) => (tabRefs.current[value] = el)}
                        >
                          {localize(label)}
                        </Tabs.Trigger>
                      ))}
                    </Tabs.List>
                  </div>
                  <div className="scrollbar-gutter-stable scrollbar-hover overflow-y-auto sm:w-full sm:max-w-none md:h-full md:min-h-0 md:flex-1 md:pb-6 md:pr-0.5 md:pt-0.5">
                    {activeMeta && (
                      <div className="mb-6">
                        <h2 className="text-2xl font-bold text-text-primary">
                          {localize(activeMeta.label)}
                        </h2>
                        <p className="mt-1 text-sm text-text-secondary">
                          {localize(activeMeta.description)}
                        </p>
                      </div>
                    )}
                    <Tabs.Content value={SettingsTabValues.GENERAL} tabIndex={-1}>
                      <General />
                    </Tabs.Content>
                    <Tabs.Content value={SettingsTabValues.CHAT} tabIndex={-1}>
                      <Chat />
                    </Tabs.Content>
                    <Tabs.Content value={SettingsTabValues.COMMANDS} tabIndex={-1}>
                      <Commands />
                    </Tabs.Content>
                    <Tabs.Content value={SettingsTabValues.SPEECH} tabIndex={-1}>
                      <Speech />
                    </Tabs.Content>
                    {hasAnyPersonalizationFeature && (
                      <Tabs.Content value={SettingsTabValues.PERSONALIZATION} tabIndex={-1}>
                        <Personalization
                          hasMemoryOptOut={hasMemoryOptOut}
                          hasAnyPersonalizationFeature={hasAnyPersonalizationFeature}
                        />
                      </Tabs.Content>
                    )}
                    <Tabs.Content value={SettingsTabValues.DATA} tabIndex={-1}>
                      <Data />
                    </Tabs.Content>
                    <Tabs.Content value={SettingsTabValues.ANALYTICS} tabIndex={-1}>
                      <Analytics />
                    </Tabs.Content>
                    <Tabs.Content value={SettingsTabValues.ACCOUNT} tabIndex={-1}>
                      <Account />
                    </Tabs.Content>
                  </div>
                </Tabs.Root>
              </div>
            </DialogPanel>
          </div>
        </TransitionChild>
      </Dialog>
    </Transition>
  );
}
