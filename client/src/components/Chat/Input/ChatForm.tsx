import { memo, useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useWatch } from 'react-hook-form';
import { TextareaAutosize, useMediaQuery } from '@librechat/client';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { Constants, isAssistantsEndpoint } from 'librechat-data-provider';
import { ArrowUp, Image as ImageIcon, Minus, Plus, Settings } from 'lucide-react';
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
        'inline-flex h-[34px] flex-shrink-0 items-center gap-[7px] rounded-[18px] border pl-[11px] pr-[13px] text-[13px] leading-[19.5px] transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on
          ? 'border-brand-purple bg-brand-purple/10 text-brand-purple hover:bg-brand-purple/20'
          : 'border-border-light bg-transparent text-text-secondary hover:bg-surface-hover',
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
  const [backupBadges, setBackupBadges] = useState<Pick<BadgeItem, 'id'>[]>([]);
  const chatDirection = useRecoilValue(store.chatDirection);
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);
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
    ro.observe(el);
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
  const toolsOpen = toolsOverride ?? isLanding;

  useEffect(() => {
    setToolsOverride(null);
  }, [conversationId]);

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    /** Check if the device is a touchscreen */
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
        'mx-auto flex w-full flex-row gap-3 transition-[max-width] duration-300',
        // +16px absorbs the form's own sm:px-2 gutter so the CARD lands on the
        // spec width: the feedback doc fixes the tool row at 720, and the card
        // is what the user sees, not this wrapper.
        maximizeChatSpace ? 'max-w-full' : isLanding ? 'max-w-[736px]' : 'max-w-[936px]',
        isSmallScreen
          ? 'gap-1.5 px-4 pb-1'
          : cn(
              'sm:px-2',
              centerFormOnLanding && isLanding && !isSubmitting
                ? 'transition-all duration-200 sm:mb-28'
                : 'sm:mb-10',
            ),
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
                    'relative flex w-full flex-col overflow-hidden rounded-[18px] border text-text-primary transition-all duration-200',
                    isTemporary
                      ? 'border-violet-800/60 bg-violet-950/10'
                      : 'border-border-light bg-surface-chat',
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
                  {endpoint && (
                    <div className="px-4 pt-3.5">
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
                        style={{ height: 24, overflowY: 'auto' }}
                        className={cn(
                          'm-0 w-full resize-none bg-transparent py-0 text-[16px] leading-[24px] text-text-primary placeholder:text-text-secondary-alt',
                          'max-h-[45vh]',
                          removeFocusRings,
                          'scrollbar-hover flex-1 disabled:cursor-not-allowed',
                        )}
                      />
                    </div>
                  )}
                  <div
                    className={cn(
                      'flex w-full items-center justify-between px-2.5 pb-2.5 pt-1',
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
                      className="inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-surface-active text-text-secondary transition-colors hover:bg-surface-active-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {showMobileTools ? (
                        <Minus size={17} aria-hidden="true" />
                      ) : (
                        <Plus size={17} aria-hidden="true" />
                      )}
                    </button>
                    <div
                      className={cn('flex items-center gap-2', isRTL && 'flex-row-reverse')}
                    >
                      <div className="[&_button]:gap-2 [&_button]:text-[14px] [&_button]:leading-[21px]">
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
                    </div>
                  </div>
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
                'relative flex w-full flex-col justify-between overflow-hidden rounded-[22px] border text-text-primary shadow-[0_10px_30px_rgba(0,0,0,0.4)] transition-all duration-200',
                toolsOpen && 'md:min-h-[152px]',
                isTemporary
                  ? 'border-violet-800/60 bg-violet-950/10'
                  : 'border-border-light bg-surface-chat',
              )}
            >
              {/* Header + input row are one flex child so the card's
                  justify-between puts ALL the slack between the input row and
                  the tool row — Figma has the input row flush at the top
                  (y 0-60) and the tool row flush at the bottom (104-152).
                  As three children the slack split in two and pushed the input
                  row down 22px. */}
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
                <div
                  className={cn(
                    'flex min-h-[60px] w-full items-center gap-[12px] px-[14px]',
                    isRTL ? 'flex-row-reverse' : 'flex-row',
                  )}
                >
                <button
                  type="button"
                  aria-label={
                    toolsOpen ? localize('com_ui_hide_tools') : localize('com_ui_show_tools')
                  }
                  aria-expanded={toolsOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setToolsOverride(!toolsOpen);
                  }}
                  className="inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-surface-active text-text-secondary transition-colors hover:bg-surface-active-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {toolsOpen ? (
                    <Minus size={17} aria-hidden="true" />
                  ) : (
                    <Plus size={17} aria-hidden="true" />
                  )}
                </button>
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
                    style={{ height: 23, overflowY: 'auto' }}
                    className={cn(
                      'm-0 w-full resize-none bg-transparent py-0 text-[15px] leading-[22.5px] text-text-primary placeholder:text-text-secondary-alt',
                      'max-h-[45vh] md:max-h-[55vh]',
                      removeFocusRings,
                      'scrollbar-hover flex-1 disabled:cursor-not-allowed',
                    )}
                  />
                )}
                <ModelSelector startupConfig={startupConfig} variant="pill" />
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
                </div>
              </div>
              {toolsOpen && endpoint && (
                <BadgeRowProvider
                  conversationId={conversationId}
                  specName={conversation?.spec}
                  isSubmitting={isSubmitting}
                >
                  <div
                    className={cn(
                      'flex w-full flex-wrap items-center justify-between gap-[8px] px-[14px] pb-[14px] md:flex-nowrap',
                      isRTL ? 'flex-row-reverse' : 'flex-row',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-[8px]">
                      <AttachFileChat conversation={conversation} disableInputs={disableInputs} />
                      <CreateImagePill />
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-[8px]">
                      <TemporaryChatToggle />
                      {/* MCP server picker — renders only when the user has servers configured. */}
                      <MCPSelect />
                      <VoiceModeButton />
                      <button
                        type="button"
                        aria-label="Settings"
                        title="Settings"
                        onClick={() => setShowSettings(true)}
                        className="inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-surface-active text-text-secondary transition-colors hover:bg-surface-active-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Settings size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </BadgeRowProvider>
              )}
            </div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
});

export default ChatForm;
