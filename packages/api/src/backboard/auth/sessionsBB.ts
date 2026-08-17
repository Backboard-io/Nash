import { nanoid } from 'nanoid';
import { signPayload, hashToken } from '@librechat/data-schemas';

import type { SessionSearchParams } from '@librechat/data-schemas';

import { AUTH_SESSION, getAuthCache, upsertAuthEntry, deleteAuthEntry } from '../authStore';

const DEFAULT_REFRESH_TOKEN_EXPIRY = 1000 * 60 * 60 * 24 * 7;

interface BBSessionResult {
  session: Record<string, unknown>;
  refreshToken: string;
}

async function createSessionBB(
  userId: string,
  payload: { expiration?: Date; expiresIn?: number } = {},
): Promise<BBSessionResult> {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const sessionId = nanoid();
  const expiresIn = payload.expiresIn ?? DEFAULT_REFRESH_TOKEN_EXPIRY;
  const expiration = payload.expiration ?? new Date(Date.now() + expiresIn);

  const refreshToken = await generateRefreshTokenBB(userId, sessionId, expiration);
  const refreshTokenHash = await hashToken(refreshToken);

  const sessionData: Record<string, unknown> = {
    _id: sessionId,
    user: userId,
    expiration: expiration.toISOString(),
    refreshTokenHash,
  };

  await upsertAuthEntry(AUTH_SESSION, sessionId, sessionData);
  return { session: { ...sessionData, expiration }, refreshToken };
}

function hydrateSession(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data, expiration: new Date(data.expiration as string) };
}

async function findSessionBB(
  query: SessionSearchParams,
): Promise<Record<string, unknown> | null> {
  const cache = await getAuthCache();
  const now = new Date();

  if (query.sessionId) {
    const sid = typeof query.sessionId === 'string'
      ? query.sessionId
      : query.sessionId.sessionId;
    const entry = cache.sessions.get(sid);
    if (!entry) {
      return null;
    }
    const exp = new Date(entry.data.expiration as string);
    return exp > now ? hydrateSession(entry.data) : null;
  }

  if (query.refreshToken) {
    const tokenHash = await hashToken(query.refreshToken);
    for (const entry of cache.sessions.values()) {
      if (entry.data.refreshTokenHash !== tokenHash) {
        continue;
      }
      const exp = new Date(entry.data.expiration as string);
      return exp > now ? hydrateSession(entry.data) : null;
    }
    return null;
  }

  if (query.userId) {
    for (const entry of cache.sessions.values()) {
      if (entry.data.user !== query.userId) {
        continue;
      }
      const exp = new Date(entry.data.expiration as string);
      if (exp > now) {
        return hydrateSession(entry.data);
      }
    }
    return null;
  }

  return null;
}

async function deleteSessionBB(sessionId: string): Promise<{ deletedCount: number }> {
  const deleted = await deleteAuthEntry(AUTH_SESSION, sessionId);
  return { deletedCount: deleted ? 1 : 0 };
}

async function deleteAllUserSessionsBB(userId: string): Promise<{ deletedCount: number }> {
  const cache = await getAuthCache();
  const toDelete: string[] = [];

  for (const [sid, entry] of cache.sessions.entries()) {
    if (entry.data.user === userId) {
      toDelete.push(sid);
    }
  }

  let count = 0;
  for (const sid of toDelete) {
    const deleted = await deleteAuthEntry(AUTH_SESSION, sid);
    if (deleted) {
      count++;
    }
  }

  return { deletedCount: count };
}

async function updateExpirationBB(
  sessionId: string,
  expiration: Date,
): Promise<Record<string, unknown> | null> {
  const cache = await getAuthCache();
  const entry = cache.sessions.get(sessionId);
  if (!entry) {
    return null;
  }

  const merged = await upsertAuthEntry(AUTH_SESSION, sessionId, {
    expiration: expiration.toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return hydrateSession(merged);
}

async function countActiveSessionsBB(userId: string): Promise<number> {
  const cache = await getAuthCache();
  const now = new Date();
  let count = 0;

  for (const entry of cache.sessions.values()) {
    if (entry.data.user !== userId) {
      continue;
    }
    const exp = new Date(entry.data.expiration as string);
    if (exp > now) {
      count++;
    }
  }

  return count;
}

async function generateRefreshTokenBB(
  userId: string,
  sessionId: string,
  expiration?: Date,
): Promise<string> {
  const exp = expiration ?? new Date(Date.now() + DEFAULT_REFRESH_TOKEN_EXPIRY);
  const expirationTime = Math.max(Math.floor((exp.getTime() - Date.now()) / 1000), 1);

  return signPayload({
    payload: { id: userId, sessionId },
    secret: process.env.JWT_REFRESH_SECRET,
    expirationTime,
  });
}

export {
  findSessionBB,
  createSessionBB,
  deleteSessionBB,
  updateExpirationBB,
  countActiveSessionsBB,
  generateRefreshTokenBB,
  deleteAllUserSessionsBB,
};

export type { BBSessionResult };
