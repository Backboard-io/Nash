import { memo, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { Spinner } from '@librechat/client';
import { useParams } from 'react-router-dom';
import { Constants, buildTree } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ChatFormValues } from '~/common';
import { ChatContext, AddedChatContext, useFileMapContext, ChatFormProvider } from '~/Providers';
import { useAddedResponse, useResumeOnLoad, useAdaptiveSSE, useChatHelpers } from '~/hooks';
import { useGetMessagesByConvoId } from '~/data-provider';
import MessagesView from './Messages/MessagesView';
import FolderThreadsView from './FolderThreadsView';
import Presentation from './Presentation';
import ChatForm from './Input/ChatForm';
import ComposerDisclaimer from './Input/ComposerDisclaimer';
import Landing from './Landing';
import Header from './Header';
import Footer from './Footer';
import { cn } from '~/utils';
import store from '~/store';
import './chat.css';

function LoadingSpinner() {
  return (
    <div className="relative flex-1 overflow-hidden overflow-y-auto">
      <div className="relative flex h-full items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    </div>
  );
}

function ChatView({ index = 0 }: { index?: number }) {
  const { conversationId } = useParams();
  const rootSubmission = useRecoilValue(store.submissionByIndex(index));
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);
  const activeFolderId = useRecoilValue(store.activeFolderId);

  const fileMap = useFileMapContext();

  const { data: messagesTree = null, isLoading } = useGetMessagesByConvoId(conversationId ?? '', {
    select: useCallback(
      (data: TMessage[]) => {
        const dataTree = buildTree({ messages: data, fileMap });
        return dataTree ?? [];
      },
      [fileMap],
    ),
    enabled: !!fileMap,
  });

  const chatHelpers = useChatHelpers(index, conversationId);
  const addedChatHelpers = useAddedResponse();

  useAdaptiveSSE(rootSubmission, chatHelpers, false, index);

  useResumeOnLoad(conversationId, chatHelpers.getMessages, index, !isLoading);

  const methods = useForm<ChatFormValues>({
    defaultValues: { text: '' },
  });

  let content: JSX.Element | null | undefined;
  const isLandingPage =
    (!messagesTree || messagesTree.length === 0) &&
    (conversationId === Constants.NEW_CONVO || !conversationId);
  const isFolderView = isLandingPage && !!activeFolderId;

  // A persisted conversation always has at least one message, so an empty tree
  // for a real conversation means its messages query hasn't settled yet — most
  // often because the cache was cleared for the outgoing convo mid-navigation.
  // Treat that as loading (react-query reports isLoading=false once the cache
  // holds []), otherwise MessagesView briefly flashes its "Nothing found" state.
  const isRealConversation = !!conversationId && conversationId !== Constants.NEW_CONVO;
  const isAwaitingMessages = isRealConversation && (!messagesTree || messagesTree.length === 0);

  if ((isLoading || isAwaitingMessages) && conversationId !== Constants.NEW_CONVO) {
    content = <LoadingSpinner />;
  } else if (!isLandingPage) {
    content = <MessagesView messagesTree={messagesTree} />;
  } else if (isFolderView) {
    content = <FolderThreadsView folderId={activeFolderId} index={index} />;
  } else {
    content = <Landing centerFormOnLanding={centerFormOnLanding} />;
  }

  const isNormalLanding = isLandingPage && !isFolderView;

  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <AddedChatContext.Provider value={addedChatHelpers}>
          <Presentation>
            <div className="nash-chat relative flex h-full w-full flex-col">
              {!isLoading && <Header />}
              <>
                <div
                  className={cn(
                    'flex flex-col',
                    isNormalLanding
                      ? 'flex-1 items-center overflow-y-auto'
                      : 'min-h-0 flex-1 overflow-hidden',
                  )}
                >
                  {isNormalLanding ? (
                    <div className="flex min-h-0 w-full flex-1 items-center justify-center pb-[30px]">
                      {content}
                    </div>
                  ) : (
                    content
                  )}
                  {!isFolderView && (
                    <div
                      className={cn(
                        'w-full',
                        isNormalLanding && 'max-w-3xl transition-all duration-hover xl:max-w-4xl',
                      )}
                    >
                      <ChatForm index={index} />
                      {/* Sits under the composer on every view — the caveat
                          is not less true on a blank chat. */}
                      <ComposerDisclaimer />
                      {!isNormalLanding && <Footer />}
                    </div>
                  )}
                </div>
                {isFolderView && <Footer />}
              </>
            </div>
          </Presentation>
        </AddedChatContext.Provider>
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

export default memo(ChatView);
