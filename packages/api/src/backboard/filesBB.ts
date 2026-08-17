import { nanoid } from 'nanoid';
import { logger } from '@librechat/data-schemas';
import { FileContext } from 'librechat-data-provider';
import { getUserAssistantId } from './userStore';
import { backboardStorage } from './storage';

const FILE_TYPE = 'librechat_file';

interface CachedEntry {
  bbId: string;
  data: Record<string, unknown>;
}

interface FileTypeCache {
  entries: Map<string, CachedEntry>;
  loaded: boolean;
}

const fileCaches = new Map<string, FileTypeCache>();

function getClient() {
  return backboardStorage.getClient();
}

function emptyCache(): FileTypeCache {
  return { entries: new Map(), loaded: false };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stackPreview(limit = 8): string {
  return (new Error('[FilesBB] stack').stack ?? '')
    .split('\n')
    .slice(1, limit + 1)
    .map((line) => line.trim())
    .join(' | ');
}

function runtimeValueSummary(label: string, value: unknown): string {
  const ctor =
    value != null && typeof value === 'object' && 'constructor' in value
      ? (value as { constructor?: { name?: string } }).constructor?.name ?? 'unknown'
      : 'n/a';
  const keys =
    value != null && typeof value === 'object' ? Object.keys(value as Record<string, unknown>).join(',') : 'n/a';
  const preview = safeStringify(value).slice(0, 220);
  return `${label}: type=${typeof value}, ctor=${ctor}, isArray=${Array.isArray(value)}, keys=${keys}, value=${preview}`;
}

async function getFileCache(userId: string): Promise<FileTypeCache> {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    logger.warn(`[FilesBB] Invalid userId entering getFileCache | ${runtimeValueSummary('userId', userId)} | stack=${stackPreview()}`);
  }

  const existing = fileCaches.get(userId);
  if (existing?.loaded) {
    return existing;
  }

  const cache = emptyCache();
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.type !== FILE_TYPE) {
      continue;
    }
    try {
      const data = JSON.parse(m.content) as Record<string, unknown>;
      const fileId = (meta.file_id ?? data.file_id) as string;
      if (fileId) {
        cache.entries.set(fileId, { bbId: m.id, data });
      }
    } catch { }
  }

  cache.loaded = true;
  fileCaches.set(userId, cache);
  return cache;
}

export async function findFileByIdBB(
  userId: string,
  fileId: string,
): Promise<Record<string, unknown> | null> {
  const cache = await getFileCache(userId);
  return cache.entries.get(fileId)?.data ?? null;
}

export async function getFilesBB(
  filter: Record<string, unknown>,
  sortOptions?: Record<string, number> | null,
  all?: boolean,
): Promise<Record<string, unknown>[]> {
  const rawUserId = filter.user;
  if (typeof rawUserId !== 'string' || rawUserId.trim().length === 0) {
    logger.warn(
      `[FilesBB] Invalid filter.user entering getFilesBB | ${runtimeValueSummary('filter.user', rawUserId)} | filterKeys=${Object.keys(filter).join(',')} | stack=${stackPreview()}`,
    );
  }

  const userId = rawUserId as string;
  if (!userId) {
    return [];
  }

  const cache = await getFileCache(userId);
  let results = Array.from(cache.entries.values()).map((e) => e.data);

  for (const [key, value] of Object.entries(filter)) {
    if (key === 'user') {
      continue;
    }
    results = results.filter((r) => r[key] === value);
  }

  const sortKey = sortOptions ? Object.keys(sortOptions)[0] ?? 'updatedAt' : 'updatedAt';
  const sortDir = sortOptions?.[sortKey] ?? -1;
  results.sort((a, b) => {
    const va = new Date((a[sortKey] ?? '') as string).getTime();
    const vb = new Date((b[sortKey] ?? '') as string).getTime();
    return sortDir === -1 ? vb - va : va - vb;
  });

  return results;
}

export async function getToolFilesByIdsBB(
  userId: string,
  ids: string[],
): Promise<Record<string, unknown>[]> {
  if (!ids || ids.length === 0) {
    return [];
  }

  const cache = await getFileCache(userId);
  const idSet = new Set(ids);
  const results: Record<string, unknown>[] = [];

  for (const entry of cache.entries.values()) {
    const fileId = entry.data.file_id as string;
    if (!idSet.has(fileId)) {
      continue;
    }
    if (entry.data.context === FileContext.execute_code) {
      continue;
    }
    results.push(entry.data);
  }

  return results;
}

