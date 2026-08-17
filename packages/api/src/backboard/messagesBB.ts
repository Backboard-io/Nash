import { logger } from '@librechat/data-schemas';
import {
  upsertMessage,
  deleteMsg,
  getMsgFromCache,
  getMsgsByConvo,
  getUserCache,
  deleteMsgsByConvo,
  getUserAssistantId,
} from './userStore';
import { backboardStorage } from './storage';
import type { BackboardClient } from './client';

const THREAD_MAP_TYPE = 'thread_mapping';
const THREAD_HYDRATION_ENABLED = process.env.BACKBOARD_THREAD_HYDRATION_FALLBACK === 'true';
const threadMap = new Map<string, string>();
const loadedAssistants = new Set<string>();

const hydrationMetrics = {
  attempts: 0,
  success: 0,
  failure: 0,
  skippedNoThreadId: 0,
};

function getClient(): BackboardClient {
  return backboardStorage.getClient();
}

function getThreadIdFromMessage(msg: Record<string, unknown>): string | undefined {
  if (typeof msg.thread_id === 'string' && msg.thread_id.trim()) {
    return msg.thread_id;
  }
  const metadata = msg.metadata as Record<string, unknown> | undefined;
  if (typeof metadata?.thread_id === 'string' && metadata.thread_id.trim()) {
    return metadata.thread_id;
  }
  return undefined;
}

function isIncompleteAssistantMessage(msg: Record<string, unknown>): boolean {
  if (msg.isCreatedByUser === true) {
    return false;
  }
  if (msg._bbContentTruncated === true) {
    return true;
  }
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const content = msg.content;
  if (Array.isArray(content)) {
    return content.length === 0 && text.length === 0;
  }
  if (typeof content === 'string') {
    return content.trim().length === 0 && text.length === 0;
  }
  return text.length === 0;
}

async function loadThreadMappings(client: BackboardClient, assistantId: string): Promise<void> {
  if (loadedAssistants.has(assistantId)) {
    return;
  }
  const response = await client.getMemories(assistantId);
  for (const memory of response.memories) {
    const metadata = (memory.metadata ?? {}) as Record<string, unknown>;
    if (metadata.type !== THREAD_MAP_TYPE) {
      continue;
    }
    const conversationId = metadata.conversationId as string | undefined;
    const threadId = metadata.threadId as string | undefined;
    if (conversationId && threadId && !threadMap.has(conversationId)) {
      threadMap.set(conversationId, threadId);
    }
  }
  loadedAssistants.add(assistantId);
}

