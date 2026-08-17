import { logger } from '@librechat/data-schemas';

export interface PromptMigrationCheckResult {
  totalToMigrate: number;
  globalViewAccess: number;
  privateGroups: number;
  details?: {
    globalViewAccess: Array<{ name: string; _id: string; category: string }>;
    privateGroups: Array<{ name: string; _id: string; category: string }>;
  };
}

export async function checkPromptPermissionsMigration(): Promise<PromptMigrationCheckResult> {
  logger.debug('Migration not needed with Backboard storage');
  return {
    totalToMigrate: 0,
    globalViewAccess: 0,
    privateGroups: 0,
  };
}

export function logPromptMigrationWarning(result: PromptMigrationCheckResult): void {
  if (result.totalToMigrate === 0) {
    return;
  }
  logger.warn('Prompt permissions migration required', {
    totalToMigrate: result.totalToMigrate,
    globalViewAccess: result.globalViewAccess,
    privateGroups: result.privateGroups,
  });
}
