import { logger } from '@librechat/data-schemas';
import { getUserAssistantId } from './userStore';
import { backboardStorage } from './storage';

const SUBSCRIPTION_TYPE = 'librechat_subscription';

const PLUS_INCLUDED_TOKENS = parseInt(process.env.PLUS_INCLUDED_TOKENS ?? '500000', 10);
const UNLIMITED_MULTIPLIER = 6;

export type PlanTier = 'free' | 'plus' | 'unlimited';

export interface SubscriptionData {
  user: string;
  plan: PlanTier;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  periodStart?: string;
  periodEnd?: string;
  usageTokens: number;
  includedTokens: number;
}

interface CachedEntry {
  bbId: string;
  data: SubscriptionData;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const subscriptionCache = new Map<string, CachedEntry>();

function getClient() {
  return backboardStorage.getClient();
}

export function getIncludedTokens(plan: PlanTier): number {
  switch (plan) {
    case 'plus':
      return PLUS_INCLUDED_TOKENS;
    case 'unlimited':
      return PLUS_INCLUDED_TOKENS * UNLIMITED_MULTIPLIER;
    default:
      return 0;
  }
}

const PLAN_ORDER: Record<PlanTier, number> = { free: 0, plus: 1, unlimited: 2 };

export function planMeetsMinimum(userPlan: PlanTier, requiredPlan: PlanTier): boolean {
  return PLAN_ORDER[userPlan] >= PLAN_ORDER[requiredPlan];
}

export const FREE_TIER_PROVIDERS = ['meta', 'mistral', 'deepseek', 'qwen'];

/**
 * Check if a model ID belongs to a free-tier provider.
 * Handles multi-segment paths like "openrouter/deepseek/deepseek-r1"
 * by checking if ANY path segment starts with a free-tier provider name.
 */
export function isFreeTierModel(modelId: string): boolean {
  const segments = modelId.toLowerCase().split('/');
  return FREE_TIER_PROVIDERS.some((p) =>
    segments.some((seg) => seg === p || seg.startsWith(`${p}-`) || seg.startsWith(p)),
  );
}

export async function getSubscriptionBB(userId: string): Promise<SubscriptionData> {
  const cached = subscriptionCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.type !== SUBSCRIPTION_TYPE) {
      continue;
    }
    try {
      const data = JSON.parse(m.content) as SubscriptionData;

      if (data.periodEnd && data.plan !== 'free' && new Date(data.periodEnd).getTime() < Date.now()) {
        logger.info(`[SubscriptionBB] Billing period expired for ${userId}, resetting usage`);
        const now = new Date();
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const resetData: SubscriptionData = {
          ...data,
          usageTokens: 0,
          periodStart: now.toISOString(),
          periodEnd: nextMonth.toISOString(),
        };
        subscriptionCache.set(userId, { bbId: m.id, data: resetData, expiresAt: Date.now() + CACHE_TTL_MS });
        updateSubscriptionBB(userId, {
          usageTokens: 0,
          periodStart: resetData.periodStart,
          periodEnd: resetData.periodEnd,
        }).catch((err) => logger.warn(`[SubscriptionBB] Failed to persist usage reset for ${userId}`, err));
        return resetData;
      }

      subscriptionCache.set(userId, { bbId: m.id, data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    } catch { /* skip malformed */ }
  }

  const defaultSub: SubscriptionData = {
    user: userId,
    plan: 'free',
    usageTokens: 0,
    includedTokens: 0,
  };

  const content = JSON.stringify(defaultSub);
  const result = await bb.addMemory(aid, content, {
    type: SUBSCRIPTION_TYPE,
    user: userId,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  subscriptionCache.set(userId, { bbId, data: defaultSub, expiresAt: Date.now() + CACHE_TTL_MS });
  return defaultSub;
}

export async function updateSubscriptionBB(
  userId: string,
  updates: Partial<Omit<SubscriptionData, 'user'>>,
): Promise<SubscriptionData> {
  const current = await getSubscriptionBB(userId);
  const bb = getClient();
  const aid = await getUserAssistantId(userId);

  const cached = subscriptionCache.get(userId);
  if (cached?.bbId) {
    try {
      await bb.deleteMemory(aid, cached.bbId);
    } catch {
      logger.warn(`[SubscriptionBB] Failed to delete old subscription memory for ${userId}`);
    }
  }

  const updated: SubscriptionData = {
    ...current,
    ...updates,
    user: userId,
  };

  if (updates.plan && updates.plan !== current.plan) {
    updated.includedTokens = getIncludedTokens(updates.plan);
  }

  const content = JSON.stringify(updated);
  const result = await bb.addMemory(aid, content, {
    type: SUBSCRIPTION_TYPE,
    user: userId,
  });

  const bbId = (result.memory_id ?? result.id ?? '') as string;
  subscriptionCache.set(userId, { bbId, data: updated, expiresAt: Date.now() + CACHE_TTL_MS });
  logger.info(`[SubscriptionBB] Updated subscription for ${userId}`, { plan: updated.plan });
  return updated;
}

export async function recordUsageBB(
  userId: string,
  tokens: number,
): Promise<SubscriptionData> {
  const current = await getSubscriptionBB(userId);
  return updateSubscriptionBB(userId, {
    usageTokens: current.usageTokens + Math.max(0, tokens),
  });
}

export async function resetPeriodUsageBB(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<SubscriptionData> {
  return updateSubscriptionBB(userId, {
    usageTokens: 0,
    periodStart,
    periodEnd,
  });
}

export function invalidateSubscriptionCache(userId: string): void {
  subscriptionCache.delete(userId);
}
