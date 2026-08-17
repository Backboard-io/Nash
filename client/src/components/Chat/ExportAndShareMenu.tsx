import { useState, useRef } from 'react';
import type { ReactNode } from 'react';
import { useRecoilValue } from 'recoil';
import { Upload, Share2 } from 'lucide-react';
import type * as t from '~/common';
import ExportModal from '~/components/Nav/ExportConversation/ExportModal';
import { ShareButton } from '~/components/Conversations/ConvoOptions';
import { useLocalize } from '~/hooks';
import store from '~/store';

/**
 * Supplies the Share/Export entries (and their dialogs) for the header "⋯"
 * dropdown. The header no longer renders a standalone Share button — these
 * items are prepended to ChatMenu's dropdown instead.
 */
export default function useExportShareMenuItems({
  isSharedButtonEnabled,
}: {
  isSharedButtonEnabled: boolean;
}): { items: t.MenuItemProps[]; dialogs: ReactNode } {
  const localize = useLocalize();
  const [showExports, setShowExports] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const conversation = useRecoilValue(store.conversationByIndex(0));

  const exportable =
    conversation &&
    conversation.conversationId != null &&
    conversation.conversationId !== 'new' &&
    conversation.conversationId !== 'search';

  if (!exportable) {
    return { items: [], dialogs: null };
  }

  const shareHandler = () => {
    setShowShareDialog(true);
  };

  const exportHandler = () => {
    setShowExports(true);
  };

  const items: t.MenuItemProps[] = [
    {
      label: localize('com_ui_share'),
      onClick: shareHandler,
      icon: <Share2 className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      show: isSharedButtonEnabled,
      /** NOTE: THE FOLLOWING PROPS ARE REQUIRED FOR MENU ITEMS THAT OPEN DIALOGS */
      hideOnClick: false,
      ref: shareButtonRef,
      render: (props) => <button {...props} />,
    },
    {
      label: localize('com_endpoint_export'),
      onClick: exportHandler,
      icon: <Upload className="icon-sm mr-2 text-text-primary" aria-hidden="true" />,
      /** NOTE: THE FOLLOWING PROPS ARE REQUIRED FOR MENU ITEMS THAT OPEN DIALOGS */
      hideOnClick: false,
      ref: exportButtonRef,
      render: (props) => <button {...props} />,
    },
  ];

  const dialogs = (
    <>
      <ExportModal
        open={showExports}
        onOpenChange={setShowExports}
        conversation={conversation}
        triggerRef={exportButtonRef}
        aria-label={localize('com_ui_export_convo_modal')}
      />
      <ShareButton
        triggerRef={shareButtonRef}
        conversationId={conversation.conversationId ?? ''}
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
      />
    </>
  );

  return { items, dialogs };
}