export async function getCodeGeneratedFilesBB(
  userId: string,
  conversationId: string,
): Promise<Record<string, unknown>[]> {
  if (!conversationId) {
    return [];
  }

  const cache = await getFileCache(userId);
  const results: Record<string, unknown>[] = [];

  for (const entry of cache.entries.values()) {
    if (entry.data.conversationId !== conversationId) {
      continue;
    }
    if (entry.data.context !== FileContext.execute_code) {
      continue;
    }
    const meta = entry.data.metadata as Record<string, unknown> | undefined;
    if (!meta?.fileIdentifier) {
      continue;
    }
    results.push(entry.data);
  }

  results.sort((a, b) => {
    const ta = new Date((a.createdAt ?? '') as string).getTime();
    const tb = new Date((b.createdAt ?? '') as string).getTime();
    return ta - tb;
  });

  return results;
}

export async function getUserCodeFilesBB(
  userId: string,
  conversationId: string,
): Promise<Record<string, unknown>[]> {
  if (!conversationId) {
    return [];
  }

  const cache = await getFileCache(userId);
  const results: Record<string, unknown>[] = [];

  for (const entry of cache.entries.values()) {
    if (entry.data.conversationId !== conversationId) {
      continue;
    }
    if (entry.data.context === FileContext.execute_code) {
      continue;
    }
    const meta = entry.data.metadata as Record<string, unknown> | undefined;
    if (!meta?.fileIdentifier) {
      continue;
    }
    results.push(entry.data);
  }

  results.sort((a, b) => {
    const ta = new Date((a.createdAt ?? '') as string).getTime();
    const tb = new Date((b.createdAt ?? '') as string).getTime();
    return ta - tb;
  });

  return results;
}

