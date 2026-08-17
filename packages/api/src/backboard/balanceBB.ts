import { nanoid } from 'nanoid';
import { logger } from '@librechat/data-schemas';
import { getUserAssistantId } from './userStore';
import { backboardStorage } from './storage';

const BALANCE_TYPE = 'librechat_balance';
const TRANSACTION_TYPE = 'librechat_transaction';

interface CachedEntry {
  bbId: string;
  data: Record<string, unknown>;
}

interface BalanceCache {
  balance: CachedEntry | null;
  transactions: Map<string, CachedEntry>;
  loaded: boolean;
}

const balanceCaches = new Map<string, BalanceCache>();

function getClient() {
  return backboardStorage.getClient();
}

function emptyCache(): BalanceCache {
  return { balance: null, transactions: new Map(), loaded: false };
}

async function getBalanceCache(userId: string): Promise<BalanceCache> {
  const existing = balanceCaches.get(userId);
  if (existing?.loaded) {
    return existing;
  }

  const cache = emptyCache();
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const type = meta.type as string;

    if (type === BALANCE_TYPE) {
      try {
        const data = JSON.parse(m.content) as Record<string, unknown>;
        cache.balance = { bbId: m.id, data };
      } catch { }
      continue;
    }

    if (type === TRANSACTION_TYPE) {
      try {
        const data = JSON.parse(m.content) as Record<string, unknown>;
        const txId = (meta.transactionId ?? data._id) as string;
        if (txId) {
          cache.transactions.set(txId, { bbId: m.id, data });
        }
      } catch { }
    }
  }

  cache.loaded = true;
  balanceCaches.set(userId, cache);
  return cache;
}

export async function getBalanceBB(
  userId: string,
): Promise<Record<string, unknown>> {
  const cache = await getBalanceCache(userId);

  if (cache.balance) {
    return cache.balance.data;
  }

  const defaultBalance: Record<string, unknown> = {
    user: userId,
    tokenCredits: 0,
    autoRefillEnabled: false,
    refillIntervalValue: 0,
    refillIntervalUnit: 'days',
    refillAmount: 0,
  };

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const content = JSON.stringify(defaultBalance);
  const result = await bb.addMemory(aid, content, {
    type: BALANCE_TYPE,
    user: userId,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.balance = { bbId, data: defaultBalance };
  return defaultBalance;
}

export async function updateBalanceBB(
  userId: string,
  tokenCredits: number,
): Promise<Record<string, unknown>> {
  const cache = await getBalanceCache(userId);
  const bb = getClient();
  const aid = await getUserAssistantId(userId);

  if (cache.balance) {
    await bb.deleteMemory(aid, cache.balance.bbId);
  }

  const existing = cache.balance?.data ?? { user: userId };
  const updated: Record<string, unknown> = {
    ...existing,
    tokenCredits: Math.max(0, tokenCredits),
    user: userId,
  };

  const content = JSON.stringify(updated);
  const result = await bb.addMemory(aid, content, {
    type: BALANCE_TYPE,
    user: userId,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.balance = { bbId, data: updated };
  return updated;
}

export async function getTransactionsBB(
  userId: string,
  query?: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const cache = await getBalanceCache(userId);
  let results = Array.from(cache.transactions.values()).map((e) => e.data);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (key === 'user') {
        continue;
      }
      results = results.filter((r) => r[key] === value);
    }
  }

  results.sort((a, b) => {
    const ta = new Date((a.createdAt ?? '') as string).getTime();
    const tb = new Date((b.createdAt ?? '') as string).getTime();
    return tb - ta;
  });

  return results;
}

export async function createTransactionBB(
  txData: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const userId = (txData.user ?? '') as string;
  if (!userId) {
    return undefined;
  }

  const rawAmount = txData.rawAmount as number | undefined;
  if (rawAmount != null && isNaN(rawAmount)) {
    return undefined;
  }

  const txId = nanoid();
  const now = new Date().toISOString();
  const entry: Record<string, unknown> = {
    ...txData,
    _id: txId,
    user: userId,
    createdAt: now,
    updatedAt: now,
  };

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const cache = await getBalanceCache(userId);

  const content = JSON.stringify(entry);
  const result = await bb.addMemory(aid, content, {
    type: TRANSACTION_TYPE,
    transactionId: txId,
    user: userId,
    tokenType: (txData.tokenType ?? '') as string,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.transactions.set(txId, { bbId, data: entry });

  const tokenValue = (entry.tokenValue ?? rawAmount ?? 0) as number;
  if (cache.balance) {
    const currentCredits = (cache.balance.data.tokenCredits ?? 0) as number;
    await updateBalanceBB(userId, currentCredits + tokenValue);
  }

  return {
    ...entry,
    balance: (cache.balance?.data.tokenCredits ?? 0) as number,
  };
}

export async function createAutoRefillTransactionBB(
  userId: string,
  amount: number,
): Promise<Record<string, unknown> | undefined> {
  if (isNaN(amount)) {
    return undefined;
  }

  const txId = nanoid();
  const now = new Date().toISOString();
  const entry: Record<string, unknown> = {
    _id: txId,
    user: userId,
    tokenType: 'credits',
    context: 'auto_refill',
    rawAmount: amount,
    tokenValue: amount,
    createdAt: now,
    updatedAt: now,
  };

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const cache = await getBalanceCache(userId);

  const content = JSON.stringify(entry);
  const result = await bb.addMemory(aid, content, {
    type: TRANSACTION_TYPE,
    transactionId: txId,
    user: userId,
    tokenType: 'credits',
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.transactions.set(txId, { bbId, data: entry });

  const currentCredits = (cache.balance?.data.tokenCredits ?? 0) as number;
  const balanceResult = await updateBalanceBB(userId, currentCredits + amount);

  if (cache.balance) {
    cache.balance.data.lastRefill = now;
    await updateBalanceBB(userId, (balanceResult.tokenCredits ?? 0) as number);
  }

  const finalBalance = (cache.balance?.data.tokenCredits ?? 0) as number;
  logger.debug('[BalanceBB] Auto-refill performed', { userId, amount, balance: finalBalance });

  return {
    rate: 1,
    user: userId,
    balance: finalBalance,
    transaction: entry,
  };
}

export async function createStructuredTransactionBB(
  txData: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const userId = (txData.user ?? '') as string;
  if (!userId) {
    return undefined;
  }

  const txId = nanoid();
  const now = new Date().toISOString();
  const entry: Record<string, unknown> = {
    ...txData,
    _id: txId,
    user: userId,
    createdAt: now,
    updatedAt: now,
  };

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const cache = await getBalanceCache(userId);

  const content = JSON.stringify(entry);
  const result = await bb.addMemory(aid, content, {
    type: TRANSACTION_TYPE,
    transactionId: txId,
    user: userId,
    tokenType: (txData.tokenType ?? '') as string,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  cache.transactions.set(txId, { bbId, data: entry });

  const tokenValue = (entry.tokenValue ?? 0) as number;
  if (cache.balance) {
    const currentCredits = (cache.balance.data.tokenCredits ?? 0) as number;
    await updateBalanceBB(userId, currentCredits + tokenValue);
  }

  return {
    rate: (entry.rate ?? 0) as number,
    user: userId,
    balance: (cache.balance?.data.tokenCredits ?? 0) as number,
  };
}
