import { logger } from '@librechat/data-schemas';
import {
  ResourceType,
  PrincipalType,
  PermissionBits,
  AccessRoleIds,
} from 'librechat-data-provider';
import {
  findEntriesByResourceBB,
  findAccessRoleByIdentifierBB,
  grantPermissionBB,
} from '../backboard/rbacBB';
import { findUserBB } from '../backboard/auth/usersBB';

export interface Principal {
  type: string;
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  source?: string;
  idOnTheSource?: string;
  accessRoleId: string;
  isImplicit?: boolean;
}

export interface EnrichResult {
  principals: Principal[];
  entriesToBackfill: string[];
}

/** Enriches REMOTE_AGENT principals with implicit AGENT owners */
export async function enrichRemoteAgentPrincipals(
  resourceId: string,
  principals: Principal[],
): Promise<EnrichResult> {
  const entries = await findEntriesByResourceBB(ResourceType.AGENT, resourceId);

  const agentOwnerEntries = entries.filter(
    (e) =>
      e.principalType === PrincipalType.USER &&
      ((e.permBits as number) & PermissionBits.SHARE) === PermissionBits.SHARE,
  );

  const enrichedPrincipals = [...principals];
  const entriesToBackfill: string[] = [];

  for (const entry of agentOwnerEntries) {
    const principalId = entry.principalId as string;
    const user = await findUserBB({ _id: principalId });
    if (!user) {
      continue;
    }

    const alreadyIncluded = enrichedPrincipals.some(
      (p) => p.type === PrincipalType.USER && p.id === principalId,
    );

    if (!alreadyIncluded) {
      enrichedPrincipals.unshift({
        type: PrincipalType.USER,
        id: principalId,
        name: (user.name ?? user.username ?? '') as string,
        email: user.email as string | undefined,
        avatar: user.avatar as string | undefined,
        source: 'local',
        idOnTheSource: principalId,
        accessRoleId: AccessRoleIds.REMOTE_AGENT_OWNER,
        isImplicit: true,
      });

      entriesToBackfill.push(principalId);
    }
  }

  return { principals: enrichedPrincipals, entriesToBackfill };
}

/** Backfills REMOTE_AGENT ACL entries for AGENT owners (fire-and-forget) */
export function backfillRemoteAgentPermissions(
  resourceId: string,
  entriesToBackfill: string[],
): void {
  if (entriesToBackfill.length === 0) {
    return;
  }

  findAccessRoleByIdentifierBB(AccessRoleIds.REMOTE_AGENT_OWNER)
    .then((role) => {
      if (!role) {
        logger.error('[backfillRemoteAgentPermissions] REMOTE_AGENT_OWNER role not found');
        return;
      }

      const promises = entriesToBackfill.map((principalId) =>
        grantPermissionBB(
          PrincipalType.USER,
          principalId,
          ResourceType.REMOTE_AGENT,
          resourceId,
          role.permBits as number,
          principalId,
          undefined,
          (role._id ?? role.id ?? '') as string,
        ),
      );

      return Promise.all(promises);
    })
    .catch((err) => {
      logger.error('[backfillRemoteAgentPermissions] Failed to backfill:', err);
    });
}
