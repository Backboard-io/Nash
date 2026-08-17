import { memo, useState, useCallback, useContext } from 'react';
import Cookies from 'js-cookie';
import { useRecoilState } from 'recoil';
import { useNavigate, useParams } from 'react-router-dom';
import { buildTree } from 'librechat-data-provider';
import { Settings, MessageSquarePlus } from 'lucide-react';
import { useGetSharedMessages } from 'librechat-data-provider/react-query';
import {
  Spinner,
  Button,
  OGDialog,
  ThemeContext,
  OGDialogTitle,
  useMediaQuery,
  useToastContext,
  OGDialogHeader,
  OGDialogContent,
  OGDialogTrigger,
} from '@librechat/client';
import { ThemeSelector, LangSelector } from '~/components/Nav/SettingsTabs/General/General';
import { ShareArtifactsContainer } from './ShareArtifacts';
import { useLocalize, useDocumentTitle } from '~/hooks';
import { useGetStartupConfig, useContinueSharedConvoMutation } from '~/data-provider';
import { ShareContext } from '~/Providers';
import { ShareMessagesProvider } from './ShareMessagesProvider';
import MessagesView from './MessagesView';
import Footer from '../Chat/Footer';
import { cn } from '~/utils';
import store from '~/store';

function SharedView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { data: config } = useGetStartupConfig();
  const { theme, setTheme } = useContext(ThemeContext);
  const { shareId } = useParams();
  const { data, isLoading } = useGetSharedMessages(shareId ?? '');
  const dataTree = data && buildTree({ messages: data.messages });
  const messagesTree = dataTree?.length === 0 ? null : (dataTree ?? null);

  const [langcode, setLangcode] = useRecoilState(store.lang);

  // "Save to my chats" copies this public share into the (logged-in) viewer's
  // own conversations, then drops them into it. The share route is auth-gated,
  // so a viewer here always has a session. We navigate with plain react-router
  // — NOT navigateToConvo, which needs the chat-app endpoints/models config the
  // standalone share page doesn't load (the old "Unknown endpoint" crash).
  const continueConvo = useContinueSharedConvoMutation({
    onSuccess: (result) => {
      const newId = result.conversation?.conversationId;
      if (newId) {
        navigate(`/c/${newId}`, { state: { focusChat: true } });
      }
    },
    onError: () => {
      showToast({ message: localize('com_ui_continue_shared_error'), status: 'error' });
    },
  });

  const handleContinue = useCallback(() => {
    if (shareId) {
      continueConvo.mutate(shareId);
    }
  }, [shareId, continueConvo]);

  // configure document title
  let docTitle = '';
  if (config?.appTitle != null && data?.title != null) {
    docTitle = `${data.title} | ${config.appTitle}`;
  } else {
    docTitle = data?.title ?? config?.appTitle ?? document.title;
  }

  useDocumentTitle(docTitle);

  const handleThemeChange = useCallback(
    (value: string) => {
      setTheme(value);
    },
    [setTheme],
  );

  const handleLangChange = useCallback(
    (value: string) => {
      let userLang = value;
      if (value === 'auto') {
        userLang =
          (typeof navigator !== 'undefined'
            ? navigator.language || navigator.languages?.[0]
            : null) ?? 'en-US';
      }

      requestAnimationFrame(() => {
        document.documentElement.lang = userLang;
      });

      setLangcode(userLang);
      Cookies.set('lang', userLang, { expires: 365 });
    },
    [setLangcode],
  );

  let content: JSX.Element;
  if (isLoading) {
    content = (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="" />
      </div>
    );
  } else if (data && messagesTree && messagesTree.length !== 0) {
    content = (
      <>
        <ShareHeader
          theme={theme}
          langcode={langcode}
          onThemeChange={handleThemeChange}
          onLangChange={handleLangChange}
          settingsLabel={localize('com_nav_settings')}
          continueLabel={localize('com_ui_continue_conversation')}
          onContinue={handleContinue}
          isContinuing={continueConvo.isLoading}
        />
        <ShareMessagesProvider messages={data.messages}>
          <MessagesView messagesTree={messagesTree} conversationId="shared-conversation" />
        </ShareMessagesProvider>
      </>
    );
  } else {
    content = (
      <div className="flex h-screen items-center justify-center">
        {localize('com_ui_shared_link_not_found')}
      </div>
    );
  }

  const footer = (
    <div className="w-full border-t-0 pl-0 pt-2 md:w-[calc(100%-.5rem)] md:border-t-0 md:border-transparent md:pl-0 md:pt-0 md:dark:border-transparent">
      <Footer className="relative mx-auto mt-4 flex max-w-[55rem] flex-wrap items-center justify-center gap-2 px-3 pb-4 pt-2 text-center text-xs text-text-secondary" />
    </div>
  );

  const mainContent = (
    <div className="transition-width relative flex h-full w-full flex-1 flex-col items-stretch overflow-hidden pt-0 dark:bg-surface-secondary">
      <div className="flex h-full min-h-0 flex-col text-text-primary" role="presentation">
        {content}
        {footer}
      </div>
    </div>
  );

  const artifactsContainer =
    data && data.messages ? (
      <ShareArtifactsContainer
        messages={data.messages}
        conversationId={data.conversationId}
        mainContent={mainContent}
      />
    ) : (
      mainContent
    );

  return (
    <ShareContext.Provider value={{ isSharedConvo: true }}>
      <div className="relative flex h-screen w-full overflow-hidden dark:bg-surface-secondary">
        <main className="relative flex w-full grow overflow-hidden dark:bg-surface-secondary">
          {artifactsContainer}
        </main>
      </div>
    </ShareContext.Provider>
  );
}

