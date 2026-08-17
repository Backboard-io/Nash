import { nanoid } from 'nanoid';
import { ErrorTypes } from 'librechat-data-provider';
import { logger, encrypt, decrypt } from '@librechat/data-schemas';
import { getUserAssistantId } from './userStore';
import { backboardStorage } from './storage';

const KEY_TYPE = 'librechat_key';
const PLUGINAUTH_TYPE = 'librechat_pluginauth';

interface CachedEntry {
  bbId: string;
  data: Record<string, unknown>;
}

interface KeysCache {
  keys: Map<string, CachedEntry>;
  pluginAuths: Map<string, CachedEntry>;
  loaded: boolean;
}

const keysCaches = new Map<string, KeysCache>();

function getClient() {
  return backboardStorage.getClient();
}

function emptyCache(): KeysCache {
  return { keys: new Map(), pluginAuths: new Map(), loaded: false };
}

function pluginAuthCacheKey(authField: string, pluginKey?: string): string {
  return `${authField}||${pluginKey ?? ''}`;
}

async function getKeysCache(userId: string): Promise<KeysCache> {
  const existing = keysCaches.get(userId);
  if (existing?.loaded) {
    return existing;
  }

  const cache = emptyCache();
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const type = meta.type as string;

    if (type === KEY_TYPE) {
      try {
        const data = JSON.parse(m.content) as Record<string, unknown>;
        const name = (meta.keyName ?? data.name) as string;
        if (name) {
          cache.keys.set(name, { bbId: m.id, data });
        }
      } catch { }
      continue;
    }

    if (type === PLUGINAUTH_TYPE) {
      try {
        const data = JSON.parse(m.content) as Record<string, unknown>;
        const authField = (data.authField ?? meta.authField) as string;
        const pluginKey = (data.pluginKey ?? meta.pluginKey) as string | undefined;
        if (authField) {
          const cacheKey = pluginAuthCacheKey(authField, pluginKey);
          cache.pluginAuths.set(cacheKey, { bbId: m.id, data });
        }
      } catch { }
    }
  }

  cache.loaded = true;
  keysCaches.set(userId, cache);
  return cache;
}

export async function getUserKeyBB(
  userId: string,
  name: string,
): Promise<string> {
  const cache = await getKeysCache(userId);
  const entry = cache.keys.get(name);

  if (!entry) {
    throw new Error(
      JSON.stringify({ type: ErrorTypes.NO_USER_KEY }),
    );
  }

  const encryptedValue = entry.data.value as string;
  return decrypt(encryptedValue);
}

