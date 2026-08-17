import { useCallback, useSyncExternalStore } from 'react';
import { Constants } from 'librechat-data-provider';
import { useRecoilValue } from 'recoil';
import { narrationController } from '~/audio/narrationController';
import store from '~/store';

/**
 * Drive the per-message "Read aloud" narration. Backed by the global
 * {@link narrationController} singleton (so only one message narrates at a
 * time) and the same TTS-voice resolution Voice Mode uses:
 *   per-conversation override (composer Voice pill) -> per-user default
 *   (Settings) -> server default.
 */
export default function useNarration(conversationId?: string | null) {
  const { activeMessageId, status } = useSyncExternalStore(
    narrationController.subscribe,
    narrationController.getSnapshot,
    narrationController.getSnapshot,
  );

  const defaultTTSVoice = useRecoilValue(store.defaultTTSVoice);
  const perConvoVoice = useRecoilValue(
    store.ttsVoiceByConversation(conversationId ?? Constants.NEW_CONVO),
  );
  const effectiveVoice = perConvoVoice || defaultTTSVoice;

  const narrate = useCallback(
    (messageId: string, text: string) => {
      void narrationController.narrate(
        messageId,
        text,
        conversationId ?? undefined,
        effectiveVoice || undefined,
      );
    },
    [conversationId, effectiveVoice],
  );

  const stop = useCallback(() => narrationController.stop(), []);

  return { narrate, stop, activeMessageId, status };
}
