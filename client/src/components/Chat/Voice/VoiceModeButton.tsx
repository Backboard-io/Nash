import { memo, useCallback, useMemo, useRef, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { ChevronDown, Check } from 'lucide-react';
import { WaveformIcon } from '~/components/svg/NashComposerIcons';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, Constants, dataService } from 'librechat-data-provider';
import { TooltipAnchor, DropdownPopup } from '@librechat/client';
import { useRecoilState } from 'recoil';
import type { MenuItemProps } from '~/common';
import type { TConversation } from 'librechat-data-provider';
import { TTS_VOICE_OPTIONS } from '~/components/Chat/Input/composerSelectOptions';
import { useBadgeRowContext } from '~/Providers';
import VoiceMode from './VoiceMode';
import store from '~/store';
import { addConvoToAllQueries, cn } from '~/utils';

/**
 * Entry point for Phase 2 voice conversation mode. Sits in the badge row
 * next to MicButton as a split control: tapping the audio icon opens the
 * fullscreen overlay, while the chevron opens a picker for the hands-free
 * voice. Closing the overlay returns the user to the chat with the turn(s)
 * preserved — and reloads the thread so they show without a manual refresh.
 */
/**
 * Synchronously unlock browser audio inside the user-gesture click handler.
 *
 * Background: the VoiceMode lifecycle calls ``new Audio().play()`` from
 * inside the VAD silence-detection callback, which fires in a setInterval
 * tick — i.e. NOT a user gesture. Chrome's autoplay policy then rejects the
 * play(). Touching an Audio + AudioContext synchronously here, inside the
 * click, registers user-interaction with audio for the page so subsequent
 * automated plays are allowed.
 *
 * The Audio is muted + immediately paused so the user hears nothing. The
 * AudioContext is created+resumed and left running; the persistent
 * ttsPlayer reuses the same context state on subsequent turns.
 */
function unlockBrowserAudio(): void {
  try {
    const a = new Audio();
    a.muted = true;
    a.play().catch(() => {});
    a.pause();
  } catch {
    /* noop */
  }
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (AC) {
      const ctx = new AC();
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      // Don't close — leaving it open keeps the gesture authorization
      // alive for the duration of the voice session.
    }
  } catch {
    /* noop */
  }
}

