import { logger } from '@librechat/data-schemas';
import { backboardStorage } from './storage';

import type { BackboardDocument } from './types';

/** Uploads a file buffer to the Backboard assistant's document store. */
export async function uploadDocumentToBackboard(
  filename: string,
  fileBuffer: Buffer,
): Promise<BackboardDocument> {
  const bb = backboardStorage.getClient();
  const assistantId = await backboardStorage.getAssistantId();
  const doc = await bb.uploadDocumentToAssistant(assistantId, filename, fileBuffer);
  logger.info(`[Backboard Docs] Uploaded ${filename} → ${doc.document_id}`);
  return doc;
}

/** Uploads a file buffer to a specific Backboard thread. */
export async function uploadDocumentToThread(
  threadId: string,
  filename: string,
  fileBuffer: Buffer,
): Promise<BackboardDocument> {
  const bb = backboardStorage.getClient();
  const doc = await bb.uploadDocumentToThread(threadId, filename, fileBuffer);
  logger.info(`[Backboard Docs] Uploaded ${filename} to thread ${threadId} → ${doc.document_id}`);
  return doc;
}

/** Lists all documents for the Backboard assistant. */
export async function listBackboardDocuments(): Promise<BackboardDocument[]> {
  const bb = backboardStorage.getClient();
  const assistantId = await backboardStorage.getAssistantId();
  return bb.listAssistantDocuments(assistantId);
}

/** Deletes a document from Backboard. */
export async function deleteBackboardDocument(documentId: string): Promise<boolean> {
  const bb = backboardStorage.getClient();
  try {
    await bb.deleteDocument(documentId);
    logger.info(`[Backboard Docs] Deleted document ${documentId}`);
    return true;
  } catch {
    return false;
  }
}
