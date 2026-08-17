import { logger } from '@librechat/data-schemas';
import { backboardStorage } from './storage';
import { AUTH_USER, getAuthCache, upsertAuthEntry } from './authStore';

import type { BackboardClient } from './client';
import type { BackboardMemory } from './types';

const CONVO_TYPE = 'librechat_convo';
const MSG_TYPE = 'librechat_msg';

/** Delay before flushing a dirty cache entry to Backboard */
const FLUSH_DELAY_MS = 3000;

/** Backboard memory content size limit. Must stay under the 4096-byte attribute filtering cap. */
const MAX_MEMORY_CONTENT_CHARS = 3_800;

/** How long a loaded cache stays fresh before re-fetching from Backboard */
const CACHE_TTL_MS = 30_000;

interface CachedEntry {
  bbId: string;
  data: Record<string, unknown>;
}

interface UserCache {
  convos: Map<string, CachedEntry>;
  msgs: Map<string, CachedEntry>;
  loaded: boolean;
  loadedAt: number;
}

const userAssistantIds = new Map<string, string>();
const userCaches = new Map<string, UserCache>();
const pendingFlushes = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightFlushes = new Set<string>();
const flushMetrics = {
  immediateSuccess: 0,
  immediateFailure: 0,
  backgroundSuccess: 0,
  backgroundFailure: 0,
};

function getClient() {
  return backboardStorage.getClient();
}

function normalizeStack(stack?: string): string {
  return (stack ?? '').split('\n').map((line) => line.trim()).filter(Boolean).join(' | ');
}

function extractCallerLabel(stack?: string): string {
  const lines = (stack ?? '').split('\n').map((line) => line.trim());
  const caller = lines.find((line) => line.startsWith('at ') && !line.includes('/backboard/userStore.'));
  return caller ?? 'unknown-caller';
}

function requireUserId(value: unknown, stack?: string): string {
  if (typeof value !== 'string') {
    logger.error(
      `[UserStore] Invalid user id type (${typeof value}) caller=${extractCallerLabel(stack)} stack=${normalizeStack(stack)}`,
    );
    throw new Error('[UserStore] Invalid user id type');
  }

  const userId = value.trim();
  if (!userId) {
    logger.error(
      `[UserStore] Missing user id caller=${extractCallerLabel(stack)} stack=${normalizeStack(stack)}`,
    );
    throw new Error('[UserStore] Missing user id');
  }

  return userId;
}

async function safeDeleteMemory(bb: BackboardClient, assistantId: string, memoryId: string): Promise<void> {
  try {
    await bb.deleteMemory(assistantId, memoryId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('404')) {
      return;
    }
    logger.warn(`[UserStore] Failed to delete memory ${memoryId}: ${message}`);
  }
}

function cancelPendingFlush(flushKey: string): void {
  if (inFlightFlushes.has(flushKey)) {
    return;
  }
  const timer = pendingFlushes.get(flushKey);
  if (timer) {
    clearTimeout(timer);
    pendingFlushes.delete(flushKey);
  }
}

