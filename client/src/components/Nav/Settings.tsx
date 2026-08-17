import React, { useEffect, useState, useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { SettingsTabValues } from 'librechat-data-provider';
import {
  BarChart3,
  MessageSquare,
  Command,
  CreditCard,
  Building2,
  ChevronRight,
  ArrowLeft,
  X,
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
import SearchField from '~/components/ui/SearchField';
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
  const [showMobileIndex, setShowMobileIndex] = useState(true);
  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab);
    }
    if (open) {
      setShowMobileIndex(initialTab == null);
      setQuery('');
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
      SettingsTabValues.ORGANIZATIONS,
      SettingsTabValues.ANALYTICS,
      SettingsTabValues.BILLING,
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
  const settingsPanelWidth = 'md:w-[780px] md:max-w-[calc(100vw-4rem)]';
  const settingsPanelHeight = 'sm:h-[600px] sm:max-h-[86vh]';

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
            /* §7 `.scrim`: rgba(16,18,24,.42) light, rgba(0,0,0,.6) dark. The
               blur was doing the dimming a scrim is for, and blurring the app
               behind a settings panel makes the page look broken mid-open. */
            className="fixed inset-0 bg-[rgba(16,18,24,0.42)] dark:bg-black/60"
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
          <div className={cn('fixed inset-0 flex w-screen items-center justify-center p-0 sm:p-4')}>
            <DialogPanel
              className={cn(
                /* §7: one fill for everything that opens over the page, and it
                   is --elevated. This was `bg-background` — the page fill — so
                   the settings panel was the only overlay in the app sitting at
                   page level, which is why it read as flat black. Radius 16 and
                   the standard shadow; no border in dark, an inset ring in
                   light. */
                'relative h-dvh w-full max-w-none overflow-hidden rounded-none bg-presentation transition-all duration-swap ease-out animate-in sm:max-w-[calc(100vw-2rem)] sm:rounded-2xl',
                'shadow-[0_10px_28px_rgba(16,18,24,0.14)] ring-1 ring-inset ring-border-light',
                'dark:shadow-[0_18px_50px_rgba(0,0,0,0.6)] dark:ring-0',
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
                /* §7: the × is `.iconbtn` — 32 box, 16 glyph, no fill at rest,
                   16 from both edges — and it is never accent-ringed. */
                className="absolute right-4 top-10 z-10 grid size-8 place-items-center rounded-[8px] text-text-secondary-alt transition-colors hover:bg-surface-secondary hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-heavy"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{localize('com_ui_close_settings')}</span>
              </button>
              <div
                className={cn(
                  /* No padding here: the rail runs to the panel's edge as its
                     own surface, so each column pads itself. And no scrolling
                     here either — the panel is a fixed box, so exactly one
                     thing inside it scrolls, which is the content column. */
                  'flex h-full flex-col overflow-hidden transition-all duration-swap ease-nash',
                  settingsPanelWidth,
                )}
              >
                <Tabs.Root
                  value={activeTab}
                  onValueChange={handleTabChange}
                  className="flex h-full min-h-0 flex-col md:flex-row"
                  orientation="vertical"
                >
                  {isSmallScreen && showMobileIndex && (
                    <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-10">
                      <h2 className="mb-5 pr-10 text-[22px] font-semibold leading-[30px] tracking-[-0.3px] text-text-primary">
                        {localize('com_nav_settings')}
                      </h2>
                      <div className="mb-4">
                        <SearchField
                          on="page"
                          value={query}
                          onChange={setQuery}
                          onClear={() => setQuery('')}
                          placeholder={localize('com_ui_search')}
                        />
                      </div>
                      <div className="scrollbar-hover -mx-3 min-h-0 flex-1 overflow-y-auto">
                        {filteredTabs.length === 0 && (
                          <span className="block px-2 py-1.5 text-sm text-text-secondary">
                            {localize('com_files_no_results')}
                          </span>
                        )}
                        {filteredTabs.map(({ value, label, icon, description }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              setActiveTab(value);
                              setShowMobileIndex(false);
                            }}
                            className="flex w-full items-center gap-3.5 rounded-[10px] px-3 py-3.5 text-left transition-colors active:bg-surface-secondary [&_svg]:shrink-0"
                          >
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-surface-secondary text-text-secondary [&_svg]:size-[16px]">
                              {icon}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-medium leading-[20px] text-text-primary">
                                {localize(label)}
                              </span>
                              <span className="block truncate text-[12.5px] leading-[18px] text-text-secondary-alt">
                                {localize(description)}
                              </span>
                            </span>
                            <ChevronRight
                              size={16}
                              className="shrink-0 text-text-tertiary"
                              aria-hidden="true"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {!isSmallScreen && (
                  <div
                    className={cn(
                      'flex flex-shrink-0 flex-col',
                      /* §1: the rail is a sidebar, so it takes --sunken and
                         runs to the panel's edge. No hairline on top of that —
                         it needed one when both columns shared the panel's
                         single fill, but they are a rung apart now and the step
                         is the boundary. A line as well just draws the seam
                         twice. */
                      'md:w-[212px] md:overflow-y-auto md:bg-surface-primary-alt md:px-3 md:pb-5 md:pt-9',
                    )}
                  >
                    {/* §6: the one search field. `onCard` because this sits on
                        the panel's --elevated fill, so it steps up rather than
                        matching it (§1 rule 2). It was a bordered rounded-xl
                        box — a sixth search geometry. */}
                    <div className="mb-3 mr-12 md:mr-0">
                      <SearchField
                        on="page"
                        value={query}
                        onChange={setQuery}
                        onClear={() => setQuery('')}
                        placeholder={localize('com_ui_search')}
                      />
                    </div>
                    {/* A rail label, quieter than a page's section heading:
                        sentence case at 12 in --t4. Uppercase-tracked here made
                        a nine-item list look like nine sections. */}
                    <span className="mb-[6px] flex h-6 items-center px-[10px] text-[12px] leading-[17px] text-text-tertiary">
                      {localize('com_nav_settings')}
                    </span>
                    <Tabs.List
                      aria-label="Settings"
                      className="min-w-auto max-w-auto relative flex flex-col flex-nowrap gap-[2px] overflow-auto sm:max-w-none"
                      onKeyDown={handleKeyDown}
                    >
                      {filteredTabs.length === 0 && (
                        <span className="px-2 py-1.5 text-sm text-text-secondary">
                          {localize('com_files_no_results')}
                        </span>
                      )}
                      {filteredTabs.map(({ value, label, icon }) => (
                        <Tabs.Trigger
                          key={value}
                          className={cn(
                            /* §3/§4: a nav row, 34 tall at radius 8, hovering to
                               --hover and sitting on --hover when active. The
                               active state was `surface-tertiary`, which in
                               light is the same value as the panel behind it. */
                            'group relative z-10 flex items-center justify-start gap-[9px] rounded-[8px] px-[10px] text-[13px] leading-[19px] transition-colors',
                            '[&_svg]:size-[15px] [&_svg]:shrink-0',
                            'h-[34px] bg-transparent text-text-secondary hover:bg-surface-secondary hover:text-text-primary radix-state-active:bg-surface-hover radix-state-active:text-text-primary',
                          )}
                          value={value}
                          ref={(el) => (tabRefs.current[value] = el)}
                        >
                          {/* Every tab already carried an icon; none of them
                              were rendered, so the rail was ten bare words. */}
                          {!isSmallScreen && icon}
                          <span className="truncate">{localize(label)}</span>
                        </Tabs.Trigger>
                      ))}
                    </Tabs.List>
                  </div>
                  )}
                  {/* The one scrolling region. `min-h-0` is what lets a flex
                      child actually shrink and scroll rather than pushing the
                      panel taller than its fixed height. */}
                  <div
                    className={cn(
                      'scrollbar-gutter-stable scrollbar-hover min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-8 sm:w-full sm:max-w-none md:px-8 md:pb-7 md:pt-9',
                      isSmallScreen && showMobileIndex && 'hidden',
                    )}
                  >
                    {isSmallScreen && (
                      <button
                        type="button"
                        onClick={() => setShowMobileIndex(true)}
                        className="-ml-2 mb-12 flex h-9 items-center gap-1.5 rounded-[8px] px-2 text-[13.5px] leading-[20px] text-text-secondary transition-colors active:bg-surface-secondary"
                      >
                        <ArrowLeft size={16} aria-hidden="true" />
                        {localize('com_nav_settings')}
                      </button>
                    )}
                    {/* §2: 22/600 over a 13.5 sub. It was 24 *bold* — the
                        heaviest weight in the app — over 14, on a panel whose
                        rows are 13.5. `pr-10` keeps the title clear of the ×. */}
                    {activeMeta && (
                      <div className="mb-6 pr-10">
                        <h2
                          className={cn(
                            'font-semibold text-text-primary',
                            isSmallScreen
                              ? 'text-[19px] leading-[27px] tracking-[-0.2px]'
                              : 'text-[15px] leading-[22px]',
                          )}
                        >
                          {localize(activeMeta.label)}
                        </h2>
                        <p className="mt-[2px] max-w-2xl text-[12.5px] leading-[18px] text-text-secondary-alt">
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