export async function updateUserKeyBB(
  userId: string,
  name: string,
  data: { value: string; expiresAt?: Date | null },
): Promise<Record<string, unknown>> {
  const cache = await getKeysCache(userId);
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const existing = cache.keys.get(name);

  if (existing) {
    await bb.deleteMemory(aid, existing.bbId);
  }

  const encryptedValue = await encrypt(data.value);
  const now = new Date().toISOString();
  const entry: Record<string, unknown> = {
    userId,
    name,
    value: encryptedValue,
    updatedAt: now,
  };

  if (data.expiresAt) {
    entry.expiresAt = new Date(data.expiresAt).toISOString();
  }

  const content = JSON.stringify(entry);
  const result = await bb.addMemory(aid, content, {
    type: KEY_TYPE,
    keyName: name,
    user: userId,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.keys.set(name, { bbId, data: entry });
  return entry;
}

export async function deleteUserKeyBB(
  userId: string,
  name: string,
): Promise<boolean> {
  const cache = await getKeysCache(userId);
  const entry = cache.keys.get(name);
  if (!entry) {
    return false;
  }

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  await bb.deleteMemory(aid, entry.bbId);
  cache.keys.delete(name);
  return true;
}

export async function getUserKeyValuesBB(
  userId: string,
  name: string,
): Promise<Record<string, string>> {
  const decrypted = await getUserKeyBB(userId, name);
  try {
    return JSON.parse(decrypted) as Record<string, string>;
  } catch (e) {
    logger.error('[getUserKeyValuesBB]', e);
    throw new Error(
      JSON.stringify({ type: ErrorTypes.INVALID_USER_KEY }),
    );
  }
}

export async function getUserKeyExpiryBB(
  userId: string,
  name: string,
): Promise<{ expiresAt: string | 'never' | null }> {
  const cache = await getKeysCache(userId);
  const entry = cache.keys.get(name);

  if (!entry) {
    return { expiresAt: null };
  }

  const expiresAt = entry.data.expiresAt as string | undefined;
  return { expiresAt: expiresAt ?? 'never' };
}

export async function findOnePluginAuthBB(
  filter: { userId: string; authField: string; pluginKey?: string },
): Promise<Record<string, unknown> | null> {
  const cache = await getKeysCache(filter.userId);

  if (filter.pluginKey) {
    const cacheKey = pluginAuthCacheKey(filter.authField, filter.pluginKey);
    return cache.pluginAuths.get(cacheKey)?.data ?? null;
  }

  for (const entry of cache.pluginAuths.values()) {
    if (entry.data.authField !== filter.authField) {
      continue;
    }
    return entry.data;
  }

  return null;
}

export async function findPluginAuthsByKeysBB(
  userId: string,
  pluginKeys: string[],
): Promise<Record<string, unknown>[]> {
  if (!pluginKeys || pluginKeys.length === 0) {
    return [];
  }

  const cache = await getKeysCache(userId);
  const keySet = new Set(pluginKeys);
  const results: Record<string, unknown>[] = [];

  for (const entry of cache.pluginAuths.values()) {
    const pk = entry.data.pluginKey as string | undefined;
    if (pk && keySet.has(pk)) {
      results.push(entry.data);
    }
  }

  return results;
}

export async function updatePluginAuthBB(
  filter: { userId: string; authField: string; pluginKey: string },
  data: { value: string },
): Promise<Record<string, unknown>> {
  const cache = await getKeysCache(filter.userId);
  const bb = getClient();
  const aid = await getUserAssistantId(filter.userId);
  const cacheKey = pluginAuthCacheKey(filter.authField, filter.pluginKey);
  const existing = cache.pluginAuths.get(cacheKey);

  if (existing) {
    await bb.deleteMemory(aid, existing.bbId);
  }

  const now = new Date().toISOString();
  const entry: Record<string, unknown> = {
    _id: existing?.data._id ?? nanoid(),
    userId: filter.userId,
    authField: filter.authField,
    pluginKey: filter.pluginKey,
    value: data.value,
    createdAt: existing?.data.createdAt ?? now,
    updatedAt: now,
  };

  const content = JSON.stringify(entry);
  const result = await bb.addMemory(aid, content, {
    type: PLUGINAUTH_TYPE,
    authField: filter.authField,
    pluginKey: filter.pluginKey,
    user: filter.userId,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.pluginAuths.set(cacheKey, { bbId, data: entry });
  return entry;
}

export async function deletePluginAuthBB(
  userId: string,
  authField: string,
): Promise<boolean> {
  const cache = await getKeysCache(userId);
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  let deleted = false;

  const toDelete: string[] = [];
  for (const [cacheKey, entry] of cache.pluginAuths.entries()) {
    if (entry.data.authField === authField) {
      toDelete.push(cacheKey);
    }
  }

  for (const cacheKey of toDelete) {
    const entry = cache.pluginAuths.get(cacheKey);
    if (!entry) {
      continue;
    }
    await bb.deleteMemory(aid, entry.bbId);
    cache.pluginAuths.delete(cacheKey);
    deleted = true;
  }

  return deleted;
}

export async function deleteAllUserPluginAuthsBB(
  userId: string,
): Promise<{ deletedCount: number }> {
  const cache = await getKeysCache(userId);
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  let count = 0;

  const allKeys = Array.from(cache.pluginAuths.keys());
  for (const cacheKey of allKeys) {
    const entry = cache.pluginAuths.get(cacheKey);
    if (!entry) {
      continue;
    }
    await bb.deleteMemory(aid, entry.bbId);
    cache.pluginAuths.delete(cacheKey);
    count++;
  }

  return { deletedCount: count };
}
