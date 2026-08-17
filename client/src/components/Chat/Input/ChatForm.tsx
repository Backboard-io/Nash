import { memo, useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useWatch } from 'react-hook-form';
import { motion } from 'framer-motion';
import { TextareaAutosize, useMediaQuery } from '@librechat/client';
import Collapse from '~/components/ui/Collapse';
import { ease } from '~/utils/motion';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { Constants, isAssistantsEndpoint } from 'librechat-data-provider';
import { ArrowUp, Image as ImageIcon, Settings } from 'lucide-react';
import {
  useChatContext,
  useChatFormContext,
  useAddedChatContext,
  useAssistantsMapContext,
  useBadgeRowContext,
  BadgeRowProvider,
} from '~/Providers';
import {
  useTextarea,
  useAutoSave,
  useLocalize,
  useRequiresKey,
  useHandleKeyUp,
  useQueryParams,
  useSubmitMessage,
  useFocusChatEffect,
} from '~/hooks';
import { mainTextareaId, BadgeItem } from '~/common';
import AttachFileChat from './Files/AttachFileChat';
import FileFormChat from './Files/FileFormChat';
import PastedAttachments from './Files/PastedAttachments';
import { cn, removeFocusRings } from '~/utils';
import TextareaHeader from './TextareaHeader';
import PromptsCommand from './PromptsCommand';
import MicButton from './MicButton';
import StopButton from './StopButton';
import EditBadges from './EditBadges';
import TemporaryChatToggle from './TemporaryChatToggle';
import MobileToolsSheet from './MobileToolsSheet';
import PlusMinusIcon from './PlusMinusIcon';
import MCPSelect from './MCPSelect';
import Mention from './Mention';
import ModelSelector from '../Menus/Endpoints/ModelSelector';
import VoiceModeButton from '../Voice/VoiceModeButton';
import { useGetStartupConfig } from '~/data-provider';
import store from '~/store';

function CreateImagePill() {
  const localize = useLocalize();
  const { imageGeneration } = useBadgeRowContext();
  const { toggleState, setToggleState } = imageGeneration;
  const on = toggleState === true;

  return (
    <button
      type="button"
      onClick={() => setToggleState(!on)}
      aria-label={localize('com_ui_create_image')}
      aria-pressed={on}
      className={cn(
        'inline-flex h-[34px] flex-shrink-0 items-center gap-[8px] rounded-[17px] border-0 pl-[12px] pr-[14px] text-[13px] leading-[19.5px] transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on
          ? 'bg-brand-purple text-white hover:opacity-90'
          : 'bg-surface-hover text-text-secondary hover:bg-surface-active hover:text-text-primary',
      )}
    >
      <ImageIcon size={15} aria-hidden="true" />
      <span>{localize('com_ui_create_image')}</span>
    </button>
  );
}

