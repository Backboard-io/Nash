import { v4 as uuidv4 } from 'uuid';
import { logger } from '@librechat/data-schemas';
import { backboardStorage } from './storage';
import { getUserAssistantId, getUserCache } from './userStore';

import type { BackboardMemory } from './types';

const FOLDER_TYPE = 'librechat_folder';

interface FolderData {
  folderId: string;
  name: string;
  assistantId: string;
  sharedMemory: boolean;
  createdAt: string;
  updatedAt: string;
}

function getClient() {
  return backboardStorage.getClient();
}

function parseFolder(memory: BackboardMemory): FolderData | null {
  try {
    return JSON.parse(memory.content) as FolderData;
  } catch {
    return null;
  }
}

export async function listFoldersBB(userId: string): Promise<FolderData[]> {
  const cache = await getUserCache(userId);
  const folders: FolderData[] = [];

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.type !== FOLDER_TYPE) {
      continue;
    }
    const folder = parseFolder(m);
    if (folder) {
      folders.push(folder);
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  return folders;
}

export async function createFolderBB(
  userId: string,
  name: string,
  sharedMemory: boolean,
): Promise<FolderData> {
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const folderId = uuidv4();

  let assistantId: string;
  if (sharedMemory) {
    const envId = process.env.BACKBOARD_ASSISTANT_ID;
    if (envId) {
      assistantId = envId;
    } else {
      const assistants = await bb.listAssistants();
      const existing = assistants.find((a) => a.name === 'LibreChat');
      assistantId = existing?.assistant_id ?? '';
    }
  } else {
    const folderAssistant = await bb.createAssistant(
      `librechat-folder-${folderId}`,
      `Isolated folder assistant: ${name}`,
    );
    assistantId = folderAssistant.assistant_id;
    logger.info(`[Folders] Created isolated assistant ${assistantId} for folder "${name}"`);
  }

  const now = new Date().toISOString();
  const folder: FolderData = {
    folderId,
    name,
    assistantId,
    sharedMemory,
    createdAt: now,
    updatedAt: now,
  };

  await bb.addMemory(aid, JSON.stringify(folder), {
    type: FOLDER_TYPE,
    folderId,
    user: userId,
  });

  logger.info(`[Folders] Created folder "${name}" (${folderId}) for user ${userId}`);
  return folder;
}

export async function deleteFolderBB(userId: string, folderId: string): Promise<boolean> {
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.type !== FOLDER_TYPE || meta.folderId !== folderId) {
      continue;
    }

    const folder = parseFolder(m);
    if (folder && !folder.sharedMemory && folder.assistantId) {
      try {
        await bb.deleteAssistant(folder.assistantId);
        logger.info(`[Folders] Deleted isolated assistant ${folder.assistantId}`);
      } catch (err) {
        logger.warn(`[Folders] Failed to delete assistant ${folder.assistantId}:`, err);
      }
    }

    await bb.deleteMemory(aid, m.id);
    logger.info(`[Folders] Deleted folder ${folderId} for user ${userId}`);
    return true;
  }

  return false;
}

export async function getFolderBB(
  userId: string,
  folderId: string,
): Promise<FolderData | null> {
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.type !== FOLDER_TYPE || meta.folderId !== folderId) {
      continue;
    }
    return parseFolder(m);
  }

  return null;
}