async function resolveThreadId(userId: string, conversationId: string): Promise<string | undefined> {
  const cached = threadMap.get(conversationId);
  if (cached) {
    return cached;
  }

  const client = getClient();
  const assistantId = await getUserAssistantId(userId);
  try {
    await loadThreadMappings(client, assistantId);
  } catch (err) {
    logger.warn(
      `[MessagesBB] Failed to load thread mappings for fallback: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return threadMap.get(conversationId);
}

async function hydrateMessagesFromThread(
  userId: string,
  conversationId: string,
  results: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (!THREAD_HYDRATION_ENABLED || results.length === 0) {
    return results;
  }

  const candidateIndexes = results
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => isIncompleteAssistantMessage(msg))
    .map(({ index }) => index);

  if (candidateIndexes.length === 0) {
    return results;
  }

  hydrationMetrics.attempts++;

  const firstCandidate = results[candidateIndexes[candidateIndexes.length - 1]];
  const threadId = getThreadIdFromMessage(firstCandidate) ?? (await resolveThreadId(userId, conversationId));
  if (!threadId) {
    hydrationMetrics.skippedNoThreadId++;
    logger.warn(
      `[MessagesBB] Fallback skipped (missing thread_id) conversationId=${conversationId} attempts=${hydrationMetrics.attempts} success=${hydrationMetrics.success} failure=${hydrationMetrics.failure}`,
    );
    return results;
  }

  try {
    const thread = await getClient().getThread(threadId);
    const assistantMessages = (thread.messages ?? []).filter(
      (message) => message.role === 'assistant' && typeof message.content === 'string' && message.content.length > 0,
    );

    if (assistantMessages.length === 0) {
      return results;
    }

    const updated = [...results];
    let sourceIndex = assistantMessages.length - 1;

    for (let i = candidateIndexes.length - 1; i >= 0 && sourceIndex >= 0; i--) {
      const targetIndex = candidateIndexes[i];
      const sourceContent = assistantMessages[sourceIndex].content as string;
      sourceIndex--;
      const current = updated[targetIndex];
      const hasContentArray = Array.isArray(current.content);
      const hasStringContent = typeof current.content === 'string' && current.content.trim().length > 0;
      const hasText = typeof current.text === 'string' && current.text.trim().length > 0;
      updated[targetIndex] = {
        ...current,
        text: hasText && current._bbContentTruncated !== true ? (current.text as string) : sourceContent,
        content:
          hasContentArray && (current.content as unknown[]).length > 0 && current._bbContentTruncated !== true
            ? current.content
            : hasStringContent && current._bbContentTruncated !== true
              ? current.content
              : [{ type: 'text', text: sourceContent }],
        thread_id: getThreadIdFromMessage(current) ?? threadId,
      };
    }

    hydrationMetrics.success++;
    logger.info(
      `[MessagesBB] Thread fallback hydrated ${candidateIndexes.length} message(s) conversationId=${conversationId} threadId=${threadId} attempts=${hydrationMetrics.attempts} success=${hydrationMetrics.success} failure=${hydrationMetrics.failure}`,
    );
    return updated;
  } catch (err) {
    hydrationMetrics.failure++;
    logger.warn(
      `[MessagesBB] Thread fallback failed conversationId=${conversationId} threadId=${threadId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return results;
  }
}

export async function saveMessageBB(
  req: { user: { id: string }; body?: Record<string, unknown>; config?: Record<string, unknown> },
  params: Record<string, unknown>,
  metadata?: { context?: string; immediate?: boolean },
): Promise<Record<string, unknown> | undefined> {
  if (!req?.user?.id) {
    throw new Error('User not authenticated');
  }

  const conversationId = params.conversationId as string;
  if (!conversationId) {
    logger.warn(`[saveMessageBB] Invalid conversation ID: ${conversationId}`);
    logger.info(`---saveMessageBB context: ${metadata?.context}`);
    return;
  }

  try {
    const messageId = (params.newMessageId ?? params.messageId) as string;
    const update: Record<string, unknown> = {
      ...params,
      user: req.user.id,
      messageId,
    };
    const modelMetadata = (update.metadata as Record<string, unknown> | undefined) ?? {};
    const isAssistantMessage = update.isCreatedByUser === false;
    let threadId =
      (typeof update.thread_id === 'string' && update.thread_id) ||
      (typeof modelMetadata.thread_id === 'string' ? modelMetadata.thread_id : undefined);
    const runId =
      (typeof update.run_id === 'string' && update.run_id) ||
      (typeof modelMetadata.run_id === 'string' ? modelMetadata.run_id : undefined);
    if (!threadId && isAssistantMessage) {
      threadId = await resolveThreadId(req.user.id, conversationId);
    }
    if (threadId) {
      update.thread_id = threadId;
    }
    if (runId) {
      update.run_id = runId;
    }

    update.expiredAt = null;

    if (update.tokenCount != null && isNaN(update.tokenCount as number)) {
      logger.warn(`Resetting invalid tokenCount for message ${messageId}: ${update.tokenCount}`);
      update.tokenCount = 0;
    }

    const immediate = metadata?.immediate ?? isAssistantMessage;
    return await upsertMessage(req.user.id, messageId, update, { immediate });
  } catch (err) {
    logger.error('[saveMessageBB] Error saving message:', err);
    logger.info(`---saveMessageBB context: ${metadata?.context}`);

    return {
      ...params,
      messageId: params.messageId,
      user: req.user.id,
    };
  }
}

export async function bulkSaveMessagesBB(
  messages: Array<Record<string, unknown>>,
): Promise<{ modifiedCount: number; upsertedCount: number }> {
  let upsertedCount = 0;
  for (const msg of messages) {
    const userId = msg.user as string;
    const messageId = msg.messageId as string;
    if (userId && messageId) {
      await upsertMessage(userId, messageId, msg);
      upsertedCount++;
    }
  }
  return { modifiedCount: 0, upsertedCount };
}

export async function recordMessageBB(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const userId = params.user as string;
  const messageId = params.messageId as string;
  return upsertMessage(userId, messageId, params);
}

export async function updateMessageTextBB(
  req: { user: { id: string } },
  { messageId, text }: { messageId: string; text: string },
): Promise<void> {
  const existing = await getMsgFromCache(req.user.id, messageId);
  if (existing) {
    await upsertMessage(req.user.id, messageId, { ...existing, text });
  }
}

export async function updateMessageBB(
  req: { user: { id: string } },
  message: Record<string, unknown>,
  metadata?: { context?: string },
): Promise<Record<string, unknown>> {
  const { messageId, ...update } = message;
  const mid = messageId as string;
  const existing = await getMsgFromCache(req.user.id, mid);

  if (!existing) {
    throw new Error('Message not found or user not authorized.');
  }

  const merged = { ...existing, ...update };
  await upsertMessage(req.user.id, mid, merged);

  return {
    messageId: mid,
    conversationId: merged.conversationId,
    parentMessageId: merged.parentMessageId,
    sender: merged.sender,
    text: merged.text,
    isCreatedByUser: merged.isCreatedByUser,
    tokenCount: merged.tokenCount,
    feedback: merged.feedback,
  };
}

export async function deleteMessagesSinceBB(
  req: { user: { id: string } },
  { messageId, conversationId }: { messageId: string; conversationId: string },
): Promise<{ deletedCount: number } | undefined> {
  const msg = await getMsgFromCache(req.user.id, messageId);
  if (!msg) {
    return undefined;
  }

  const msgTime = new Date(msg.createdAt as string).getTime();
  const cache = await getUserCache(req.user.id);
  const toDelete: string[] = [];

  for (const [mid, entry] of cache.msgs.entries()) {
    if (entry.data.conversationId !== conversationId) {
      continue;
    }
    if (entry.data.user !== req.user.id) {
      continue;
    }
    const t = new Date(entry.data.createdAt as string).getTime();
    if (t > msgTime) {
      toDelete.push(mid);
    }
  }

  for (const mid of toDelete) {
    await deleteMsg(req.user.id, mid);
  }

  return { deletedCount: toDelete.length };
}

export async function getMessagesBB(
  filter: Record<string, unknown>,
  select?: string,
): Promise<Record<string, unknown>[]> {
  const conversationId = filter.conversationId as string | undefined;
  let user = filter.user as string | undefined;

  if (!conversationId) {
    return [];
  }

  if (!user) {
    const { findUserForConvo } = await import('./userStore');
    user = await findUserForConvo(conversationId);
    if (!user) {
      return [];
    }
  }

  let results = await getMsgsByConvo(user, conversationId);

  const messageId = filter.messageId as string | undefined;
  if (messageId) {
    results = results.filter((m) => m.messageId === messageId);
  }

  results = await hydrateMessagesFromThread(user, conversationId, results);

  if (select === '_id') {
    return results.map((m) => ({ _id: m.messageId ?? m._id }));
  }

  return results;
}

export async function getMessageBB(filter: {
  user: string;
  messageId: string;
}): Promise<Record<string, unknown> | null> {
  return getMsgFromCache(filter.user, filter.messageId);
}

export async function deleteMessagesBB(
  filter: Record<string, unknown>,
): Promise<{ deletedCount: number }> {
  let conversationId = filter.conversationId as string | Record<string, string[]> | undefined;
  const messageId = filter.messageId as string | undefined;
  const user = filter.user as string | undefined;

  if (messageId && user) {
    const deleted = await deleteMsg(user, messageId);
    return { deletedCount: deleted ? 1 : 0 };
  }

  if (typeof conversationId === 'object' && conversationId !== null) {
    const inList = (conversationId as Record<string, string[]>).$in;
    if (Array.isArray(inList)) {
      let total = 0;
      for (const cid of inList) {
        if (user) {
          total += await deleteMsgsByConvo(user, cid);
        }
      }
      return { deletedCount: total };
    }
  }

  if (typeof conversationId === 'string' && user) {
    const count = await deleteMsgsByConvo(user, conversationId);
    return { deletedCount: count };
  }

  return { deletedCount: 0 };
}
