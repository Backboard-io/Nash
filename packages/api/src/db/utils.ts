import { logger } from '@librechat/data-schemas';

/**
 * No-op with Backboard storage. Collections are managed by Backboard.
 */
export async function ensureCollectionExists(_db: unknown, collectionName: string): Promise<void> {
  logger.debug(`[ensureCollectionExists] Skipped for Backboard storage: ${collectionName}`);
}

/**
 * No-op with Backboard storage. Collections are managed by Backboard.
 */
export async function ensureRequiredCollectionsExist(_db?: unknown): Promise<void> {
  logger.debug('ensureRequiredCollectionsExist: Skipped for Backboard storage');
}
