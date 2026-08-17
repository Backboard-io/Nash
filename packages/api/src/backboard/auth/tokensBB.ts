import { nanoid } from 'nanoid';
import { logger } from '@librechat/data-schemas';
import { getAuthCache, upsertAuthEntry, deleteAuthEntry, AUTH_TOKEN } from '../authStore';

interface TokenQuery {
  userId?: string;
  token?: string;
  email?: string;
  identifier?: string;
}

interface TokenData {
  id: string;
  userId?: string;
  token: string;
  email?: string;
  identifier?: string;
  expiresIn?: number;
  expiresAt?: string;
  createdAt: string;
  [key: string]: unknown;
}

export async function createTokenBB(
  tokenData: Record<string, unknown>,
): Promise<TokenData> {
  try {
    const now = new Date();
    const expiresIn = (tokenData.expiresIn as number) ?? 3600;
    const expiresAt = new Date(now.getTime() + expiresIn * 1000);

    const id = nanoid();
    const entry: TokenData = {
      ...tokenData as Omit<TokenData, 'id' | 'createdAt'>,
      id,
      token: (tokenData.token as string) ?? nanoid(32),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await upsertAuthEntry(AUTH_TOKEN, id, entry);
    return entry;
  } catch (error) {
    logger.debug('Error creating token:', error);
    throw error;
  }
}

export async function findTokenBB(
  query: TokenQuery,
): Promise<TokenData | null> {
  try {
    const cache = await getAuthCache();

    for (const entry of cache.tokens.values()) {
      const data = entry.data as TokenData;

      let match = true;
      if (query.userId && data.userId !== query.userId) {
        match = false;
      }
      if (query.token && data.token !== query.token) {
        match = false;
      }
      if (query.email && (data.email ?? '').toLowerCase() !== query.email.trim().toLowerCase()) {
        match = false;
      }
      if (query.identifier && data.identifier !== query.identifier) {
        match = false;
      }

      if (!match) {
        continue;
      }

      if (data.expiresAt && new Date(data.expiresAt).getTime() < Date.now()) {
        continue;
      }

      return data;
    }

    return null;
  } catch (error) {
    logger.debug('Error finding token:', error);
    throw error;
  }
}

export async function updateTokenBB(
  query: TokenQuery,
  updateData: Record<string, unknown>,
): Promise<TokenData | null> {
  try {
    const existing = await findTokenBB(query);
    if (!existing) {
      return null;
    }

    const merged = { ...existing, ...updateData };
    if (updateData.expiresIn !== undefined) {
      merged.expiresAt = new Date(
        Date.now() + (updateData.expiresIn as number) * 1000,
      ).toISOString();
    }

    await upsertAuthEntry(AUTH_TOKEN, existing.id, merged as Record<string, unknown>);
    return merged as TokenData;
  } catch (error) {
    logger.debug('Error updating token:', error);
    throw error;
  }
}

export async function deleteTokensBB(
  query: TokenQuery,
): Promise<{ deletedCount: number }> {
  try {
    if (!query.userId && !query.token && !query.email && !query.identifier) {
      throw new Error('At least one query parameter must be provided');
    }

    const cache = await getAuthCache();
    const toDelete: string[] = [];

    for (const [id, entry] of cache.tokens.entries()) {
      const data = entry.data as TokenData;
      let match = false;

      if (query.userId && data.userId === query.userId) {
        match = true;
      }
      if (query.token && data.token === query.token) {
        match = true;
      }
      if (query.email && (data.email ?? '').toLowerCase() === query.email.trim().toLowerCase()) {
        match = true;
      }
      if (query.identifier && data.identifier === query.identifier) {
        match = true;
      }

      if (match) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      await deleteAuthEntry(AUTH_TOKEN, id);
    }

    return { deletedCount: toDelete.length };
  } catch (error) {
    logger.debug('Error deleting tokens:', error);
    throw error;
  }
}