export async function createFileBB(
  fileData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const userId = (fileData.user ?? '') as string;
  const fileId = (fileData.file_id ?? nanoid()) as string;
  const now = new Date().toISOString();

  const data: Record<string, unknown> = {
    ...fileData,
    file_id: fileId,
    user: userId,
    createdAt: fileData.createdAt ?? now,
    updatedAt: now,
  };

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const cache = await getFileCache(userId);
  const existing = cache.entries.get(fileId);

  if (existing) {
    await bb.deleteMemory(aid, existing.bbId);
  }

  const content = JSON.stringify(data);
  const result = await bb.addMemory(aid, content, {
    type: FILE_TYPE,
    file_id: fileId,
    user: userId,
    updatedAt: now,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.entries.set(fileId, { bbId, data });
  return data;
}

export async function updateFileBB(
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const fileId = filter.file_id as string;
  const userId = filter.user as string;
  if (!fileId || !userId) {
    return null;
  }

  const cache = await getFileCache(userId);
  const existing = cache.entries.get(fileId);
  if (!existing) {
    return null;
  }

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  await bb.deleteMemory(aid, existing.bbId);

  const now = new Date().toISOString();
  const merged: Record<string, unknown> = { ...existing.data, ...update, updatedAt: now };
  delete merged.expiresAt;

  const content = JSON.stringify(merged);
  const result = await bb.addMemory(aid, content, {
    type: FILE_TYPE,
    file_id: fileId,
    user: userId,
    updatedAt: now,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.entries.set(fileId, { bbId, data: merged });
  return merged;
}

export async function updateFileUsageBB(
  params: { file_id: string; user?: string; inc?: number },
): Promise<Record<string, unknown> | null> {
  const { file_id, inc = 1 } = params;

  let targetUserId = params.user;
  let targetCache: FileTypeCache | undefined;

  if (targetUserId) {
    targetCache = await getFileCache(targetUserId);
  } else {
    for (const [uid, cache] of fileCaches.entries()) {
      if (cache.entries.has(file_id)) {
        targetUserId = uid;
        targetCache = cache;
        break;
      }
    }
  }

  if (!targetUserId || !targetCache) {
    return null;
  }

  const entry = targetCache.entries.get(file_id);
  if (!entry) {
    return null;
  }

  const currentUsage = (entry.data.usage as number) ?? 0;
  const now = new Date().toISOString();
  const updated: Record<string, unknown> = {
    ...entry.data,
    usage: currentUsage + inc,
    updatedAt: now,
  };
  delete updated.expiresAt;
  delete updated.temp_file_id;

  const bb = getClient();
  const aid = await getUserAssistantId(targetUserId);
  await bb.deleteMemory(aid, entry.bbId);

  const content = JSON.stringify(updated);
  const result = await bb.addMemory(aid, content, {
    type: FILE_TYPE,
    file_id,
    user: targetUserId,
    updatedAt: now,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  targetCache.entries.set(file_id, { bbId, data: updated });
  return updated;
}

export async function updateFilesUsageBB(
  files: Array<{ file_id: string }>,
  fileIds?: string[],
): Promise<Record<string, unknown>[]> {
  const seen = new Set<string>();
  const promises: Promise<Record<string, unknown> | null>[] = [];

  for (const file of files) {
    if (seen.has(file.file_id)) {
      continue;
    }
    seen.add(file.file_id);
    promises.push(updateFileUsageBB({ file_id: file.file_id }));
  }

  if (fileIds) {
    for (const fid of fileIds) {
      if (seen.has(fid)) {
        continue;
      }
      seen.add(fid);
      promises.push(updateFileUsageBB({ file_id: fid }));
    }
  }

  const results = await Promise.all(promises);
  return results.filter((r): r is Record<string, unknown> => r != null);
}

export async function deleteFileBB(
  userId: string,
  fileId: string,
): Promise<Record<string, unknown> | null> {
  const cache = await getFileCache(userId);
  const entry = cache.entries.get(fileId);
  if (!entry) {
    return null;
  }

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  await bb.deleteMemory(aid, entry.bbId);
  cache.entries.delete(fileId);
  return entry.data;
}

export async function deleteFilesBB(
  filter: Record<string, unknown>,
): Promise<{ deletedCount: number }> {
  const userId = filter.user as string;
  if (!userId) {
    return { deletedCount: 0 };
  }

  const cache = await getFileCache(userId);
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  let count = 0;

  const fileIdFilter = filter.file_id as { $in?: string[] } | undefined;
  if (fileIdFilter?.$in) {
    for (const fid of fileIdFilter.$in) {
      const entry = cache.entries.get(fid);
      if (!entry) {
        continue;
      }
      await bb.deleteMemory(aid, entry.bbId);
      cache.entries.delete(fid);
      count++;
    }
    return { deletedCount: count };
  }

  for (const [fid, entry] of cache.entries.entries()) {
    await bb.deleteMemory(aid, entry.bbId);
    cache.entries.delete(fid);
    count++;
  }
  return { deletedCount: count };
}

export async function deleteFileByFilterBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const userId = filter.user as string;
  if (!userId) {
    return null;
  }

  const cache = await getFileCache(userId);

  for (const [fileId, entry] of cache.entries.entries()) {
    let matches = true;
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'user') {
        continue;
      }
      if (entry.data[key] !== value) {
        matches = false;
        break;
      }
    }

    if (!matches) {
      continue;
    }

    const bb = getClient();
    const aid = await getUserAssistantId(userId);
    await bb.deleteMemory(aid, entry.bbId);
    cache.entries.delete(fileId);
    return entry.data;
  }

  return null;
}

export async function batchUpdateFilesBB(
  updates: Array<{ file_id: string; filepath: string }>,
): Promise<void> {
  if (!updates || updates.length === 0) {
    return;
  }

  let count = 0;
  for (const update of updates) {
    for (const [userId, cache] of fileCaches.entries()) {
      const entry = cache.entries.get(update.file_id);
      if (!entry) {
        continue;
      }

      const bb = getClient();
      const aid = await getUserAssistantId(userId);
      await bb.deleteMemory(aid, entry.bbId);

      const now = new Date().toISOString();
      const merged = { ...entry.data, filepath: update.filepath, updatedAt: now };
      const content = JSON.stringify(merged);
      const result = await bb.addMemory(aid, content, {
        type: FILE_TYPE,
        file_id: update.file_id,
        user: userId,
        updatedAt: now,
      });

      const bbId = (result.memory_id ?? result.id ?? '') as string;
      cache.entries.set(update.file_id, { bbId, data: merged });
      count++;
      break;
    }
  }

  logger.info(`[batchUpdateFilesBB] Updated ${count} files`);
}
