import { logger } from '@librechat/data-schemas';
import {
  upsertConvo,
  deleteConvo,
  getAllConvos,
  getConvoFromCache,
  deleteMsgsByConvo,
  getMsgsByConvo,
  findUserForConvo,
} from './userStore';

export async function searchConversationBB(
  conversationId: string,
): Promise<{ conversationId: string; user: string } | null> {
  const owner = await findUserForConvo(conversationId);
  if (!owner) {
    return null;
  }
  return { conversationId, user: owner };
}

export async function getConvoBB(
  user: string,
  conversationId: string,
): Promise<Record<string, unknown> | null> {
  return getConvoFromCache(user, conversationId);
}

export async function getConvoFilesBB(conversationId: string): Promise<string[]> {
  const owner = await findUserForConvo(conversationId);
  if (!owner) {
    return [];
  }

  const msgs = await getMsgsByConvo(owner, conversationId);
  const fileIds = new Set<string>();

  for (const msg of msgs) {
    const files = msg.files as Array<{ file_id?: string }> | undefined;
    if (!Array.isArray(files)) {
      continue;
    }
    for (const f of files) {
      if (f.file_id) {
        fileIds.add(f.file_id);
      }
    }
  }

  return [...fileIds];
}

export async function deleteNullOrEmptyConversationsBB(): Promise<{
  conversations: { deletedCount: number };
  messages: { deletedCount: number };
}> {
  return { conversations: { deletedCount: 0 }, messages: { deletedCount: 0 } };
}

export async function saveConvoBB(
  req: { user: { id: string }; body?: Record<string, unknown>; config?: Record<string, unknown> },
  {
    conversationId,
    newConversationId,
    ...convo
  }: Record<string, unknown> & { conversationId: string; newConversationId?: string },
  metadata?: { context?: string; noUpsert?: boolean; immediate?: boolean; unsetFields?: Record<string, number> },
): Promise<Record<string, unknown> | null> {
  try {
    if (metadata?.context) {
      logger.debug(`[saveConvoBB] ${metadata.context}`);
    }

    const userId = req.user.id;
    const targetId = newConversationId ?? conversationId;

    if (metadata?.noUpsert) {
      const existing = await getConvoFromCache(userId, conversationId);
      if (!existing) {
        logger.debug('[saveConvoBB] Conversation not found, skipping update (noUpsert)');
        return null;
      }
    }

    const msgIds = (await getMsgsByConvo(userId, conversationId)).map(
      (m) => m._id ?? m.messageId,
    );

    const update: Record<string, unknown> = {
      ...convo,
      messages: msgIds,
      user: userId,
      conversationId: targetId,
    };

    if (!update.updatedAt) {
      update.updatedAt = new Date().toISOString();
    }
    if (!update.createdAt) {
      const existing = await getConvoFromCache(userId, conversationId);
      update.createdAt = existing?.createdAt ?? new Date().toISOString();
    }

    if (metadata?.unsetFields) {
      for (const key of Object.keys(metadata.unsetFields)) {
        delete update[key];
      }
    }

    update.expiredAt = null;

    const result = await upsertConvo(userId, targetId, update, { immediate: metadata?.immediate });
    return result;
  } catch (error) {
    logger.error('[saveConvoBB] Error saving conversation', error);
    if (metadata?.context) {
      logger.info(`[saveConvoBB] ${metadata.context}`);
    }
    return { message: 'Error saving conversation' };
  }
}

export async function bulkSaveConvosBB(
  conversations: Array<Record<string, unknown>>,
): Promise<{ modifiedCount: number; upsertedCount: number }> {
  let upsertedCount = 0;
  for (const convo of conversations) {
    const userId = convo.user as string;
    const conversationId = convo.conversationId as string;
    if (userId && conversationId) {
      await upsertConvo(userId, conversationId, convo);
      upsertedCount++;
    }
  }
  return { modifiedCount: 0, upsertedCount };
}

