import { nanoid } from 'nanoid';
import { logger } from '@librechat/data-schemas';
import { Constants } from 'librechat-data-provider';
import { backboardStorage } from './storage';
import { getConvoBB } from './conversations';
import { getMessagesBB } from './messagesBB';

const SHARE_TYPE = 'librechat_sharedlink';

interface SharedLinkEntry {
  shareId: string;
  conversationId: string;
  title: string;
  user: string;
  isPublic: boolean;
  targetMessageId?: string;
  messages: Record<string, unknown>[];
  createdAt: string;
  updatedAt: string;
}

interface CachedShare {
  bbId: string;
  data: SharedLinkEntry;
}

let shareCache: Map<string, CachedShare> | null = null;

async function loadShareCache(): Promise<Map<string, CachedShare>> {
  if (shareCache) {
    return shareCache;
  }
  shareCache = new Map();
  const items = await backboardStorage.listByType(SHARE_TYPE);
  for (const item of items) {
    try {
      const data = JSON.parse(item.content) as SharedLinkEntry;
      if (data.shareId) {
        shareCache.set(data.shareId, { bbId: item.id, data });
      }
    } catch { /* skip malformed */ }
  }
  return shareCache;
}

function invalidateShareCache(): void {
  shareCache = null;
}

function memoizedAnonymizeId(prefix: string) {
  const memo = new Map<string, string>();
  return (id: string) => {
    if (!memo.has(id)) {
      memo.set(id, `${prefix}_${nanoid()}`);
    }
    return memo.get(id) as string;
  };
}

function anonymizeMessages(messages: Record<string, unknown>[], newConvoId: string): Record<string, unknown>[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  const anonymizeMsg = memoizedAnonymizeId('msg');
  const anonymizeAsst = memoizedAnonymizeId('a');
  const idMap = new Map<string, string>();

  return messages.map((message) => {
    const origId = message.messageId as string;
    const newMessageId = origId === Constants.NO_PARENT ? origId : anonymizeMsg(origId);
    idMap.set(origId, newMessageId);

    const parentId = (message.parentMessageId as string) || '';
    const newParentId = parentId === Constants.NO_PARENT
      ? parentId
      : idMap.get(parentId) || (parentId ? anonymizeMsg(parentId) : parentId);

    const model = message.model as string | undefined;
    const newModel = model?.startsWith('asst_') ? anonymizeAsst(model) : model;

    type Attachment = { messageId?: string; conversationId?: string; [k: string]: unknown };
    const attachments = (message.attachments as Attachment[] | undefined)?.map((a) => ({
      ...a,
      messageId: newMessageId,
      conversationId: newConvoId,
    }));

    return {
      ...message,
      messageId: newMessageId,
      parentMessageId: newParentId,
      conversationId: newConvoId,
      model: newModel,
      attachments,
    };
  });
}

function getMessagesUpToTarget(messages: Record<string, unknown>[], targetMessageId: string): Record<string, unknown>[] {
  if (!messages.length) {
    return [];
  }
  if (messages.length === 1 && messages[0]?.messageId === targetMessageId) {
    return messages;
  }

  const parentToChildren = new Map<string, Record<string, unknown>[]>();
  for (const msg of messages) {
    const pid = (msg.parentMessageId as string) || Constants.NO_PARENT;
    if (!parentToChildren.has(pid)) {
      parentToChildren.set(pid, []);
    }
    parentToChildren.get(pid)!.push(msg);
  }

  const target = messages.find((m) => m.messageId === targetMessageId);
  if (!target) {
    return messages;
  }

  const visited = new Set<string>();
  const roots = parentToChildren.get(Constants.NO_PARENT) || [];
  let currentLevel = roots.length > 0 ? [...roots] : [target];
  const results = new Set<Record<string, unknown>>(currentLevel);

  if (currentLevel.some((m) => m.messageId === targetMessageId) && target.parentMessageId === Constants.NO_PARENT) {
    return Array.from(results);
  }

  let found = false;
  while (!found && currentLevel.length > 0) {
    const nextLevel: Record<string, unknown>[] = [];
    for (const node of currentLevel) {
      const nid = node.messageId as string;
      if (visited.has(nid)) {
        continue;
      }
      visited.add(nid);
      for (const child of parentToChildren.get(nid) || []) {
        if (visited.has(child.messageId as string)) {
          continue;
        }
        nextLevel.push(child);
        results.add(child);
        if (child.messageId === targetMessageId) {
          found = true;
        }
      }
    }
    currentLevel = nextLevel;
  }

  return Array.from(results);
}

