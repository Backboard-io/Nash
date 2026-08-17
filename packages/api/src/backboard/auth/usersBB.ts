import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import { logger, signPayload } from '@librechat/data-schemas';

import type { IUser, BalanceConfig, CreateUserRequest, UserDeleteResult } from '@librechat/data-schemas';

import { AUTH_USER, getAuthCache, upsertAuthEntry, deleteAuthEntry } from '../authStore';

const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_KEY_LENGTH = 64;
const DEFAULT_SESSION_EXPIRY = 1000 * 60 * 15;

function isBcryptHash(value: string): boolean {
  return value.startsWith('$2a$') || value.startsWith('$2b$') || value.startsWith('$2y$');
}

interface UserSearchFilter {
  _id?: string;
  email?: string;
  username?: string;
  openidId?: string;
  googleId?: string;
  githubId?: string;
  discordId?: string;
  facebookId?: string;
  ldapId?: string;
  samlId?: string;
  appleId?: string;
  $or?: UserSearchFilter[];
}

const IDENTITY_FIELDS = [
  'username',
  'openidId',
  'googleId',
  'githubId',
  'discordId',
  'facebookId',
  'ldapId',
  'samlId',
  'appleId',
] as const;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SCRYPT_SALT_LENGTH).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  if (isBcryptHash(stored)) {
    return bcrypt.compareSync(password, stored);
  }
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) {
    return false;
  }
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

/** Bridges Backboard cache POJO to IUser (equivalent to mongoose `.lean()` results) */
function toUser(data: Record<string, unknown>): IUser {
  return data as unknown as IUser;
}

async function findUserBB(
  filter: UserSearchFilter,
  fieldsToSelect?: string | string[] | null,
): Promise<IUser | null> {
  const cache = await getAuthCache();

  if (filter._id) {
    const entry = cache.users.get(filter._id);
    return entry ? toUser(entry.data) : null;
  }

  if (filter.email) {
    const normalized = filter.email.trim().toLowerCase();
    const userId = cache.usersByEmail.get(normalized);
    if (!userId) {
      return null;
    }
    const entry = cache.users.get(userId);
    return entry ? toUser(entry.data) : null;
  }

  for (const field of IDENTITY_FIELDS) {
    if (!filter[field]) {
      continue;
    }
    for (const entry of cache.users.values()) {
      if (entry.data[field] === filter[field]) {
        return toUser(entry.data);
      }
    }
    return null;
  }

  if (filter.$or) {
    for (const condition of filter.$or) {
      const result = await findUserBB(condition);
      if (result) {
        return result;
      }
    }
    return null;
  }

  return null;
}

async function getUserByIdBB(
  id: string,
  select?: string | string[] | null,
): Promise<IUser | null> {
  const cache = await getAuthCache();
  const entry = cache.users.get(id);
  return entry ? toUser(entry.data) : null;
}

async function createUserBB(
  data: CreateUserRequest,
  domain?: string,
  balanceConfig?: BalanceConfig,
): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();

  const userData: Record<string, unknown> = {
    ...data,
    _id: id,
    email: data.email.trim().toLowerCase(),
    emailVerified: data.emailVerified ?? false,
    provider: data.provider ?? 'local',
    role: data.role ?? 'USER',
    createdAt: now,
    updatedAt: now,
  };

  if (domain) {
    userData.domain = domain;
  }

  if (typeof data.password === 'string' && data.password.length > 0) {
    userData.password = isBcryptHash(data.password) ? data.password : hashPassword(data.password);
  }

  await upsertAuthEntry(AUTH_USER, id, userData);
  logger.info(`[UsersBB] Created user ${id} (${String(userData.email)})`);
  return id;
}

async function updateUserBB(id: string, update: Partial<IUser>): Promise<IUser | null> {
  const cache = await getAuthCache();
  const entry = cache.users.get(id);
  if (!entry) {
    return null;
  }

  const updateData = { ...update } as Record<string, unknown>;

  const pw = updateData.password;
  if (typeof pw === 'string' && pw.length > 0) {
    updateData.password = isBcryptHash(pw) ? pw : hashPassword(pw);
  }

  const emailVal = updateData.email;
  if (typeof emailVal === 'string') {
    updateData.email = emailVal.trim().toLowerCase();
  }

  updateData.updatedAt = new Date().toISOString();

  const merged = await upsertAuthEntry(AUTH_USER, id, updateData);
  return toUser(merged);
}

async function deleteUserByIdBB(id: string): Promise<UserDeleteResult> {
  const deleted = await deleteAuthEntry(AUTH_USER, id);
  if (!deleted) {
    return { deletedCount: 0, message: 'No user found with that ID.' };
  }
  return { deletedCount: 1, message: 'User was deleted successfully.' };
}

async function countUsersBB(filter?: UserSearchFilter): Promise<number> {
  const cache = await getAuthCache();
  if (!filter || Object.keys(filter).length === 0) {
    return cache.users.size;
  }

  let count = 0;
  for (const entry of cache.users.values()) {
    let matches = true;
    for (const [key, value] of Object.entries(filter)) {
      if (key === '$or') {
        continue;
      }
      if (entry.data[key] !== value) {
        matches = false;
        break;
      }
    }
    if (matches) {
      count++;
    }
  }
  return count;
}

async function searchUsersBB(
  query: string,
  fieldsToSearch: string[] = ['name', 'email', 'username'],
): Promise<Partial<IUser>[]> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const regex = new RegExp(query.trim(), 'i');
  const cache = await getAuthCache();
  const results: Partial<IUser>[] = [];

  for (const entry of cache.users.values()) {
    const matched = fieldsToSearch.some((field) => {
      const val = entry.data[field];
      return typeof val === 'string' && regex.test(val);
    });
    if (matched) {
      results.push(toUser(entry.data));
    }
  }

  return results;
}

async function generateTokenBB(user: IUser, expiresIn?: number): Promise<string> {
  if (!user) {
    throw new Error('No user provided');
  }

  const expires = expiresIn ?? DEFAULT_SESSION_EXPIRY;
  return signPayload({
    payload: {
      id: user._id,
      username: user.username,
      provider: user.provider,
      email: user.email,
    },
    secret: process.env.JWT_SECRET,
    expirationTime: expires / 1000,
  });
}

async function updateUserPluginsBB(
  id: string,
  plugins: string[],
): Promise<IUser | null> {
  return updateUserBB(id, { plugins } as Partial<IUser>);
}

async function toggleUserMemoriesBB(id: string): Promise<IUser | null> {
  const cache = await getAuthCache();
  const entry = cache.users.get(id);
  if (!entry) {
    return null;
  }

  const personalization = (entry.data.personalization ?? {}) as { memories?: boolean };
  const current = personalization.memories ?? true;

  return updateUserBB(id, {
    personalization: { memories: !current },
  } as Partial<IUser>);
}

export {
  findUserBB,
  createUserBB,
  updateUserBB,
  countUsersBB,
  getUserByIdBB,
  searchUsersBB,
  hashPassword,
  verifyPassword,
  generateTokenBB,
  deleteUserByIdBB,
  updateUserPluginsBB,
  toggleUserMemoriesBB,
};

export type { UserSearchFilter };
