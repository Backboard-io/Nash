import { logger } from '@librechat/data-schemas';
import { AccessRoleIds, PrincipalType, ResourceType } from 'librechat-data-provider';
import {
  grantPermissionBB,
  hasPermissionBB,
  getUserPrincipalsBB,
  findAccessibleResourcesBB,
  findEntriesByResourceBB,
  getEffectivePermissionsForResourcesBB,
  findAccessRoleByIdentifierBB,
} from '~/backboard/rbacBB';

const isValidId = (id: string | unknown): boolean =>
  typeof id === 'string' && id.length > 0;

export class AccessControlService {
  constructor(_mongoose?: unknown) {
    /* mongoose parameter kept for API compatibility but is no longer used */
  }

  public async grantPermission(args: {
    principalType: PrincipalType;
    principalId: string | null;
    resourceType: string;
    resourceId: string;
    accessRoleId: AccessRoleIds;
    grantedBy: string;
    session?: unknown;
    roleId?: string;
  }): Promise<Record<string, unknown> | null> {
    const { principalType, principalId, resourceType, resourceId, accessRoleId, grantedBy } = args;
    try {
      if (!Object.values(PrincipalType).includes(principalType)) {
        throw new Error(`Invalid principal type: ${principalType}`);
      }
      if (principalType !== PrincipalType.PUBLIC && !principalId) {
        throw new Error('Principal ID is required for user, group, and role principals');
      }
      if (principalId && principalType === PrincipalType.ROLE) {
        if (typeof principalId !== 'string' || principalId.trim().length === 0) {
          throw new Error(`Invalid role ID: ${principalId}`);
        }
      } else if (principalType !== PrincipalType.PUBLIC && (!principalId || !isValidId(principalId))) {
        throw new Error(`Invalid principal ID: ${principalId}`);
      }
      if (!resourceId || !isValidId(resourceId)) {
        throw new Error(`Invalid resource ID: ${resourceId}`);
      }
      this.validateResourceType(resourceType as ResourceType);

      const role = await findAccessRoleByIdentifierBB(accessRoleId);
      if (!role) {
        throw new Error(`Role ${accessRoleId} not found`);
      }
      if (role.resourceType !== resourceType) {
        throw new Error(`Role ${accessRoleId} is for ${role.resourceType} resources, not ${resourceType}`);
      }

      return await grantPermissionBB(
        principalType,
        principalId,
        resourceType,
        resourceId,
        role.permBits as number,
        grantedBy,
        undefined,
        (role.id ?? role._id) as string,
      );
    } catch (error) {
      logger.error(
        `[PermissionService.grantPermission] Error: ${error instanceof Error ? error.message : ''}`,
        error,
      );
      throw error;
    }
  }

  public async findAccessibleResources({
    userId,
    role,
    resourceType,
    requiredPermissions,
  }: {
    userId: string;
    role?: string;
    resourceType: string;
    requiredPermissions: number;
  }): Promise<string[]> {
    try {
      if (typeof requiredPermissions !== 'number' || requiredPermissions < 1) {
        throw new Error('requiredPermissions must be a positive number');
      }
      this.validateResourceType(resourceType as ResourceType);
      const principalsList = await getUserPrincipalsBB({ userId });
      if (principalsList.length === 0) {
        return [];
      }
      return (await findAccessibleResourcesBB(
        principalsList,
        resourceType,
        requiredPermissions,
      )) as string[];
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`[PermissionService.findAccessibleResources] Error: ${error.message}`);
        if (error.message.includes('requiredPermissions must be')) {
          throw error;
        }
      }
      return [];
    }
  }

  public async findPubliclyAccessibleResources({
    resourceType,
    requiredPermissions,
  }: {
    resourceType: ResourceType;
    requiredPermissions: number;
  }): Promise<string[]> {
    try {
      if (typeof requiredPermissions !== 'number' || requiredPermissions < 1) {
        throw new Error('requiredPermissions must be a positive number');
      }
      this.validateResourceType(resourceType);
      const entries = await findEntriesByResourceBB(resourceType, '__public__');
      return (entries as Array<{ resourceId: string; permBits: number }>)
        .filter((e) => (e.permBits & requiredPermissions) === requiredPermissions)
        .map((e) => e.resourceId);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`[PermissionService.findPubliclyAccessibleResources] Error: ${error.message}`);
        if (error.message.includes('requiredPermissions must be')) {
          throw error;
        }
      }
      return [];
    }
  }

  public async getResourcePermissionsMap({
    userId,
    role,
    resourceType,
    resourceIds,
  }: {
    userId: string;
    role: string;
    resourceType: ResourceType;
    resourceIds: string[];
  }): Promise<Map<string, number>> {
    this.validateResourceType(resourceType);
    if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
      return new Map();
    }
    try {
      const principals = await getUserPrincipalsBB({ userId });
      const permissionsMap = (await getEffectivePermissionsForResourcesBB(
        principals,
        resourceType,
        resourceIds,
      )) as Map<string, number>;
      logger.debug(
        `[PermissionService.getResourcePermissionsMap] Computed permissions for ${resourceIds.length} resources, ${permissionsMap.size} have permissions`,
      );
      return permissionsMap;
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`[PermissionService.getResourcePermissionsMap] Error: ${error.message}`, error);
      }
      throw error;
    }
  }

  public async removeAllPermissions({
    resourceType,
    resourceId,
  }: {
    resourceType: ResourceType;
    resourceId: string;
  }): Promise<{ deletedCount: number }> {
    try {
      this.validateResourceType(resourceType);
      if (!resourceId || !isValidId(resourceId)) {
        throw new Error(`Invalid resource ID: ${resourceId}`);
      }
      const entries = await findEntriesByResourceBB(resourceType, resourceId);
      const arr = entries as Array<{ id: string }>;
      return { deletedCount: arr.length };
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`[PermissionService.removeAllPermissions] Error: ${error.message}`);
      }
      throw error;
    }
  }

  public async checkPermission({
    userId,
    role,
    resourceType,
    resourceId,
    requiredPermission,
  }: {
    userId: string;
    role?: string;
    resourceType: ResourceType;
    resourceId: string;
    requiredPermission: number;
  }): Promise<boolean> {
    try {
      if (typeof requiredPermission !== 'number' || requiredPermission < 1) {
        throw new Error('requiredPermission must be a positive number');
      }
      this.validateResourceType(resourceType);
      const principals = await getUserPrincipalsBB({ userId });
      if (principals.length === 0) {
        return false;
      }
      return (await hasPermissionBB(
        principals,
        resourceType,
        resourceId,
        requiredPermission,
      )) as boolean;
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`[PermissionService.checkPermission] Error: ${error.message}`);
        if (error.message.includes('requiredPermission must be')) {
          throw error;
        }
      }
      return false;
    }
  }

  private validateResourceType(resourceType: ResourceType): void {
    const validTypes = Object.values(ResourceType);
    if (!validTypes.includes(resourceType)) {
      throw new Error(`Invalid resourceType: ${resourceType}. Valid types: ${validTypes.join(', ')}`);
    }
  }
}