export async function getSharedMessagesBB(shareId: string): Promise<Record<string, unknown> | null> {
  const cache = await loadShareCache();
  const entry = Array.from(cache.values()).find((e) => e.data.shareId === shareId && e.data.isPublic);
  if (!entry) {
    return null;
  }
  const share = entry.data;
  let messagesToShare = share.messages;
  if (share.targetMessageId) {
    messagesToShare = getMessagesUpToTarget(share.messages, share.targetMessageId);
  }

  const anonymizeConvoId = memoizedAnonymizeId('convo');
  const newConvoId = anonymizeConvoId(share.conversationId);

  return {
    shareId: share.shareId,
    title: share.title,
    isPublic: share.isPublic,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    conversationId: newConvoId,
    messages: anonymizeMessages(messagesToShare, newConvoId),
  };
}

export async function getSharedLinksBB(
  user: string,
  pageParam?: Date | string,
  pageSize = 10,
  isPublic = true,
  sortBy = 'createdAt',
  sortDirection = 'desc',
  search?: string,
): Promise<{ links: Record<string, unknown>[]; nextCursor: string | undefined; hasNextPage: boolean }> {
  const cache = await loadShareCache();
  let links = Array.from(cache.values())
    .filter((e) => e.data.user === user && e.data.isPublic === isPublic)
    .map((e) => e.data);

  if (search?.trim()) {
    const lower = search.toLowerCase();
    links = links.filter((l) => (l.title || '').toLowerCase().includes(lower));
  }

  const dir = sortDirection === 'asc' ? 1 : -1;
  links.sort((a, b) => {
    const av = new Date(a[sortBy as keyof SharedLinkEntry] as string).getTime();
    const bv = new Date(b[sortBy as keyof SharedLinkEntry] as string).getTime();
    return dir * (av - bv);
  });

  if (pageParam) {
    const pv = new Date(pageParam).getTime();
    links = links.filter((l) => {
      const lv = new Date(l[sortBy as keyof SharedLinkEntry] as string).getTime();
      return sortDirection === 'desc' ? lv < pv : lv > pv;
    });
  }

  const hasNextPage = links.length > pageSize;
  const sliced = links.slice(0, pageSize);
  const nextCursor = hasNextPage
    ? (sliced[sliced.length - 1][sortBy as keyof SharedLinkEntry] as string)
    : undefined;

  return {
    links: sliced.map((l) => ({
      shareId: l.shareId,
      title: l.title || 'Untitled',
      isPublic: l.isPublic,
      createdAt: l.createdAt,
      conversationId: l.conversationId,
    })),
    nextCursor,
    hasNextPage,
  };
}