function VoiceModeButton() {
  const { conversationId } = useBadgeRowContext();
  const [open, setOpen] = useState(false);
  const [isVoiceMenuOpen, setIsVoiceMenuOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The shared index-0 conversation atom + ref that ChatRoute reads and
  // hydrates from. We seed these directly when the backend mints a voice convo
  // (mirrors text chat's createdHandler) instead of routing through the racy
  // navigateToConvo/fetchFreshData path.
  const { setConversation, hasSetConversation } = store.useCreateConversationAtom(0);

  // Per-conversation hands-free voice — the same atom VoiceMode reads when it
  // opens the realtime session. Empty = fall back to the user/Settings default.
  const voiceKey = conversationId ?? Constants.NEW_CONVO;
  const [voice, setVoice] = useRecoilState(store.ttsVoiceByConversation(voiceKey));

  // Holds a conversation id minted by the backend during this voice session
  // (when opened from the New Chat page). Reset on open so a previous
  // session's id can't leak into this one's close handler.
  const mintedIdRef = useRef<string | undefined>(undefined);

  const voiceItems = useMemo<MenuItemProps[]>(
    () =>
      TTS_VOICE_OPTIONS.map((opt) => {
        const selected = opt.value === voice;
        return {
          label: opt.label,
          ariaChecked: selected,
          onClick: () => setVoice(opt.value),
          icon: (
            <Check
              className={cn('size-4', selected ? 'opacity-100' : 'opacity-0')}
              aria-hidden="true"
            />
          ),
        };
      }),
    [voice, setVoice],
  );

  // When the backend mints a brand-new conversation id for a voice turn (user
  // opened voice mode from the New Chat page), finalize the new conversation the
  // SAME way text chat's createdHandler does: write the id into the shared
  // index-0 conversation atom (so ChatRoute keeps rendering this thread instead
  // of NEW_CONVO) and insert the convo into the sidebar cache directly
  // (race-free). navigate + invalidate alone left the user off the thread and
  // the sidebar empty until a manual refresh.
  const handleConversationId = useCallback(
    (newId: string) => {
      if (!newId || newId === conversationId) return;
      mintedIdRef.current = newId;
      let update: TConversation | undefined;
      setConversation((prev) => {
        update = { ...(prev as TConversation), conversationId: newId };
        return update;
      });
      hasSetConversation.current = true;
      if (update) {
        addConvoToAllQueries(queryClient, update);
      }
      queryClient.invalidateQueries([QueryKeys.messages, newId]);
      navigate(`/c/${newId}`);
    },
    [conversationId, navigate, queryClient, setConversation, hasSetConversation],
  );

  // On exit, load the turns and reconcile the sidebar row with the real
  // persisted convo. The conversation atom and the /c/<id> URL were already set
  // at mint time (handleConversationId), so we don't re-navigate here — that
  // bespoke navigate/fetch dance is what left the user off the thread.
  const returnToThread = useCallback(
    async (id: string | undefined, isNew: boolean) => {
      if (!id || id === Constants.NEW_CONVO) {
        queryClient.invalidateQueries([QueryKeys.allConversations]);
        return;
      }
      if (isNew) {
        try {
          // Reconcile the optimistic sidebar row with the real persisted convo
          // (real title, timestamps) now that it's confirmed listable.
          const convo = await queryClient.fetchQuery([QueryKeys.conversation, id], () =>
            dataService.getConversationById(id),
          );
          addConvoToAllQueries(queryClient, convo);
        } catch {
          /* optimistic row + URL are already in place; ignore */
        }
      }
      // useGetMessagesByConvoId has refetchOnMount:false, so force the turns in.
      await queryClient.refetchQueries([QueryKeys.messages, id]);
      // Backstop only — the sidebar row was already inserted optimistically.
      queryClient.invalidateQueries([QueryKeys.allConversations]);
    },
    [queryClient],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    const minted = mintedIdRef.current;
    const existing =
      conversationId && conversationId !== Constants.NEW_CONVO ? conversationId : undefined;
    void returnToThread(minted ?? existing, Boolean(minted));
  }, [conversationId, returnToThread]);

  return (
    <>
      <div className="group relative inline-flex items-center text-text-secondary">
        <TooltipAnchor
          description="Voice mode · Beta (hands-free)"
          render={
            <button
              type="button"
              onClick={() => {
                mintedIdRef.current = undefined;
                unlockBrowserAudio();
                setOpen(true);
              }}
              aria-label="Open voice mode"
              className={cn(
                'flex h-[34px] w-[34px] items-center justify-center rounded-full bg-surface-active',
                'transition-colors hover:bg-surface-hover',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <WaveformIcon size={17} />
            </button>
          }
        />
        <DropdownPopup
          menuId="composer-voice-menu"
          isOpen={isVoiceMenuOpen}
          setIsOpen={setIsVoiceMenuOpen}
          portal={true}
          unmountOnHide={true}
          className="max-h-[60vh] overflow-y-auto"
          trigger={
            <Ariakit.MenuButton
              aria-label="Choose voice"
              title="Voice"
              className={cn(
                'absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full',
                'border border-border-light bg-surface-secondary text-text-secondary',
                'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <ChevronDown className="size-3 opacity-80" aria-hidden="true" />
            </Ariakit.MenuButton>
          }
          items={voiceItems}
        />
      </div>
      <VoiceMode
        open={open}
        conversationId={conversationId && conversationId !== Constants.NEW_CONVO ? conversationId : undefined}
        onClose={handleClose}
        onConversationId={handleConversationId}
      />
    </>
  );
}

export default memo(VoiceModeButton);