const ChatForm = memo(({ index = 0 }: { index?: number }) => {
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  useFocusChatEffect(textAreaRef);
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  const [showMobileTools, setShowMobileTools] = useState(false);
  const [toolsOverride, setToolsOverride] = useState<boolean | null>(null);
  const [, setIsScrollable] = useState(false);
  /** Whether the message has wrapped past one line — drives the composer's
   *  one-row / two-row layout. */
  const [isMultiline, setIsMultiline] = useState(false);
  /* Expand on height, but collapse only when the box is empty.
     The two layouts disagree about height: inline, the textarea shares the row
     with the controls and wraps early; full-width, that same text fits on one
     line. So a message of just the wrong length measured "tall" in one layout
     and "short" in the other, and the composer flipped between them forever —
     React counted the re-renders and killed the app with "Maximum update depth
     exceeded". Only ever growing breaks the cycle: the measurement can no
     longer undo the layout that produced it. Sending clears the text, which is
     when the composer actually wants to be one line again. */
  const measureMultiline = useCallback(
    (height: number, singleLineMax: number) =>
      setIsMultiline((wasMultiline) => {
        /* Whitespace counts as empty. Shift+Enter in an empty composer inserts
           a newline, which measures two lines tall — so the composer split into
           two rows, moved the controls down, and showed a blank field above
           them. Nothing had been written, so nothing should have changed. */
        if (!textValueRef.current?.trim()) {
          return false;
        }
        return wasMultiline || height > singleLineMax;
      }),
    [],
  );
  const composerLayout = { duration: 0.32, ease };
  const [backupBadges, setBackupBadges] = useState<Pick<BadgeItem, 'id'>[]>([]);
  const chatDirection = useRecoilValue(store.chatDirection);
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const isTemporary = useRecoilValue(store.isTemporary);

  const [badges, setBadges] = useRecoilState(store.chatBadges);
  const [isEditingBadges, setIsEditingBadges] = useRecoilState(store.isEditingBadges);
  const setShowSettings = useSetRecoilState(store.showSettings);
  const [showStopButton, setShowStopButton] = useRecoilState(store.showStopButtonByIndex(index));
  const [showPlusPopover, setShowPlusPopover] = useRecoilState(store.showPlusPopoverFamily(index));
  const [showMentionPopover, setShowMentionPopover] = useRecoilState(
    store.showMentionPopoverFamily(index),
  );

  useEffect(() => {
    const el = formRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const publish = () => {
      const rect = el.getBoundingClientRect();
      // Horizontal metrics come from the CARD, not the form: the form carries an
      // 8px gutter either side, so publishing its width made overlays 16px wider
      // than the composer they are supposed to line up with.
      const box = cardRef.current?.getBoundingClientRect() ?? rect;
      const root = document.documentElement.style;
      root.setProperty('--nash-composer-h', `${Math.round(rect.height)}px`);
      root.setProperty('--nash-composer-left', `${Math.round(box.left)}px`);
      root.setProperty('--nash-composer-w', `${Math.round(box.width)}px`);
      // Distance from the viewport bottom to the composer's top edge — overlays
      // anchor to this so anything rendered below the composer (disclaimer,
      // footer) can't push them over it.
      root.setProperty(
        '--nash-composer-top',
        `${Math.max(0, Math.round(window.innerHeight - rect.top))}px`,
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    // The composer can MOVE without resizing (a banner mounts above the chat
    // and shrinks the column, sliding the form up). Position isn't observable
    // directly, but any such move is caused by SOME ancestor changing size, so
    // observe the whole chain — whichever container resizes re-publishes.
    for (let node: Element | null = el; node; node = node.parentElement) {
      ro.observe(node);
    }
    window.addEventListener('resize', publish);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', publish);
      const root = document.documentElement.style;
      root.removeProperty('--nash-composer-h');
      root.removeProperty('--nash-composer-left');
      root.removeProperty('--nash-composer-w');
      root.removeProperty('--nash-composer-top');
    };
  }, []);

  const { requiresKey } = useRequiresKey();
  const methods = useChatFormContext();
  const {
    files,
    setFiles,
    conversation,
    isSubmitting,
    filesLoading,
    newConversation,
    handleStopGenerating,
  } = useChatContext();
  const {
    generateConversation,
    conversation: addedConvo,
    setConversation: setAddedConvo,
  } = useAddedChatContext();
  const assistantMap = useAssistantsMapContext();

  const endpoint = useMemo(
    () => conversation?.endpointType ?? conversation?.endpoint,
    [conversation?.endpointType, conversation?.endpoint],
  );
  const conversationId = useMemo(
    () => conversation?.conversationId ?? Constants.NEW_CONVO,
    [conversation?.conversationId],
  );
  const pastedBlocks = useRecoilValue(store.pastedBlocksByConversation(conversationId));
  const hasSendableAttachment = (files?.size ?? 0) > 0 || pastedBlocks.length > 0;

  const isRTL = useMemo(
    () => (chatDirection != null ? chatDirection?.toLowerCase() === 'rtl' : false),
    [chatDirection],
  );
  const invalidAssistant = useMemo(
    () =>
      isAssistantsEndpoint(endpoint) &&
      (!(conversation?.assistant_id ?? '') ||
        !assistantMap?.[endpoint ?? '']?.[conversation?.assistant_id ?? '']),
    [conversation?.assistant_id, endpoint, assistantMap],
  );
  const disableInputs = useMemo(
    () => requiresKey || invalidAssistant,
    [requiresKey, invalidAssistant],
  );

  const isLanding = useMemo(
    () =>
      (conversationId == null || conversationId === Constants.NEW_CONVO) &&
      (conversation?.messages?.length ?? 0) === 0,
    [conversationId, conversation?.messages?.length],
  );
  const activeFolderId = useRecoilValue(store.activeFolderId);
  const toolsOpen = toolsOverride ?? false;

  /* Also reset when the folder changes: moving between a folder page and a
     blank chat is a change of view, so the row returns to its default for
     wherever you have landed rather than carrying the last toggle over. */
  useEffect(() => {
    setToolsOverride(null);
  }, [conversationId, activeFolderId]);

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      return;
    }
    /** Portal children (model picker etc.) bubble clicks through the REACT
     * tree even though they render outside this container in the DOM —
     * stealing focus from their inputs makes typing in them impossible. */
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
      )
    ) {
      return;
    }
    textAreaRef.current?.focus();
  }, []);

  useAutoSave({
    files,
    setFiles,
    textAreaRef,
    conversationId,
    isSubmitting,
  });

  const { submitMessage, submitPrompt } = useSubmitMessage();

  const handleKeyUp = useHandleKeyUp({
    index,
    textAreaRef,
    setShowPlusPopover,
    setShowMentionPopover,
  });
  const {
    isNotAppendable,
    placeholder,
    handlePaste,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  } = useTextarea({
    textAreaRef,
    submitButtonRef,
    setIsScrollable,
    disabled: disableInputs,
  });

  const sendDisabled = filesLoading || isSubmitting || disableInputs || isNotAppendable;

  useQueryParams({ textAreaRef });

  const { ref, ...registerProps } = methods.register('text', {
    validate: (value: string) => (value?.trim()?.length ?? 0) > 0 || hasSendableAttachment,
    onChange: useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) =>
        methods.setValue('text', e.target.value, { shouldValidate: true }),
      [methods],
    ),
  });

  const textValue = useWatch({ control: methods.control, name: 'text' });
  const textValueRef = useRef(textValue);
  textValueRef.current = textValue;
  /* Clearing the box does not always change its height — a one-line message
     deleted is still one line tall — so the collapse cannot rely on a
     measurement arriving. */
  useEffect(() => {
    if (!textValue?.trim()) {
      setIsMultiline(false);
    }
  }, [textValue]);
  const isMessageEmpty = (textValue?.trim()?.length ?? 0) === 0 && !hasSendableAttachment;

  useEffect(() => {
    if (isEditingBadges && backupBadges.length === 0) {
      setBackupBadges([...badges]);
    }
  }, [isEditingBadges, badges, backupBadges.length]);

  const handleSaveBadges = useCallback(() => {
    setIsEditingBadges(false);
    setBackupBadges([]);
  }, [setIsEditingBadges, setBackupBadges]);

  const handleCancelBadges = useCallback(() => {
    if (backupBadges.length > 0) {
      setBadges([...backupBadges]);
    }
    setIsEditingBadges(false);
    setBackupBadges([]);
  }, [backupBadges, setBadges, setIsEditingBadges]);

  return (
    <form
      ref={formRef}
      onSubmit={methods.handleSubmit(submitMessage)}
      className={cn(
        'mx-auto flex w-full flex-row gap-3 transition-[max-width] duration-swap',
        // The 736 floor includes +16px to absorb the form's own sm:px-2 gutter,
        // so the CARD (not this wrapper) lands on the 720 spec width.
        maximizeChatSpace ? 'max-w-full' : 'max-w-[clamp(736px,50vw,900px)]',
        isSmallScreen
          ? 'gap-1.5 px-4 pb-1'
          : 'sm:px-2',
      )}
    >
      <div className="relative flex h-full flex-1 items-stretch md:flex-col">
        <div className={cn('flex w-full items-center', isRTL && 'flex-row-reverse')}>
          {showPlusPopover && !isAssistantsEndpoint(endpoint) && (
            <Mention
              conversation={conversation}
              setShowMentionPopover={setShowPlusPopover}
              newConversation={generateConversation}
              textAreaRef={textAreaRef}
              commandChar="+"
              placeholder="com_ui_add_model_preset"
              includeAssistants={false}
            />
          )}
          {showMentionPopover && (
            <Mention
              conversation={conversation}
              setShowMentionPopover={setShowMentionPopover}
              newConversation={newConversation}
              textAreaRef={textAreaRef}
            />
          )}
          <PromptsCommand index={index} textAreaRef={textAreaRef} submitPrompt={submitPrompt} />
          <div className="mx-auto flex w-full flex-col">
            {isSmallScreen ? (
              <>
                <div
                  onClick={handleContainerClick}
                  className={cn(
                    'relative flex w-full flex-col overflow-hidden rounded-[18px] text-text-primary transition-all duration-hover',
                    isTemporary
                      ? 'border border-violet-800/60 bg-violet-950/10'
                      : 'bg-surface-chat',
                  )}
                >
                  <div className="px-4">
                    <TextareaHeader addedConvo={addedConvo} setAddedConvo={setAddedConvo} />
                    <EditBadges
                      isEditingChatBadges={isEditingBadges}
                      handleCancelBadges={handleCancelBadges}
                      handleSaveBadges={handleSaveBadges}
                      setBadges={setBadges}
                    />
                    <FileFormChat conversation={conversation} />
                    <PastedAttachments conversationId={conversationId} />
                  </div>
                  <motion.div
                    layout
                    transition={composerLayout}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 pb-2.5 pt-2',
                      'flex-wrap',
                      isRTL && 'flex-row-reverse',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={localize('com_ui_add_to_chat')}
                      aria-haspopup="dialog"
                      aria-expanded={showMobileTools}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMobileTools((prev) => !prev);
                      }}
className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-hover text-text-secondary transition-colors hover:bg-surface-active focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-[34px] sm:w-[34px]"
                    >
                      <PlusMinusIcon open={showMobileTools} />
                    </button>
                {endpoint && (
                  <TextareaAutosize
                      {...registerProps}
                      ref={(e) => {
                        ref(e);
                        (
                          textAreaRef as React.MutableRefObject<HTMLTextAreaElement | null>
                        ).current = e;
                      }}
                      disabled={disableInputs || isNotAppendable}
                      onPaste={handlePaste}
                      /* Typing puts the sheet away. It is a menu of things to
                         add to the message, so the moment you start writing
                         one it has served its purpose — and on a phone it is
                         covering most of what you are typing into. */
                      onKeyDown={(e) => {
                        setShowMobileTools(false);
                        handleKeyDown(e);
                      }}
                      onFocus={() => setShowMobileTools(false)}
                      onKeyUp={handleKeyUp}
                      onCompositionStart={handleCompositionStart}
                      onCompositionEnd={handleCompositionEnd}
                      id={mainTextareaId}
                      tabIndex={0}
                      data-testid="text-input"
                      rows={1}
                      aria-label={localize('com_ui_message_input')}
                      placeholder={placeholder}
                      style={{ height: 22, overflowY: 'auto' }}
                      onHeightChange={(height) => measureMultiline(height, 30)}
                      className={cn(
                        'm-0 resize-none bg-transparent py-0 text-[14px] leading-[22px] text-text-primary placeholder:text-text-secondary-alt',
                        'max-h-[168px] overflow-y-auto',
                        isMultiline ? 'order-first w-full basis-full' : 'min-w-0 flex-1',
                        removeFocusRings,
                        'scrollbar-hover disabled:cursor-not-allowed',
                      )}
                      />
                    )}
                    <motion.div
                      layout
                      transition={composerLayout}
                      className={cn(
                        'flex shrink-0 items-center gap-2 [&_button]:min-w-0',
                        isRTL ? 'mr-auto flex-row-reverse' : 'ml-auto',
                      )}
                    >
                      <div className="[&_button]:min-h-10 [&_button]:gap-2 [&_button]:text-[14px] [&_button]:leading-[21px] sm:[&_button]:min-h-0">
                        <ModelSelector startupConfig={startupConfig} variant="pill" />
                      </div>
                      <button
                        ref={submitButtonRef}
                        type="submit"
                        disabled={sendDisabled || isMessageEmpty}
                        className="hidden"
                        aria-hidden="true"
                        tabIndex={-1}
                      />
                      {isSubmitting && showStopButton ? (
                        <StopButton
                          stop={handleStopGenerating}
                          setShowStopButton={setShowStopButton}
                        />
                      ) : (
                        <>
                          <MicButton />
                          <button
                            type="submit"
                            aria-label="Send message"
                            title="Send message"
                            disabled={sendDisabled || isMessageEmpty}
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              'inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full sm:h-[34px] sm:w-[34px]',
                              'bg-surface-submit text-white',
                              'transition-colors hover:bg-surface-submit-hover',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-submit',
                            )}
                          >
                            <ArrowUp size={17} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </motion.div>
                  </motion.div>
                </div>
                {endpoint && (
                  <BadgeRowProvider
                    conversationId={conversationId}
                    specName={conversation?.spec}
                    isSubmitting={isSubmitting}
                  >
                    <MobileToolsSheet
                      open={showMobileTools}
                      onClose={() => setShowMobileTools(false)}
                      disableInputs={disableInputs}
                    />
                  </BadgeRowProvider>
                )}
              </>
            ) : (
            <div
              ref={cardRef}
              onClick={handleContainerClick}
              className={cn(
                'relative flex w-full flex-col justify-between overflow-hidden text-text-primary transition-all duration-[380ms] ease-[cubic-bezier(.16,1,.3,1)]',
                // Figma: 22 closed, easing to 20 as the tool row opens. No
                // fixed min-height — the card is only as tall as its rows.
                toolsOpen ? 'rounded-[20px]' : 'rounded-[22px]',
                isTemporary ? 'border border-violet-800/60 bg-violet-950/10' : 'bg-surface-chat',
              )}
            >
              <div>
                <div className="px-[14px]">
                  <TextareaHeader addedConvo={addedConvo} setAddedConvo={setAddedConvo} />
                  <EditBadges
                    isEditingChatBadges={isEditingBadges}
                    handleCancelBadges={handleCancelBadges}
                    handleSaveBadges={handleSaveBadges}
                    setBadges={setBadges}
                  />
                  <FileFormChat conversation={conversation} />
                  <PastedAttachments conversationId={conversationId} />
                </div>
                <motion.div
                  layout
                  transition={composerLayout}
                  className={cn(
                    'flex w-full items-center gap-[12px] p-[14px]',
                    'flex-wrap',
                    isRTL ? 'flex-row-reverse' : 'flex-row',
                  )}
                >
                <motion.button
                  layout
                  transition={composerLayout}
                  type="button"
                  aria-label={
                    toolsOpen ? localize('com_ui_hide_tools') : localize('com_ui_show_tools')
                  }
                  aria-expanded={toolsOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setToolsOverride(!toolsOpen);
                  }}
                  className="inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-transparent text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus:outline-none"
                >
                  <PlusMinusIcon open={toolsOpen} />
                </motion.button>
                {endpoint && (
                  <TextareaAutosize
                    {...registerProps}
                    ref={(e) => {
                      ref(e);
                      (textAreaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current =
                        e;
                    }}
                    disabled={disableInputs || isNotAppendable}
                    onPaste={handlePaste}
                    onKeyDown={handleKeyDown}
                    onKeyUp={handleKeyUp}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    id={mainTextareaId}
                    tabIndex={0}
                    data-testid="text-input"
                    rows={1}
                    aria-label={localize('com_ui_message_input')}
                    placeholder={placeholder}
                    style={{ height: 22, overflowY: 'auto' }}
                    onHeightChange={(height) => measureMultiline(height, 30)}
                    className={cn(
                      'm-0 resize-none bg-transparent py-0 text-[14px] leading-[22px] text-text-primary placeholder:text-text-secondary-alt',
                      // It grows to 168px before it scrolls inside itself
                      // rather than pushing the composer up the page.
                      'max-h-[168px] overflow-y-auto',
                      isMultiline ? 'order-first w-full basis-full' : 'min-w-0 flex-1',
                      removeFocusRings,
                      'scrollbar-hover disabled:cursor-not-allowed',
                    )}
                  />
                )}
                {/* Figma `.crow .modelpick { margin-left: auto }` — the picker,
                    mic and send sit hard right; only the +/− stays left. */}
                <motion.div
                  layout
                  transition={composerLayout}
                  className={cn('min-w-0 shrink', isRTL ? 'mr-auto' : 'ml-auto')}
                >
                  <ModelSelector startupConfig={startupConfig} variant="pill" />
                </motion.div>
                {/* Hidden submit target: Enter-to-send (useTextarea's handleKeyDown)
                    fires this via submitButtonRef.current?.click() — no visible send
                    button, but the keyboard submit path is unchanged. */}
                <button
                  ref={submitButtonRef}
                  type="submit"
                  disabled={sendDisabled || isMessageEmpty}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                {isSubmitting && showStopButton ? (
                  <StopButton stop={handleStopGenerating} setShowStopButton={setShowStopButton} />
                ) : (
                  <>
                    <MicButton />
                    <button
                      type="submit"
                      aria-label="Send message"
                      title="Send message"
                      disabled={sendDisabled || isMessageEmpty}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        'inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full',
                        'bg-surface-submit text-white',
                        'transition-colors hover:bg-surface-submit-hover',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-submit',
                      )}
                    >
                      <ArrowUp size={17} aria-hidden="true" />
                    </button>
                  </>
                )}
                </motion.div>
              </div>
              {/* The tool row travels open and closed on the same spring as
                  the sidebar disclosures, instead of appearing. */}
              <Collapse open={toolsOpen && !!endpoint} innerClassName="flex flex-col">
                <BadgeRowProvider
                  conversationId={conversationId}
                  specName={conversation?.spec}
                  isSubmitting={isSubmitting}
                >
                  <div
                    className={cn(
                      'flex w-full flex-wrap items-center justify-between gap-[10px] px-[14px] pb-[14px] md:flex-nowrap',
                      isRTL ? 'flex-row-reverse' : 'flex-row',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-[10px]">
                      <AttachFileChat conversation={conversation} disableInputs={disableInputs} />
                      <CreateImagePill />
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-[10px]">
                      <TemporaryChatToggle />
                      {/* MCP server picker — renders only when the user has servers configured. */}
                      <MCPSelect />
                      <VoiceModeButton />
                      <button
                        type="button"
                        aria-label="Settings"
                        title="Settings"
                        onClick={() => setShowSettings(true)}
                        className="inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-surface-hover text-text-secondary transition-colors hover:bg-surface-active focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Settings size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </BadgeRowProvider>
              </Collapse>
            </div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
});

export default ChatForm;