export async function createSharedLinkBB(
  user: string,
  conversationId: string,
  targetMessageId?: string,
): Promise<{ shareId: string; conversationId: string }> {
  if (!user || !conversationId) {
    throw new Error('Missing required parameters');
  }

  const cache = await loadShareCache();
  const existing = Array.from(cache.values()).find(
    (e) =>
      e.data.conversationId === conversationId &&
      e.data.user === user &&
      e.data.isPublic &&
      (!targetMessageId || e.data.targetMessageId === targetMessageId),
  );

  if (existing?.data.isPublic) {
    throw new Error('Share already exists');
  }

  const convo = await getConvoBB(user, conversationId);
  if (!convo) {
    throw new Error('Conversation not found or access denied');
  }

  const messages = await getMessagesBB({ conversationId, user });
  if (!messages.length) {
    throw new Error('No messages to share');
  }

  const shareId = nanoid();
  const now = new Date().toISOString();
  const entry: SharedLinkEntry = {
    shareId,
    conversationId,
    title: (convo.title as string) || 'Untitled',
    user,
    isPublic: true,
    messages,
    createdAt: now,
    updatedAt: now,
    ...(targetMessageId && { targetMessageId }),
  };

  const result = await backboardStorage.createItem(JSON.stringify(entry), {
    type: SHARE_TYPE,
    shareId,
    user,
    conversationId,
  });

  cache.set(shareId, { bbId: result.id, data: entry });
  return { shareId, conversationId };
}

export async function getSharedLinkBB(
  user: string,
  conversationId: string,
): Promise<{ shareId: string | null; success: boolean }> {
  const cache = await loadShareCache();
  const found = Array.from(cache.values()).find(
    (e) => e.data.conversationId === conversationId && e.data.user === user && e.data.isPublic,
  );
  if (!found) {
    return { shareId: null, success: false };
  }
  return { shareId: found.data.shareId, success: true };
}

export async function updateSharedLinkBB(
  user: string,
  shareId: string,
): Promise<{ shareId: string; conversationId: string }> {
  if (!user || !shareId) {
    throw new Error('Missing required parameters');
  }

  const cache = await loadShareCache();
  const entry = cache.get(shareId);
  if (!entry || entry.data.user !== user) {
    throw new Error('Share not found');
  }

  const messages = await getMessagesBB({ conversationId: entry.data.conversationId, user });
  const newShareId = nanoid();
  const now = new Date().toISOString();

  await backboardStorage.deleteItem(entry.bbId);
  const updated: SharedLinkEntry = { ...entry.data, shareId: newShareId, messages, updatedAt: now };
  const result = await backboardStorage.createItem(JSON.stringify(updated), {
    type: SHARE_TYPE,
    shareId: newShareId,
    user,
    conversationId: updated.conversationId,
  });

  cache.delete(shareId);
  cache.set(newShareId, { bbId: result.id, data: updated });
  return { shareId: newShareId, conversationId: updated.conversationId };
}

export async function deleteSharedLinkBB(
  user: string,
  shareId: string,
): Promise<{ success: boolean; shareId: string; message: string } | null> {
  const cache = await loadShareCache();
  const entry = cache.get(shareId);
  if (!entry || entry.data.user !== user) {
    return null;
  }

  await backboardStorage.deleteItem(entry.bbId);
  cache.delete(shareId);
  return { success: true, shareId, message: 'Share deleted successfully' };
}

export async function deleteAllSharedLinksBB(
  user: string,
): Promise<{ message: string; deletedCount: number }> {
  const cache = await loadShareCache();
  let count = 0;
  for (const [sid, entry] of cache.entries()) {
    if (entry.data.user === user) {
      await backboardStorage.deleteItem(entry.bbId);
      cache.delete(sid);
      count++;
    }
  }
  return { message: 'All shared links deleted successfully', deletedCount: count };
}

export async function deleteConvoSharedLinkBB(
  user: string,
  conversationId: string,
): Promise<{ message: string; deletedCount: number }> {
  if (!user || !conversationId) {
    throw new Error('Missing required parameters');
  }
  const cache = await loadShareCache();
  let count = 0;
  for (const [sid, entry] of cache.entries()) {
    if (entry.data.user === user && entry.data.conversationId === conversationId) {
      await backboardStorage.deleteItem(entry.bbId);
      cache.delete(sid);
      count++;
    }
  }
  return { message: 'Shared links deleted successfully', deletedCount: count };
}
