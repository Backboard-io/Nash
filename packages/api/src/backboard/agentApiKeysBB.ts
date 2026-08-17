import { nanoid } from 'nanoid';
import { logger, hashToken, getRandomValues } from '@librechat/data-schemas';
import { getUserAssistantId } from './userStore';
import { backboardStorage } from './storage';

const AGENTAPIKEY_TYPE = 'librechat_agentapikey';
const API_KEY_PREFIX = 'sk-';
const API_KEY_LENGTH = 32;

interface CachedEntry {
  bbId: string;
  data: Record<string, unknown>;
}

interface AgentApiKeyCache {
  entries: Map<string, CachedEntry>;
  loaded: boolean;
}

const apiKeyCaches = new Map<string, AgentApiKeyCache>();
const keyHashIndex = new Map<string, { userId: string; keyId: string }>();

function getClient() {
  return backboardStorage.getClient();
}

function emptyCache(): AgentApiKeyCache {
  return { entries: new Map(), loaded: false };
}

async function getApiKeyCache(userId: string): Promise<AgentApiKeyCache> {
  const existing = apiKeyCaches.get(userId);
  if (existing?.loaded) {
    return existing;
  }

  const cache = emptyCache();
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.type !== AGENTAPIKEY_TYPE) {
      continue;
    }
    try {
      const data = JSON.parse(m.content) as Record<string, unknown>;
      const keyId = (meta.keyId ?? data._id) as string;
      if (keyId) {
        cache.entries.set(keyId, { bbId: m.id, data });
        const kh = data.keyHash as string | undefined;
        if (kh) {
          keyHashIndex.set(kh, { userId, keyId });
        }
      }
    } catch { }
  }

  cache.loaded = true;
  apiKeyCaches.set(userId, cache);
  return cache;
}

export async function createAgentApiKeyBB(
  data: { userId: string; name: string; expiresAt?: Date | null },
): Promise<{
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: string;
  expiresAt?: string;
}> {
  const randomPart = await getRandomValues(API_KEY_LENGTH);
  const key = `${API_KEY_PREFIX}${randomPart}`;
  const kHash = await hashToken(key);
  const keyPrefix = key.slice(0, 8);
  const keyId = nanoid();
  const now = new Date().toISOString();

  const entry: Record<string, unknown> = {
    _id: keyId,
    userId: data.userId,
    name: data.name,
    keyHash: kHash,
    keyPrefix,
    createdAt: now,
    updatedAt: now,
  };

  if (data.expiresAt) {
    entry.expiresAt = new Date(data.expiresAt).toISOString();
  }

  const bb = getClient();
  const aid = await getUserAssistantId(data.userId);
  const cache = await getApiKeyCache(data.userId);

  const content = JSON.stringify(entry);
  const result = await bb.addMemory(aid, content, {
    type: AGENTAPIKEY_TYPE,
    keyId,
    user: data.userId,
    keyPrefix,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.entries.set(keyId, { bbId, data: entry });
  keyHashIndex.set(kHash, { userId: data.userId, keyId });

  const createResult: {
    id: string;
    name: string;
    keyPrefix: string;
    key: string;
    createdAt: string;
    expiresAt?: string;
  } = {
    id: keyId,
    name: data.name,
    keyPrefix,
    key,
    createdAt: now,
  };

  if (entry.expiresAt) {
    createResult.expiresAt = entry.expiresAt as string;
  }

  return createResult;
}

export async function validateAgentApiKeyBB(
  apiKey: string,
): Promise<{ userId: string; keyId: string } | null> {
  const kHash = await hashToken(apiKey);
  const indexed = keyHashIndex.get(kHash);

  if (!indexed) {
    return null;
  }

  const cache = await getApiKeyCache(indexed.userId);
  const entry = cache.entries.get(indexed.keyId);

  if (!entry) {
    return null;
  }

  const expiresAt = entry.data.expiresAt as string | undefined;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return null;
  }

  const bb = getClient();
  const aid = await getUserAssistantId(indexed.userId);
  const now = new Date().toISOString();
  const updated = { ...entry.data, lastUsedAt: now, updatedAt: now };

  await bb.deleteMemory(aid, entry.bbId);
  const content = JSON.stringify(updated);
  const result = await bb.addMemory(aid, content, {
    type: AGENTAPIKEY_TYPE,
    keyId: indexed.keyId,
    user: indexed.userId,
    keyPrefix: (entry.data.keyPrefix ?? '') as string,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.entries.set(indexed.keyId, { bbId, data: updated });

  return { userId: indexed.userId, keyId: indexed.keyId };
}

export async function listAgentApiKeysBB(
  userId: string,
): Promise<Array<{
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}>> {
  const cache = await getApiKeyCache(userId);
  const results: Array<{
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt?: string;
    expiresAt?: string;
    createdAt: string;
  }> = [];

  for (const entry of cache.entries.values()) {
    const item: {
      id: string;
      name: string;
      keyPrefix: string;
      lastUsedAt?: string;
      expiresAt?: string;
      createdAt: string;
    } = {
      id: (entry.data._id ?? '') as string,
      name: (entry.data.name ?? '') as string,
      keyPrefix: (entry.data.keyPrefix ?? '') as string,
      createdAt: (entry.data.createdAt ?? '') as string,
    };

    if (entry.data.lastUsedAt) {
      item.lastUsedAt = entry.data.lastUsedAt as string;
    }
    if (entry.data.expiresAt) {
      item.expiresAt = entry.data.expiresAt as string;
    }

    results.push(item);
  }

  results.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });

  return results;
}

export async function deleteAgentApiKeyBB(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const cache = await getApiKeyCache(userId);
  const entry = cache.entries.get(keyId);
  if (!entry) {
    return false;
  }

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  await bb.deleteMemory(aid, entry.bbId);
  cache.entries.delete(keyId);

  const kh = entry.data.keyHash as string | undefined;
  if (kh) {
    keyHashIndex.delete(kh);
  }

  return true;
}

export async function deleteAllAgentApiKeysBB(
  userId: string,
): Promise<number> {
  const cache = await getApiKeyCache(userId);
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  let count = 0;

  const allKeys = Array.from(cache.entries.keys());
  for (const keyId of allKeys) {
    const entry = cache.entries.get(keyId);
    if (!entry) {
      continue;
    }
    await bb.deleteMemory(aid, entry.bbId);

    const kh = entry.data.keyHash as string | undefined;
    if (kh) {
      keyHashIndex.delete(kh);
    }

    cache.entries.delete(keyId);
    count++;
  }

  return count;
}

export async function getAgentApiKeyByIdBB(
  keyId: string,
): Promise<{
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
} | null> {
  for (const cache of apiKeyCaches.values()) {
    const entry = cache.entries.get(keyId);
    if (!entry) {
      continue;
    }

    const result: {
      id: string;
      name: string;
      keyPrefix: string;
      lastUsedAt?: string;
      expiresAt?: string;
      createdAt: string;
    } = {
      id: (entry.data._id ?? '') as string,
      name: (entry.data.name ?? '') as string,
      keyPrefix: (entry.data.keyPrefix ?? '') as string,
      createdAt: (entry.data.createdAt ?? '') as string,
    };

    if (entry.data.lastUsedAt) {
      result.lastUsedAt = entry.data.lastUsedAt as string;
    }
    if (entry.data.expiresAt) {
      result.expiresAt = entry.data.expiresAt as string;
    }

    return result;
  }

  return null;
}
