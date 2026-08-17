import { ResourceType, PermissionBits, hasPermissions } from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import {
  validateAgentApiKeyBB,
  createAgentApiKeyBB,
  listAgentApiKeysBB,
  deleteAgentApiKeyBB,
  getAgentApiKeyByIdBB,
} from '../backboard/agentApiKeysBB';
import { findUserBB } from '../backboard/auth/usersBB';

export interface ApiKeyServiceDependencies {
  validateAgentApiKey: typeof validateAgentApiKeyBB;
  createAgentApiKey: typeof createAgentApiKeyBB;
  listAgentApiKeys: typeof listAgentApiKeysBB;
  deleteAgentApiKey: typeof deleteAgentApiKeyBB;
  getAgentApiKeyById: typeof getAgentApiKeyByIdBB;
  findUser: (query: { _id: string }) => Promise<IUser | null>;
}

export interface RemoteAgentAccessResult {
  hasAccess: boolean;
  permissions: number;
  agent: { _id: string; [key: string]: unknown } | null;
}

export class AgentApiKeyService {
  private deps: ApiKeyServiceDependencies;

  constructor(deps: ApiKeyServiceDependencies) {
    this.deps = deps;
  }

  async validateApiKey(apiKey: string): Promise<{
    userId: string;
    keyId: string;
  } | null> {
    return this.deps.validateAgentApiKey(apiKey);
  }

  async createApiKey(params: {
    userId: string;
    name: string;
    expiresAt?: Date | null;
  }) {
    return this.deps.createAgentApiKey(params);
  }

  async listApiKeys(userId: string) {
    return this.deps.listAgentApiKeys(userId);
  }

  async deleteApiKey(keyId: string, userId: string) {
    return this.deps.deleteAgentApiKey(userId, keyId);
  }

  async getApiKeyById(keyId: string, userId: string) {
    void userId;
    return this.deps.getAgentApiKeyById(keyId);
  }

  async getUserFromApiKey(apiKey: string): Promise<IUser | null> {
    const keyValidation = await this.validateApiKey(apiKey);
    if (!keyValidation) {
      return null;
    }

    return this.deps.findUser({ _id: keyValidation.userId });
  }
}

export function createApiKeyServiceDependencies(): ApiKeyServiceDependencies {
  return {
    validateAgentApiKey: validateAgentApiKeyBB,
    createAgentApiKey: createAgentApiKeyBB,
    listAgentApiKeys: listAgentApiKeysBB,
    deleteAgentApiKey: deleteAgentApiKeyBB,
    getAgentApiKeyById: getAgentApiKeyByIdBB,
    findUser: (query: { _id: string }) => findUserBB(query) as Promise<IUser | null>,
  };
}

export interface GetRemoteAgentPermissionsDeps {
  getEffectivePermissions: (params: {
    userId: string;
    role?: string;
    resourceType: ResourceType;
    resourceId: string;
  }) => Promise<number>;
}

/** AGENT owners automatically have full REMOTE_AGENT permissions */
export async function getRemoteAgentPermissions(
  deps: GetRemoteAgentPermissionsDeps,
  userId: string,
  role: string | undefined,
  resourceId: string,
): Promise<number> {
  const agentPerms = await deps.getEffectivePermissions({
    userId,
    role,
    resourceType: ResourceType.AGENT,
    resourceId,
  });

  if (hasPermissions(agentPerms, PermissionBits.SHARE)) {
    return PermissionBits.VIEW | PermissionBits.EDIT | PermissionBits.DELETE | PermissionBits.SHARE;
  }

  return deps.getEffectivePermissions({
    userId,
    role,
    resourceType: ResourceType.REMOTE_AGENT,
    resourceId,
  });
}

export async function checkRemoteAgentAccess(params: {
  userId: string;
  role?: string;
  agentId: string;
  getAgent: (query: {
    id: string;
  }) => Promise<{ _id: string; [key: string]: unknown } | null>;
  getEffectivePermissions: (params: {
    userId: string;
    role?: string;
    resourceType: ResourceType;
    resourceId: string;
  }) => Promise<number>;
}): Promise<RemoteAgentAccessResult> {
  const { userId, role, agentId, getAgent, getEffectivePermissions } = params;

  const agent = await getAgent({ id: agentId });

  if (!agent) {
    return { hasAccess: false, permissions: 0, agent: null };
  }

  const permissions = await getRemoteAgentPermissions(
    { getEffectivePermissions },
    userId,
    role,
    agent._id,
  );

  const hasAccess = hasPermissions(permissions, PermissionBits.VIEW);

  return { hasAccess, permissions, agent };
}
