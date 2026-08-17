import { logger } from '@librechat/data-schemas';
import { BackboardClient } from './client';

let client: BackboardClient | null = null;
let assistantId: string | null = null;

function getClient(): BackboardClient {
  if (client) {
    return client;
  }
  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) {
    throw new Error('BACKBOARD_API_KEY environment variable is required');
  }
  const baseUrl = process.env.BACKBOARD_BASE_URL ?? 'https://app.backboard.io/api';
  client = new BackboardClient(apiKey, baseUrl);
  return client;
}

async function getAssistantId(): Promise<string> {
  if (assistantId) {
    return assistantId;
  }
  const bb = getClient();
  const assistants = await bb.listAssistants();
  const existing = assistants.find((a) => a.name === 'LibreChat');
  if (existing) {
    assistantId = existing.assistant_id;
    return assistantId;
  }
  const created = await bb.createAssistant(
    'LibreChat',
    'LibreChat storage assistant powered by Backboard',
  );
  assistantId = created.assistant_id;
  logger.info(`[Backboard Storage] Created assistant: ${assistantId}`);
  return assistantId;
}

interface StoredItem {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

async function listByType(type: string, userId?: string): Promise<StoredItem[]> {
  const bb = getClient();
  const aid = await getAssistantId();
  const response = await bb.getMemories(aid);
  return response.memories
    .filter((m) => {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      if (meta.type !== type) {
        return false;
      }
      if (userId && meta.userId !== userId) {
        return false;
      }
      return true;
    })
    .map((m) => ({
      id: m.id,
      content: m.content,
      metadata: (m.metadata ?? {}) as Record<string, unknown>,
      created_at: m.created_at ?? undefined,
      updated_at: m.updated_at ?? undefined,
    }));
}

async function createItem(
  content: string,
  metadata: Record<string, unknown>,
): Promise<StoredItem> {
  const bb = getClient();
  const aid = await getAssistantId();
  const result = await bb.addMemory(aid, content, metadata);
  const memoryId = (result.memory_id ?? result.id ?? '') as string;
  return {
    id: memoryId,
    content,
    metadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function deleteItem(memoryId: string): Promise<boolean> {
  const bb = getClient();
  const aid = await getAssistantId();
  try {
    await bb.deleteMemory(aid, memoryId);
    return true;
  } catch {
    return false;
  }
}

async function findByMetadata(
  type: string,
  key: string,
  value: string,
  userId?: string,
): Promise<StoredItem | undefined> {
  const items = await listByType(type, userId);
  return items.find((item) => item.metadata[key] === value);
}

export const backboardStorage = {
  getClient,
  getAssistantId,
  listByType,
  createItem,
  deleteItem,
  findByMetadata,
};
