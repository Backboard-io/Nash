import { GitFork } from 'lucide-react';
import { useToastContext } from '@librechat/client';
import { useLocalize, useNavigateToConvo } from '~/hooks';
import { useForkConvoMutation } from '~/data-provider';
import { cn } from '~/utils';

/**
 * Fork the conversation at this message. Single behavior: the new thread
 * contains the messages up to and including this point (backend
 * splitAtTarget=false). The old multi-option popover was cosmetic — the
 * backend only ever honored splitAtTarget — so the button now forks directly.
 */
export default function Fork({
  messageId,
  conversationId: _convoId,
  forkingSupported = false,
  latestMessageId,
  isLast = false,
}: {
  messageId: string;
  conversationId: string | null;
  forkingSupported?: boolean;
  latestMessageId?: string;
  isLast?: boolean;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { navigateToConvo } = useNavigateToConvo();

  const buttonStyle = cn(
    'hover-button flex h-7 w-7 items-center justify-center rounded-[7px] p-1.5 text-text-secondary-alt',
    'hover:text-text-primary hover:bg-surface-hover',
    'md:group-hover:visible md:group-focus-within:visible md:group-[.final-completion]:visible',
    'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
    'focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:outline-none',
  );

  const forkConvo = useForkConvoMutation({
    onSuccess: (data) => {
      navigateToConvo(data.conversation, { currentConvoId: conversationId });
      showToast({
        message: localize('com_ui_fork_success'),
        status: 'success',
      });
    },
    onMutate: () => {
      showToast({
        message: localize('com_ui_fork_processing'),
        status: 'info',
      });
    },
    onError: (error) => {
      /** Rate limit error (429 status code) */
      const isRateLimitError =
        (error as any)?.response?.status === 429 ||
        (error as any)?.status === 429 ||
        (error as any)?.statusCode === 429;

      showToast({
        message: isRateLimitError
          ? localize('com_ui_fork_error_rate_limit')
          : localize('com_ui_fork_error'),
        status: 'error',
      });
    },
  });

  const conversationId = _convoId ?? '';
  if (!forkingSupported || !conversationId || !messageId) {
    return null;
  }

  return (
    <button
      className={buttonStyle}
      onClick={() => {
        forkConvo.mutate({
          messageId,
          conversationId,
          splitAtTarget: false,
          latestMessageId,
        });
      }}
      type="button"
      aria-label={localize('com_ui_fork')}
      title={localize('com_ui_fork')}
    >
      <GitFork size="15" aria-hidden="true" />
    </button>
  );
}
