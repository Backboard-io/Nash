import { useSetRecoilState } from 'recoil';
import useUpdateTagsInConvo from './useUpdateTagsInConvo';
import store from '~/store';

const useBookmarkSuccess = (conversationId: string) => {
  const updateConversation = useSetRecoilState(store.updateConversationSelector(conversationId));
  const { updateTagsInConversation } = useUpdateTagsInConvo();

  return (newTags: string[] | { tags?: string[] }) => {
    if (!conversationId) {
      return;
    }
    const tagsArray = Array.isArray(newTags) ? newTags : (newTags?.tags ?? []);
    updateTagsInConversation(conversationId, tagsArray);
    updateConversation({ tags: tagsArray });
  };
};

export default useBookmarkSuccess;
