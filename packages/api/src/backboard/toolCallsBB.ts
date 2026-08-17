import { nanoid } from 'nanoid';
import { logger } from '@librechat/data-schemas';
import { getUserAssistantId } from './userStore';
import { backboardStorage } from './storage';

const TOOLCALL_TYPE = 'librechat_toolcall';

interface CachedEntry {
  bbId: string;
  data: Record<string, unknown>;
}

interface ToolCallCache {
  entries: Map<string, CachedEntry>;
  loaded: boolean;
}

const toolCallCaches = new Map<string, ToolCallCache>();
const toolCallIndex = new Map<string, string>();

function getClient() {
  return backboardStorage.getClient();
}

function emptyCache(): ToolCallCache {
  return { entries: new Map(), loaded: false };
}

async function getToolCallCache(userId: string): Promise<ToolCallCache> {
  const existing = toolCallCaches.get(userId);
  if (existing?.loaded) {
    return existing;
  }

  const cache = emptyCache();
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.type !== TOOLCALL_TYPE) {
      continue;
    }
    try {
      const data = JSON.parse(m.content) as Record<string, unknown>;
      const tcId = (meta.toolCallId ?? data._id) as string;
      if (tcId) {
        cache.entries.set(tcId, { bbId: m.id, data });
        toolCallIndex.set(tcId, userId);
      }
    } catch { }
  }

  cache.loaded = true;
  toolCallCaches.set(userId, cache);
  return cache;
}

export async function createToolCallBB(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const userId = (data.user ?? '') as string;
  const tcId = (data._id ?? nanoid()) as string;
  const now = new Date().toISOString();

  const entry: Record<string, unknown> = {
    ...data,
    _id: tcId,
    user: userId,
    createdAt: data.createdAt ?? now,
    updatedAt: now,
  };

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const cache = await getToolCallCache(userId);

  const content = JSON.stringify(entry);
  const result = await bb.addMemory(aid, content, {
    type: TOOLCALL_TYPE,
    toolCallId: tcId,
    user: userId,
    conversationId: (data.conversationId ?? '') as string,
    messageId: (data.messageId ?? '') as string,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.entries.set(tcId, { bbId, data: entry });
  toolCallIndex.set(tcId, userId);
  return entry;
}

export async function updateToolCallBB(
  id: string,
  update: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const userId = toolCallIndex.get(id);
  if (!userId) {
    return null;
  }

  const cache = await getToolCallCache(userId);
  const existing = cache.entries.get(id);
  if (!existing) {
    return null;
  }

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  await bb.deleteMemory(aid, existing.bbId);

  const now = new Date().toISOString();
  const merged: Record<string, unknown> = { ...existing.data, ...update, updatedAt: now };
  const content = JSON.stringify(merged);
  const result = await bb.addMemory(aid, content, {
    type: TOOLCALL_TYPE,
    toolCallId: id,
    user: userId,
    conversationId: (merged.conversationId ?? '') as string,
    messageId: (merged.messageId ?? '') as string,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.entries.set(id, { bbId, data: merged });
  return merged;
}

export async function deleteToolCallsBB(
  userId: string,
  conversationId?: string,
): Promise<{ deletedCount: number }> {
  const cache = await getToolCallCache(userId);
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  let count = 0;

  const toDelete: string[] = [];
  for (const [tcId, entry] of cache.entries.entries()) {
    if (conversationId && entry.data.conversationId !== conversationId) {
      continue;
    }
    toDelete.push(tcId);
  }

  for (const tcId of toDelete) {
    const entry = cache.entries.get(tcId);
    if (!entry) {
      continue;
    }
    await bb.deleteMemory(aid, entry.bbId);
    cache.entries.delete(tcId);
    toolCallIndex.delete(tcId);
    count++;
  }

  return { deletedCount: count };
}

export async function getToolCallByIdBB(
  id: string,
): Promise<Record<string, unknown> | null> {
  const userId = toolCallIndex.get(id);
  if (!userId) {
    return null;
  }

  const cache = await getToolCallCache(userId);
  return cache.entries.get(id)?.data ?? null;
}

export async function getToolCallsByConvoBB(
  userId: string,
  conversationId: string,
): Promise<Record<string, unknown>[]> {
  const cache = await getToolCallCache(userId);
  const results: Record<string, unknown>[] = [];

  for (const entry of cache.entries.values()) {
    if (entry.data.conversationId === conversationId) {
      results.push(entry.data);
    }
  }

  return results;
}

export async function getToolCallsByMessageBB(
  userId: string,
  messageId: string,
): Promise<Record<string, unknown>[]> {
  const cache = await getToolCallCache(userId);
  const results: Record<string, unknown>[] = [];

  for (const entry of cache.entries.values()) {
    if (entry.data.messageId === messageId) {
      results.push(entry.data);
    }
  }

  return results;
}