interface ShareHeaderProps {
  theme: string;
  langcode: string;
  settingsLabel: string;
  continueLabel: string;
  onContinue: () => void;
  isContinuing: boolean;
  onThemeChange: (value: string) => void;
  onLangChange: (value: string) => void;
}

function ShareHeader({
  theme,
  langcode,
  settingsLabel,
  continueLabel,
  onContinue,
  isContinuing,
  onThemeChange,
  onLangChange,
}: ShareHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 767px)');

  const handleDialogOutside = useCallback((event: Event) => {
    // Radix dispatches a CustomEvent whose `target` is the dialog content, not
    // the element clicked — the real target lives on detail.originalEvent. The
    // theme/lang menus are portaled OUTSIDE the dialog (so they clear its
    // z-index and overflow clipping), so selecting an option counts as an
    // "outside" interaction; keep the dialog open for those.
    const native = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
    const target = (native?.target ?? event.target) as HTMLElement | null;
    if (target?.closest('.popover-ui') || target?.closest('[data-dialog-ignore="true"]')) {
      event.preventDefault();
    }
  }, []);

  return (
    <section className="mx-auto flex w-full max-w-[60rem] items-center justify-end gap-2 px-3 pt-4 md:px-5">
      <Button
        size={isMobile ? 'icon' : 'default'}
        type="button"
        onClick={onContinue}
        disabled={isContinuing}
        aria-label={continueLabel}
        className={cn(
          'rounded-full bg-brand-purple text-sm font-semibold text-brand-purple-foreground transition-colors hover:bg-brand-purple-hover disabled:opacity-60',
          isMobile ? 'justify-center p-0 shadow-lg' : 'gap-2 px-4 py-2',
        )}
      >
        {isContinuing ? (
          <Spinner className="size-4" aria-hidden="true" />
        ) : (
          <MessageSquarePlus className="size-4" aria-hidden="true" />
        )}
        <span className="hidden md:inline">{continueLabel}</span>
      </Button>
      <OGDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <OGDialogTrigger asChild>
          <Button
            size={isMobile ? 'icon' : 'default'}
            type="button"
            variant="outline"
            aria-label={settingsLabel}
            className={cn(
              'rounded-full border-border-medium text-sm text-text-primary transition-colors',
              isMobile ? 'justify-center p-0 shadow-lg' : 'gap-2 px-4 py-2',
            )}
          >
            <Settings className="size-4" aria-hidden="true" />
            <span className="hidden md:inline">{settingsLabel}</span>
          </Button>
        </OGDialogTrigger>
        <OGDialogContent
          className="w-11/12 max-w-lg"
          showCloseButton={true}
          onPointerDownOutside={handleDialogOutside}
          onInteractOutside={handleDialogOutside}
        >
          <OGDialogHeader className="text-left">
            <OGDialogTitle>{settingsLabel}</OGDialogTitle>
          </OGDialogHeader>
          <div className="flex flex-col gap-4 pt-2 text-sm">
            <div className="relative focus-within:z-[100]">
              <ThemeSelector theme={theme} onChange={onThemeChange} className="z-[200]" />
            </div>
            <div className="bg-border-medium/60 h-px w-full" />
            <div className="relative focus-within:z-[100]">
              <LangSelector langcode={langcode} onChange={onLangChange} className="z-[200]" />
            </div>
          </div>
        </OGDialogContent>
      </OGDialog>
    </section>
  );
}

export default memo(SharedView);