export async function getConvosByCursorBB(
  user: string,
  {
    cursor,
    limit = 25,
    isArchived = false,
    tags,
    search,
    folderId,
    sortBy = 'updatedAt',
    sortDirection = 'desc',
  }: {
    cursor?: string;
    limit?: number;
    isArchived?: boolean;
    tags?: string[];
    search?: string;
    folderId?: string;
    sortBy?: string;
    sortDirection?: string;
  } = {},
): Promise<{ conversations: Record<string, unknown>[]; nextCursor: string | null }> {
  let convos = await getAllConvos(user);

  convos = convos.filter((c) => !c.expiredAt);

  if (isArchived) {
    convos = convos.filter((c) => c.isArchived === true);
  } else {
    convos = convos.filter((c) => !c.isArchived);
  }

  if (folderId === 'none') {
    convos = convos.filter((c) => !c.folderId);
  } else if (folderId) {
    convos = convos.filter((c) => c.folderId === folderId);
  }

  if (Array.isArray(tags) && tags.length > 0) {
    convos = convos.filter((c) => {
      const cTags = c.tags as string[] | undefined;
      return cTags?.some((t) => tags.includes(t));
    });
  }

  if (search) {
    const lower = search.toLowerCase();
    convos = convos.filter((c) => {
      const title = ((c.title as string) ?? '').toLowerCase();
      return title.includes(lower);
    });
  }

  const dir = sortDirection === 'asc' ? 1 : -1;
  convos.sort((a, b) => {
    const aVal = a[sortBy] as string;
    const bVal = b[sortBy] as string;
    if (sortBy === 'title') {
      return dir * (aVal ?? '').localeCompare(bVal ?? '');
    }
    return dir * (new Date(aVal).getTime() - new Date(bVal).getTime());
  });

  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
      const { primary } = decoded;
      const primaryVal = sortBy === 'title' ? primary : new Date(primary).getTime();

      convos = convos.filter((c) => {
        const cVal = c[sortBy] as string;
        const cv = sortBy === 'title' ? cVal : new Date(cVal).getTime();
        return sortDirection === 'asc' ? cv > primaryVal : cv < primaryVal;
      });
    } catch {
      /* invalid cursor, start from beginning */
    }
  }

  const selected = [
    'conversationId',
    'endpoint',
    'title',
    'createdAt',
    'updatedAt',
    'user',
    'model',
    'agent_id',
    'assistant_id',
    'spec',
    'iconURL',
    'folderId',
  ];

  let nextCursor: string | null = null;
  if (convos.length > limit) {
    convos = convos.slice(0, limit);
    const last = convos[convos.length - 1];
    const primaryStr =
      sortBy === 'title' ? (last[sortBy] as string) : (last[sortBy] as string);
    const secondaryStr = (last.updatedAt as string) ?? new Date().toISOString();
    nextCursor = Buffer.from(
      JSON.stringify({ primary: primaryStr, secondary: secondaryStr }),
    ).toString('base64');
  }

  const result = convos.map((c) => {
    const slim: Record<string, unknown> = {};
    for (const key of selected) {
      if (c[key] !== undefined) {
        slim[key] = c[key];
      }
    }
    return slim;
  });

  return { conversations: result, nextCursor };
}

export async function getConvosQueriedBB(
  user: string,
  convoIds: Array<{ conversationId: string }>,
  cursor: string | null = null,
  limit = 25,
): Promise<{
  conversations: Record<string, unknown>[];
  nextCursor: string | null;
  convoMap: Record<string, Record<string, unknown>>;
}> {
  if (!convoIds?.length) {
    return { conversations: [], nextCursor: null, convoMap: {} };
  }

  const idSet = new Set(convoIds.map((c) => c.conversationId));
  let convos = (await getAllConvos(user)).filter(
    (c) => idSet.has(c.conversationId as string) && !c.expiredAt,
  );

  convos.sort(
    (a, b) =>
      new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime(),
  );

  if (cursor && cursor !== 'start') {
    const cursorDate = new Date(cursor).getTime();
    convos = convos.filter((c) => new Date(c.updatedAt as string).getTime() < cursorDate);
  }

  let nextCursor: string | null = null;
  if (convos.length > limit) {
    convos = convos.slice(0, limit);
    nextCursor = convos[convos.length - 1].updatedAt as string;
  }

  const convoMap: Record<string, Record<string, unknown>> = {};
  for (const c of convos) {
    convoMap[c.conversationId as string] = c;
  }

  return { conversations: convos, nextCursor, convoMap };
}

export async function getConvoTitleBB(
  user: string,
  conversationId: string,
): Promise<string | null> {
  const convo = await getConvoFromCache(user, conversationId);
  if (!convo) {
    return null;
  }
  return (convo.title as string) || 'New Chat';
}

export async function deleteConvosBB(
  user: string,
  filter: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const convos = await getAllConvos(user);

  const toDelete = convos.filter((c) => {
    for (const [key, val] of Object.entries(filter)) {
      if (key === 'user') {
        continue;
      }
      if (c[key] !== val) {
        return false;
      }
    }
    return true;
  });

  if (!toDelete.length) {
    throw new Error('Conversation not found or already deleted.');
  }

  let deletedCount = 0;
  let msgDeletedCount = 0;

  for (const c of toDelete) {
    const cid = c.conversationId as string;
    const deleted = await deleteConvo(user, cid);
    if (deleted) {
      deletedCount++;
    }
    msgDeletedCount += await deleteMsgsByConvo(user, cid);
  }

  return {
    deletedCount,
    messages: { deletedCount: msgDeletedCount },
  };
}
