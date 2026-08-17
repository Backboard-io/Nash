import { memo } from 'react';
import { useRecoilState } from 'recoil';
import PastedCodeCard from './PastedCodeCard';
import store from '~/store';

/** Renders the composer's "Pasted code/text" cards for the active conversation. */
function PastedAttachments({ conversationId }: { conversationId: string }) {
  const [blocks, setBlocks] = useRecoilState(store.pastedBlocksByConversation(conversationId));

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="mx-2 mt-2 flex flex-wrap gap-2">
      {blocks.map((block) => (
        <PastedCodeCard
          key={block.id}
          block={block}
          onRemove={() => setBlocks((prev) => prev.filter((b) => b.id !== block.id))}
        />
      ))}
    </div>
  );
}

export default memo(PastedAttachments);
