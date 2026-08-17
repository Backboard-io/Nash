import { logger } from '@librechat/data-schemas';
import { getBalanceBB, updateBalanceBB } from '../backboard/balanceBB';
import type { NextFunction, Request as ServerRequest, Response as ServerResponse } from 'express';
import type { IUser, BalanceConfig, ObjectId, AppConfig } from '@librechat/data-schemas';
import type { BalanceUpdateFields } from '~/types';
import { getBalanceConfig } from '~/app/config';

export interface BalanceMiddlewareOptions {
  getAppConfig: (options?: { role?: string; refresh?: boolean }) => Promise<AppConfig>;
  Balance?: unknown;
}

function buildUpdateFields(
  config: BalanceConfig,
  userRecord: Record<string, unknown> | null,
  userId: string,
): BalanceUpdateFields {
  const updateFields: BalanceUpdateFields = {};

  if (!userRecord) {
    updateFields.user = userId;
    updateFields.tokenCredits = config.startBalance;
  }

  if (userRecord?.tokenCredits == null && config.startBalance != null) {
    updateFields.tokenCredits = config.startBalance;
  }

  const isAutoRefillConfigValid =
    config.autoRefillEnabled &&
    config.refillIntervalValue != null &&
    config.refillIntervalUnit != null &&
    config.refillAmount != null;

  if (!isAutoRefillConfigValid) {
    return updateFields;
  }

  if (userRecord?.autoRefillEnabled !== config.autoRefillEnabled) {
    updateFields.autoRefillEnabled = config.autoRefillEnabled;
  }

  if (userRecord?.refillIntervalValue !== config.refillIntervalValue) {
    updateFields.refillIntervalValue = config.refillIntervalValue;
  }

  if (userRecord?.refillIntervalUnit !== config.refillIntervalUnit) {
    updateFields.refillIntervalUnit = config.refillIntervalUnit;
  }

  if (userRecord?.refillAmount !== config.refillAmount) {
    updateFields.refillAmount = config.refillAmount;
  }

  if (config.autoRefillEnabled && !userRecord?.lastRefill) {
    updateFields.lastRefill = new Date();
  }

  return updateFields;
}

export function createSetBalanceConfig({
  getAppConfig,
}: BalanceMiddlewareOptions): (
  req: ServerRequest,
  res: ServerResponse,
  next: NextFunction,
) => Promise<void> {
  return async (req: ServerRequest, res: ServerResponse, next: NextFunction): Promise<void> => {
    try {
      const user = req.user as IUser & { _id: string | ObjectId };
      const appConfig = await getAppConfig({ role: user?.role });
      const balanceConfig = getBalanceConfig(appConfig);
      if (!balanceConfig?.enabled) {
        return next();
      }
      if (balanceConfig.startBalance == null) {
        return next();
      }

      if (!user || !user._id) {
        return next();
      }
      const userId = typeof user._id === 'string' ? user._id : user._id.toString();
      const userBalanceRecord = await getBalanceBB(userId);
      const updateFields = buildUpdateFields(balanceConfig, userBalanceRecord, userId);

      if (Object.keys(updateFields).length === 0) {
        return next();
      }

      const newCredits = (updateFields.tokenCredits ?? userBalanceRecord?.tokenCredits ?? 0) as number;
      await updateBalanceBB(userId, newCredits);

      next();
    } catch (error) {
      logger.error('Error setting user balance:', error);
      next(error);
    }
  };
}
