import { backboardStorage } from './storage';
import { getConvoFromCache, upsertConvo, getAllConvos } from './userStore';

const TAG_TYPE = 'librechat_tag';

interface ConversationTag {
  tag: string;
  user: string;
  description: string;
  count: number;
  position: number;
  createdAt?: string;
  updatedAt?: string;
}

export async function getConversationTagsBB(userId: string): Promise<ConversationTag[]> {
  const items = await backboardStorage.listByType(TAG_TYPE, userId);
  return items
    .map((item) => ({
      tag: item.content,
      user: userId,
      description: (item.metadata.description as string) ?? '',
      count: (item.metadata.count as number) ?? 0,
      position: (item.metadata.position as number) ?? 0,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }))
    .sort((a, b) => a.position - b.position);
}

export async function createConversationTagBB(
  userId: string,
  data: { tag: string; description?: string; position?: number },
): Promise<ConversationTag> {
  const existing = await backboardStorage.findByMetadata(TAG_TYPE, 'tagName', data.tag, userId);
  if (existing) {
    return {
      tag: existing.content,
      user: userId,
      description: (existing.metadata.description as string) ?? '',
      count: (existing.metadata.count as number) ?? 0,
      position: (existing.metadata.position as number) ?? 0,
    };
  }

  const allTags = await getConversationTagsBB(userId);
  const maxPosition = allTags.reduce((max, t) => Math.max(max, t.position), -1);

  await backboardStorage.createItem(data.tag, {
    type: TAG_TYPE,
    userId,
    tagName: data.tag,
    description: data.description ?? '',
    count: 0,
    position: data.position ?? maxPosition + 1,
  });

  return {
    tag: data.tag,
    user: userId,
    description: data.description ?? '',
    count: 0,
    position: data.position ?? maxPosition + 1,
  };
}

export async function updateConversationTagBB(
  userId: string,
  oldTag: string,
  data: { tag?: string; description?: string; position?: number },
): Promise<ConversationTag | null> {
  const existing = await backboardStorage.findByMetadata(TAG_TYPE, 'tagName', oldTag, userId);
  if (!existing) {
    return null;
  }

  const newTag = data.tag ?? oldTag;
  const description = data.description ?? (existing.metadata.description as string) ?? '';
  const position = data.position ?? (existing.metadata.position as number) ?? 0;
  const count = (existing.metadata.count as number) ?? 0;

  await backboardStorage.deleteItem(existing.id);
  await backboardStorage.createItem(newTag, {
    type: TAG_TYPE,
    userId,
    tagName: newTag,
    description,
    count,
    position,
  });

  return { tag: newTag, user: userId, description, count, position };
}

export async function deleteConversationTagBB(
  userId: string,
  tag: string,
): Promise<ConversationTag | null> {
  const existing = await backboardStorage.findByMetadata(TAG_TYPE, 'tagName', tag, userId);
  if (!existing) {
    return null;
  }

  await backboardStorage.deleteItem(existing.id);

  return {
    tag: existing.content,
    user: userId,
    description: (existing.metadata.description as string) ?? '',
    count: (existing.metadata.count as number) ?? 0,
    position: (existing.metadata.position as number) ?? 0,
  };
}

export async function updateTagsForConversationBB(
  userId: string,
  conversationId: string,
  tags: string[],
): Promise<ConversationTag[]> {
  const convo = await getConvoFromCache(userId, conversationId);
  if (!convo) {
    return [];
  }

  const oldTags = (convo.tags as string[]) || [];
  const addedTags = tags.filter((t) => !oldTags.includes(t));
  const removedTags = oldTags.filter((t) => !tags.includes(t));

  await upsertConvo(userId, conversationId, { ...convo, tags });

  for (const tag of addedTags) {
    const existing = await backboardStorage.findByMetadata(TAG_TYPE, 'tagName', tag, userId);
    if (existing) {
      const newCount = ((existing.metadata.count as number) ?? 0) + 1;
      await backboardStorage.deleteItem(existing.id);
      await backboardStorage.createItem(tag, {
        ...existing.metadata,
        count: newCount,
      });
    } else {
      const allTags = await getConversationTagsBB(userId);
      const maxPos = allTags.reduce((max, t) => Math.max(max, t.position), -1);
      await backboardStorage.createItem(tag, {
        type: TAG_TYPE,
        userId,
        tagName: tag,
        description: '',
        count: 1,
        position: maxPos + 1,
      });
    }
  }

  for (const tag of removedTags) {
    const existing = await backboardStorage.findByMetadata(TAG_TYPE, 'tagName', tag, userId);
    if (existing) {
      const newCount = Math.max(0, ((existing.metadata.count as number) ?? 1) - 1);
      await backboardStorage.deleteItem(existing.id);
      await backboardStorage.createItem(tag, {
        ...existing.metadata,
        count: newCount,
      });
    }
  }

  return getConversationTagsBB(userId);
}

export async function bulkIncrementTagCountsBB(
  userId: string,
  tags: string[],
): Promise<void> {
  for (const tag of tags) {
    const existing = await backboardStorage.findByMetadata(TAG_TYPE, 'tagName', tag, userId);
    if (existing) {
      const newCount = ((existing.metadata.count as number) ?? 0) + 1;
      await backboardStorage.deleteItem(existing.id);
      await backboardStorage.createItem(tag, {
        ...existing.metadata,
        count: newCount,
      });
    } else {
      const allTags = await getConversationTagsBB(userId);
      const maxPos = allTags.reduce((max, t) => Math.max(max, t.position), -1);
      await backboardStorage.createItem(tag, {
        type: TAG_TYPE,
        userId,
        tagName: tag,
        description: '',
        count: 1,
        position: maxPos + 1,
      });
    }
  }
}

export async function deleteUserTagsBB(userId: string): Promise<number> {
  const items = await backboardStorage.listByType(TAG_TYPE, userId);
  let count = 0;
  for (const item of items) {
    await backboardStorage.deleteItem(item.id);
    count++;
  }
  return count;
}
