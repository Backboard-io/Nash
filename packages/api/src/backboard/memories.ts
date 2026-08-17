import { getUserAssistantId } from './userStore';
import { backboardStorage } from './storage';

const MEMORY_TYPE = 'librechat_memory';

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export interface FormattedMemoriesResult {
  withKeys: string;
  withoutKeys: string;
  totalTokens?: number;
}

/**
 * Reads ALL memories from the user's per-user Backboard assistant.
 * This includes both Backboard auto-memories (stored via memory: Auto)
 * and any LibreChat-tagged memories.
 */
export async function getFormattedMemoriesBB(userId: string): Promise<FormattedMemoriesResult> {
  const memories = await getAllUserMemoriesBB(userId);
  if (!memories.length) {
    return { withKeys: '', withoutKeys: '', totalTokens: 0 };
  }

  const sorted = memories.sort(
    (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
  );
  const totalTokens = sorted.reduce((sum, m) => sum + (m.tokenCount || 0), 0);

  const withKeys = sorted
    .map((m, i) => {
      const date = formatDate(new Date(m.updated_at));
      const tokenInfo = m.tokenCount ? ` [${m.tokenCount} tokens]` : '';
      return `${i + 1}. [${date}]. ["key": "${m.key}"]${tokenInfo}. ["value": "${m.value}"]`;
    })
    .join('\n\n');

  const withoutKeys = sorted
    .map((m, i) => {
      const date = formatDate(new Date(m.updated_at));
      return `${i + 1}. [${date}]. ${m.value}`;
    })
    .join('\n\n');

  return { withKeys, withoutKeys, totalTokens };
}

interface UserMemory {
  key: string;
  value: string;
  tokenCount: number;
  updated_at: Date;
}

/** Returns true for entries that are user-facing memories (manual or Backboard auto-memories). */
function isUserMemory(meta: Record<string, unknown>, content: string): boolean {
  const type = meta.type as string | undefined;
  if (type === MEMORY_TYPE) {
    return true;
  }
  if (type) {
    return false;
  }
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false;
  }
  return true;
}

/** Reads user-facing memories, filtering out internal app metadata and JSON blobs. */
export async function getAllUserMemoriesBB(userId: string): Promise<UserMemory[]> {
  const bb = backboardStorage.getClient();
  const assistantId = await getUserAssistantId(userId);
  const response = await bb.getMemories(assistantId);

  const results: UserMemory[] = [];
  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (!isUserMemory(meta, m.content)) {
      continue;
    }
    results.push({
      key: (meta.key as string) ?? '',
      value: m.content,
      tokenCount: (meta.tokenCount as number) ?? 0,
      updated_at: new Date(m.updated_at ?? m.created_at ?? Date.now()),
    });
  }
  return results;
}

async function findUserMemoryByKey(
  userId: string,
  key: string,
): Promise<{ id: string } | undefined> {
  const bb = backboardStorage.getClient();
  const assistantId = await getUserAssistantId(userId);
  const response = await bb.getMemories(assistantId);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.type === MEMORY_TYPE && meta.key === key) {
      return { id: m.id };
    }
  }
  return undefined;
}

export async function createMemoryBB(params: {
  userId: string;
  key: string;
  value: string;
  tokenCount: number;
}): Promise<{ ok: boolean }> {
  const bb = backboardStorage.getClient();
  const assistantId = await getUserAssistantId(params.userId);

  const existing = await findUserMemoryByKey(params.userId, params.key);
  if (existing) {
    await bb.deleteMemory(assistantId, existing.id);
  }

  await bb.addMemory(assistantId, params.value, {
    type: MEMORY_TYPE,
    userId: params.userId,
    key: params.key,
    tokenCount: params.tokenCount,
  });

  return { ok: true };
}

export async function setMemoryBB(params: {
  userId: string;
  key: string;
  value: string;
  tokenCount: number;
}): Promise<{ ok: boolean }> {
  const bb = backboardStorage.getClient();
  const assistantId = await getUserAssistantId(params.userId);

  const existing = await findUserMemoryByKey(params.userId, params.key);
  if (existing) {
    await bb.deleteMemory(assistantId, existing.id);
  }

  await bb.addMemory(assistantId, params.value, {
    type: MEMORY_TYPE,
    userId: params.userId,
    key: params.key,
    tokenCount: params.tokenCount,
  });

  return { ok: true };
}

export async function deleteMemoryBB(params: {
  userId: string;
  key: string;
}): Promise<{ ok: boolean }> {
  const bb = backboardStorage.getClient();
  const assistantId = await getUserAssistantId(params.userId);

  const existing = await findUserMemoryByKey(params.userId, params.key);
  if (!existing) {
    return { ok: false };
  }

  try {
    await bb.deleteMemory(assistantId, existing.id);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
