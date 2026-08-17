import { useMemo } from 'react';
import { MessageSquare } from 'lucide-react';
import type { TConversation } from 'librechat-data-provider';
import { OGDialog, OGDialogContent, Spinner } from '@librechat/client';
import { useConversationsInfiniteQuery } from '~/data-provider';
import { useLocalize, useNavigateToConvo } from '~/hooks';

interface BookmarkConversationsDialogProps {
  tag: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Lists the conversations that carry a given bookmark (tag) and lets the user
 * jump to one. The backend already filters conversations by tag
 * (GET /api/convos?tags=...) and the query layer already accepts a `tags` param;
 * this restores the "browse by bookmark" capability the redesign dropped from
 * the nav. The query only runs while the dialog is open.
 */
export default function BookmarkConversationsDialog({
  tag,
  open,
  onOpenChange,
}: BookmarkConversationsDialogProps) {
  const localize = useLocalize();
  const { navigateToConvo } = useNavigateToConvo();

  const { data, isLoading, isError } = useConversationsInfiniteQuery(
    { tags: [tag], isArchived: false },
    { enabled: open },
  );

  const conversations = useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.conversations ?? []),
    [data?.pages],
  );

  /* A bare navigate('/c/<id>') strands ChatRoute: once any chat has been opened
   * in the tab, hasSetConversation stays true, which disables the conversation
   * fetch — the route then spins forever on a conversation it never loads.
   * navigateToConvo prepares the conversation state (and cache) the same way a
   * sidebar click does, so the chat actually opens. */
  const handleOpenConversation = (convo: TConversation) => {
    if (!convo?.conversationId) {
      return;
    }
    onOpenChange(false);
    navigateToConvo(convo);
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="max-h-[80vh] w-11/12 max-w-lg overflow-hidden">
        <div className="flex flex-col gap-1 pb-2 pt-2">
          <h2 className="line-clamp-1 break-words text-lg font-semibold text-text-primary">{tag}</h2>
          <p className="text-sm text-text-secondary">
            {conversations.length}{' '}
            {localize(conversations.length === 1 ? 'com_ui_conversation' : 'com_ui_conversations')}
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div
              className="flex justify-center py-10"
              role="status"
              aria-label={localize('com_ui_loading')}
            >
              <Spinner />
            </div>
          ) : isError ? (
            <p className="py-10 text-center text-sm text-text-secondary">
              {localize('com_ui_error')}
            </p>
          ) : conversations.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-secondary">
              {localize('com_ui_nothing_found')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {conversations.map((convo) => (
                <li key={convo.conversationId}>
                  <button
                    type="button"
                    onClick={() => handleOpenConversation(convo)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MessageSquare
                      className="size-4 flex-shrink-0 text-text-secondary"
                      aria-hidden="true"
                    />
                    <span className="line-clamp-1">
                      {convo.title || localize('com_ui_new_chat')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
