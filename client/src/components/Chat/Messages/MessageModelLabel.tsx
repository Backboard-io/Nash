import { memo } from 'react';
import type { TConversation, TMessage } from 'librechat-data-provider';
import { formatModelName } from '~/utils';
import { useLocalize } from '~/hooks';

type MessageModelLabelProps = {
  message?: TMessage | null;
  conversation?: TConversation | null;
};

/**
 * Single source of truth for the per-message model label.
 *
 * Every renderer (ContentRender, MessageRender, MessageParts) mounts this as the
 * first line of the reply, so the label reads the same and sits in the same
 * place whether a turn is live (content-parts path) or reloaded (flat-text
 * path). Keeping it in one component is deliberate: the label previously
 * drifted to two positions and two formats because a redesign updated only two
 * of the three renderers.
 *
 * §14 puts it above the text, not in the action row: a model name in the
 * bottom-right corner reads as a signature on something you have already
 * finished reading. §9 colours only the word Failed — colouring the name too
 * makes the model look like the broken thing.
 */
const MessageModelLabel = memo(({ message, conversation }: MessageModelLabelProps) => {
  const localize = useLocalize();

  if (!message || message.isCreatedByUser === true) {
    return null;
  }

  const model = message.model || conversation?.model || '';
  if (!model) {
    return null;
  }

  const hasError = message.error === true;

  return (
    <div className="select-none pb-[9px] text-[12.5px] font-medium leading-[19px] text-text-secondary-alt">
      {formatModelName(model)}
      {hasError ? (
        <>
          {' · '}
          <span className="text-text-destructive">{localize('com_ui_failed')}</span>
        </>
      ) : null}
    </div>
  );
});

export default MessageModelLabel;