function scheduleFlush(
  flushKey: string,
  userId: string,
  entryKey: string,
  type: typeof CONVO_TYPE | typeof MSG_TYPE,
): void {
  cancelPendingFlush(flushKey);

  const timer = setTimeout(() => {
    inFlightFlushes.add(flushKey);
    flushEntry(userId, entryKey, type)
      .then((ok) => {
        if (ok) {
          flushMetrics.backgroundSuccess++;
          return;
        }
        flushMetrics.backgroundFailure++;
        logger.warn(
          `[UserStore] Background flush unsuccessful for ${flushKey} metrics=${JSON.stringify(flushMetrics)}`,
        );
      })
      .catch((err: unknown) => {
        flushMetrics.backgroundFailure++;
        logger.warn(`[UserStore] Background flush failed for ${flushKey}: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        inFlightFlushes.delete(flushKey);
        pendingFlushes.delete(flushKey);
      });
  }, FLUSH_DELAY_MS);

  pendingFlushes.set(flushKey, timer);
}

function buildStorableContent(data: Record<string, unknown>): string {
  const raw = JSON.stringify(data);
  if (raw.length <= MAX_MEMORY_CONTENT_CHARS) {
    return raw;
  }

  const trimmed: Record<string, unknown> = {
    ...data,
    _bbContentTruncated: true,
    _bbOriginalChars: raw.length,
  };
  if (typeof trimmed.text === 'string' && (trimmed.text as string).length > 2000) {
    trimmed.text = (trimmed.text as string).slice(0, 2000);
  }
  delete trimmed.content;
  delete trimmed.image_urls;
  delete trimmed.files;
  const attempt = JSON.stringify(trimmed);
  if (attempt.length <= MAX_MEMORY_CONTENT_CHARS) {
    return attempt;
  }

  return attempt.slice(0, MAX_MEMORY_CONTENT_CHARS);
}

async function flushEntry(
  userId: string,
  entryKey: string,
  type: typeof CONVO_TYPE | typeof MSG_TYPE,
): Promise<boolean> {
  const cache = userCaches.get(userId);
  if (!cache) {
    return true;
  }

  const store = type === CONVO_TYPE ? cache.convos : cache.msgs;
  const entry = store.get(entryKey);
  if (!entry) {
    return true;
  }

  const bb = getClient();
  const aid = await getUserAssistantId(userId);

  if (entry.bbId) {
    await safeDeleteMemory(bb, aid, entry.bbId);
  }

  const content = buildStorableContent(entry.data);
  const idField = type === CONVO_TYPE ? 'conversationId' : 'messageId';
  const metadata: Record<string, unknown> = {
    type,
    [idField]: entryKey,
    user: userId,
  };

  if (type === CONVO_TYPE) {
    metadata.updatedAt = new Date().toISOString();
    if (typeof entry.data.title === 'string' && entry.data.title) {
      metadata.title = entry.data.title;
    }
  } else {
    metadata.conversationId = (entry.data.conversationId ?? '') as string;
    metadata.createdAt = (entry.data.createdAt ?? '') as string;
  }

  try {
    const result = await bb.addMemory(aid, content, metadata);
    const newBbId = (result.memory_id ?? result.id ?? '') as string;
    entry.bbId = newBbId;
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[UserStore] Flush ${type} ${entryKey} failed (${content.length} chars): ${msg.slice(0, 300)}`);
    return false;
  }
}

export async function getUserApiKey(userId: unknown): Promise<string | null> {
  const safeUserId = requireUserId(userId);
  const authCache = await getAuthCache();
  const userEntry = authCache.users.get(safeUserId);
  const key = userEntry?.data.bbApiKey as string | undefined;
  return key || null;
}

export async function getUserAssistantId(userId: unknown): Promise<string> {
  const callStack = new Error('[UserStore] getUserAssistantId call stack').stack;
  const callerLabel = extractCallerLabel(callStack);
  if (process.env.BACKBOARD_DEBUG_CALLSTACK === 'true') {
    logger.info(
      `[UserStore] getUserAssistantId caller=${callerLabel} userIdType=${typeof userId} stack=${normalizeStack(callStack)}`,
    );
  } else {
    logger.info(`[UserStore] getUserAssistantId caller=${callerLabel} userIdType=${typeof userId}`);
  }

  const safeUserId = requireUserId(userId, callStack);
  const cached = userAssistantIds.get(safeUserId);
  if (cached) {
    return cached;
  }

  // Check the user's auth record for a persisted assistant ID
  const authCache = await getAuthCache();
  const userEntry = authCache.users.get(safeUserId);
  const storedId = userEntry?.data.bbAssistantId as string | undefined;
  if (storedId) {
    userAssistantIds.set(safeUserId, storedId);
    return storedId;
  }

  // Migration fallback: scan assistants by name (same logic as before)
  const bb = getClient();
  const name = `librechat-user-${safeUserId}`;
  const assistants = await bb.listAssistants();
  const matches = assistants.filter((a) => a.name === name);

  if (matches.length > 0) {
    matches.sort((a, b) => {
      const ta = a.created_at ?? '';
      const tb = b.created_at ?? '';
      return tb.localeCompare(ta);
    });
    const latest = matches[0];
    userAssistantIds.set(safeUserId, latest.assistant_id);

    try {
      await upsertAuthEntry(AUTH_USER, safeUserId, { bbAssistantId: latest.assistant_id });
      logger.info(`[UserStore] Migrated user ${safeUserId} → assistant ${latest.assistant_id}`);
    } catch (err: unknown) {
      logger.warn(`[UserStore] Migration persist failed for ${safeUserId} (will retry next cold start): ${err instanceof Error ? err.message : String(err)}`);
    }
    return latest.assistant_id;
  }

  const created = await bb.createAssistant(name, `LibreChat data store for user ${safeUserId}`);
  userAssistantIds.set(safeUserId, created.assistant_id);
  try {
    await upsertAuthEntry(AUTH_USER, safeUserId, { bbAssistantId: created.assistant_id });
  } catch (err: unknown) {
    logger.warn(`[UserStore] Failed to persist new assistant ID for ${safeUserId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  logger.info(`[UserStore] Created per-user assistant ${created.assistant_id} for ${safeUserId}`);
  return created.assistant_id;
}

function emptyCache(): UserCache {
  return { convos: new Map(), msgs: new Map(), loaded: false, loadedAt: 0 };
}

export async function getUserCache(userId: string): Promise<UserCache> {
  const existing = userCaches.get(userId);
  const hasPendingWrites = [...pendingFlushes.keys()].some((k) => k.includes(`:${userId}:`));
  const hasInFlightWrites = [...inFlightFlushes].some((k) => k.includes(`:${userId}:`));
  if (
    existing?.loaded &&
    (hasPendingWrites || hasInFlightWrites || Date.now() - existing.loadedAt < CACHE_TTL_MS)
  ) {
    return existing;
  }

  const cache = emptyCache();
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const type = meta.type as string;

    if (type === CONVO_TYPE) {
      try {
        const data = JSON.parse(m.content) as Record<string, unknown>;
        if (typeof meta.title === 'string' && meta.title && !data.title) {
          data.title = meta.title;
        }
        const cid = (meta.conversationId ?? data.conversationId) as string;
        if (cid) {
          cache.convos.set(cid, { bbId: m.id, data });
        }
      } catch { /* skip malformed */ }
    } else if (type === MSG_TYPE) {
      try {
        const data = JSON.parse(m.content) as Record<string, unknown>;
        const mid = (meta.messageId ?? data.messageId) as string;
        if (mid) {
          cache.msgs.set(mid, { bbId: m.id, data });
        }
      } catch { /* skip malformed */ }
    }
  }

  cache.loaded = true;
  cache.loadedAt = Date.now();
  userCaches.set(userId, cache);
  return cache;
}

export function invalidateUserCache(userId: string): void {
  userCaches.delete(userId);
}

export async function upsertConvo(
  userId: string,
  conversationId: string,
  data: Record<string, unknown>,
  options?: { immediate?: boolean },
): Promise<Record<string, unknown>> {
  const cache = await getUserCache(userId);
  const existing = cache.convos.get(conversationId);

  const merged = existing ? { ...existing.data, ...data } : data;
  merged.conversationId = conversationId;
  merged.user = userId;

  cache.convos.set(conversationId, { bbId: existing?.bbId ?? '', data: merged });

  if (options?.immediate) {
    cancelPendingFlush(`convo:${userId}:${conversationId}`);
    await flushEntry(userId, conversationId, CONVO_TYPE);
  } else {
    scheduleFlush(`convo:${userId}:${conversationId}`, userId, conversationId, CONVO_TYPE);
  }
  return merged;
}

export async function deleteConvo(userId: string, conversationId: string): Promise<boolean> {
  const cache = await getUserCache(userId);
  const entry = cache.convos.get(conversationId);
  if (!entry) {
    return false;
  }

  cancelPendingFlush(`convo:${userId}:${conversationId}`);
  cache.convos.delete(conversationId);

  if (entry.bbId) {
    const bb = getClient();
    const aid = await getUserAssistantId(userId);
    await safeDeleteMemory(bb, aid, entry.bbId);
  }
  return true;
}

export async function upsertMessage(
  userId: string,
  messageId: string,
  data: Record<string, unknown>,
  options?: { immediate?: boolean },
): Promise<Record<string, unknown>> {
  const cache = await getUserCache(userId);
  const existing = cache.msgs.get(messageId);

  const merged = existing ? { ...existing.data, ...data } : data;
  merged.messageId = messageId;
  merged.user = userId;

  if (!merged.createdAt) {
    merged.createdAt = new Date().toISOString();
  }
  merged.updatedAt = new Date().toISOString();

  cache.msgs.set(messageId, { bbId: existing?.bbId ?? '', data: merged });
  if (options?.immediate) {
    const flushKey = `msg:${userId}:${messageId}`;
    cancelPendingFlush(flushKey);
    inFlightFlushes.add(flushKey);
    try {
      const ok = await flushEntry(userId, messageId, MSG_TYPE);
      if (!ok) {
        flushMetrics.immediateFailure++;
        logger.error(
          `[UserStore] Immediate flush failed for ${flushKey} metrics=${JSON.stringify(flushMetrics)}`,
        );
        throw new Error(`[UserStore] Immediate flush failed for message ${messageId}`);
      }
      flushMetrics.immediateSuccess++;
    } finally {
      inFlightFlushes.delete(flushKey);
      pendingFlushes.delete(flushKey);
    }
  } else {
    scheduleFlush(`msg:${userId}:${messageId}`, userId, messageId, MSG_TYPE);
  }
  return merged;
}

export async function deleteMsg(userId: string, messageId: string): Promise<boolean> {
  const cache = await getUserCache(userId);
  const entry = cache.msgs.get(messageId);
  if (!entry) {
    return false;
  }

  cancelPendingFlush(`msg:${userId}:${messageId}`);
  cache.msgs.delete(messageId);

  if (entry.bbId) {
    const bb = getClient();
    const aid = await getUserAssistantId(userId);
    await safeDeleteMemory(bb, aid, entry.bbId);
  }
  return true;
}

export async function getConvoFromCache(
  userId: string,
  conversationId: string,
): Promise<Record<string, unknown> | null> {
  const cache = await getUserCache(userId);
  return cache.convos.get(conversationId)?.data ?? null;
}

export async function getAllConvos(userId: string): Promise<Record<string, unknown>[]> {
  const cache = await getUserCache(userId);
  return Array.from(cache.convos.values()).map((e) => e.data);
}

export async function getMsgFromCache(
  userId: string,
  messageId: string,
): Promise<Record<string, unknown> | null> {
  const cache = await getUserCache(userId);
  return cache.msgs.get(messageId)?.data ?? null;
}

export async function getMsgsByConvo(
  userId: string,
  conversationId: string,
): Promise<Record<string, unknown>[]> {
  const cache = await getUserCache(userId);
  const results: Record<string, unknown>[] = [];
  for (const entry of cache.msgs.values()) {
    if (entry.data.conversationId === conversationId) {
      results.push(entry.data);
    }
  }
  results.sort((a, b) => {
    const ta = new Date(a.createdAt as string).getTime();
    const tb = new Date(b.createdAt as string).getTime();
    return ta - tb;
  });
  return results;
}

export async function findUserForConvo(conversationId: string): Promise<string | undefined> {
  for (const [userId, cache] of userCaches.entries()) {
    if (cache.convos.has(conversationId)) {
      return userId;
    }
  }
  return undefined;
}

export async function deleteMsgsByConvo(userId: string, conversationId: string): Promise<number> {
  const cache = await getUserCache(userId);
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  let count = 0;

  const toDelete: string[] = [];
  for (const [mid, entry] of cache.msgs.entries()) {
    if (entry.data.conversationId === conversationId) {
      toDelete.push(mid);
    }
  }

  for (const mid of toDelete) {
    const entry = cache.msgs.get(mid);
    if (entry) {
      cancelPendingFlush(`msg:${userId}:${mid}`);
      if (entry.bbId) {
        await safeDeleteMemory(bb, aid, entry.bbId);
      }
      cache.msgs.delete(mid);
      count++;
    }
  }

  return count;
}

/**
 * Immediately flush all pending writes to Backboard.
 * Intended for use in SIGTERM/SIGINT handlers before process exit.
 */
export async function flushAllPending(): Promise<void> {
  const keys = [...pendingFlushes.keys()];
  if (keys.length === 0) {
    return;
  }

  logger.info(`[UserStore] Flushing ${keys.length} pending writes before shutdown`);

  const promises: Promise<unknown>[] = [];
  for (const flushKey of keys) {
    cancelPendingFlush(flushKey);

    const parts = flushKey.split(':');
    if (parts.length < 3) {
      continue;
    }
    const type = parts[0] === 'convo' ? CONVO_TYPE : MSG_TYPE;
    const userId = parts[1];
    const entryKey = parts.slice(2).join(':');

    promises.push(
      flushEntry(userId, entryKey, type).catch((err: unknown) => {
        logger.error(`[UserStore] Shutdown flush failed for ${flushKey}: ${err instanceof Error ? err.message : String(err)}`);
      }),
    );
  }

  await Promise.allSettled(promises);
  logger.info('[UserStore] Shutdown flush complete');
}
