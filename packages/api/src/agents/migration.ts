import { logger } from '@librechat/data-schemas';

export interface MigrationCheckResult {
  totalToMigrate: number;
  globalEditAccess: number;
  globalViewAccess: number;
  privateAgents: number;
  details?: {
    globalEditAccess: Array<{ name: string; id: string }>;
    globalViewAccess: Array<{ name: string; id: string }>;
    privateAgents: Array<{ name: string; id: string }>;
  };
}

export async function checkAgentPermissionsMigration(): Promise<MigrationCheckResult> {
  logger.debug('Migration not needed with Backboard storage');
  return {
    totalToMigrate: 0,
    globalEditAccess: 0,
    globalViewAccess: 0,
    privateAgents: 0,
  };
}

export function logAgentMigrationWarning(result: MigrationCheckResult): void {
  if (result.totalToMigrate === 0) {
    return;
  }
  logger.warn('Agent permissions migration required', {
    totalToMigrate: result.totalToMigrate,
    globalEditAccess: result.globalEditAccess,
    globalViewAccess: result.globalViewAccess,
    privateAgents: result.privateAgents,
  });
}
