import {
  ResourceType,
  AccessRoleIds,
  PrincipalType,
  PermissionBits,
} from 'librechat-data-provider';
import { logger, encryptV2, decryptV2 } from '@librechat/data-schemas';
import type { MCPServerDocument } from '@librechat/data-schemas';
import type { IServerConfigsRepositoryInterface } from '~/mcp/registry/ServerConfigsRepositoryInterface';
import type { ParsedServerConfig, AddServerResult } from '~/mcp/types';
import { AccessControlService } from '~/acl/accessControlService';
import {
  createMCPServerBB,
  findMCPServerByServerNameBB,
  updateMCPServerBB,
  deleteMCPServerBB,
  getListMCPServersByIdsBB,
  getListMCPServersByNamesBB,
} from '~/backboard/miscBB';
import {
  getAgentsBB,
} from '~/backboard/agentsBB';

const DANGEROUS_CREDENTIAL_PATTERNS = [
  /\{\{LIBRECHAT_OPENID_[^}]+\}\}/g,
  /\{\{LIBRECHAT_USER_[^}]+\}\}/g,
];

function sanitizeCredentialPlaceholders(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) {
    return headers;
  }
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    let sanitizedValue = value;
    for (const pattern of DANGEROUS_CREDENTIAL_PATTERNS) {
      sanitizedValue = sanitizedValue.replace(pattern, '');
    }
    sanitized[key] = sanitizedValue;
  }
  return sanitized;
}

export class ServerConfigsDB implements IServerConfigsRepositoryInterface {
  private _aclService: AccessControlService;

  constructor(_mongoose?: unknown) {
    this._aclService = new AccessControlService();
  }

  private async hasAccessViaAgent(serverName: string, userId?: string): Promise<boolean> {
    let accessibleAgentIds: string[];

    if (!userId) {
      accessibleAgentIds = await this._aclService.findPubliclyAccessibleResources({
        resourceType: ResourceType.AGENT,
        requiredPermissions: PermissionBits.VIEW,
      });
    } else {
      accessibleAgentIds = await this._aclService.findAccessibleResources({
        userId,
        requiredPermissions: PermissionBits.VIEW,
        resourceType: ResourceType.AGENT,
      });
    }

    if (accessibleAgentIds.length === 0) {
      return false;
    }

    const agents = await getAgentsBB({ _id: { $in: accessibleAgentIds } });
    return (agents as Array<{ mcpServerNames?: string[] }>).some(
      (a) => a.mcpServerNames?.includes(serverName),
    );
  }

  public async add(
    serverName: string,
    config: ParsedServerConfig,
    userId?: string,
  ): Promise<AddServerResult> {
    logger.debug(
      `[ServerConfigsDB.add] Creating server with temp servername: ${serverName} for user ${userId}`,
    );
    if (!userId) {
      throw new Error('[ServerConfigsDB.add] User ID is required to create a database-stored MCP server.');
    }

    const sanitizedConfig = {
      ...config,
      headers: sanitizeCredentialPlaceholders(
        (config as ParsedServerConfig & { headers?: Record<string, string> }).headers,
      ),
    } as ParsedServerConfig;

    const transformedConfig = this.transformUserApiKeyConfig(sanitizedConfig);
    const encryptedConfig = await this.encryptConfig(transformedConfig);
    const createdServer = await createMCPServerBB({
      config: encryptedConfig,
      author: userId,
    }) as unknown as MCPServerDocument;

    await this._aclService.grantPermission({
      principalType: PrincipalType.USER,
      principalId: userId,
      resourceType: ResourceType.MCPSERVER,
      resourceId: String(createdServer._id),
      accessRoleId: AccessRoleIds.MCPSERVER_OWNER,
      grantedBy: userId,
    });

    return {
      serverName: createdServer.serverName,
      config: await this.mapDBServerToParsedConfig(createdServer),
    };
  }

  public async update(
    serverName: string,
    config: ParsedServerConfig,
    userId?: string,
  ): Promise<void> {
    if (!userId) {
      throw new Error('[ServerConfigsDB.update] User ID is required to update a database-stored MCP server.');
    }

    const existingServer = await findMCPServerByServerNameBB(serverName) as unknown as MCPServerDocument | null;

    let configToSave: ParsedServerConfig = {
      ...config,
      headers: sanitizeCredentialPlaceholders(
        (config as ParsedServerConfig & { headers?: Record<string, string> }).headers,
      ),
    } as ParsedServerConfig;

    configToSave = this.transformUserApiKeyConfig(configToSave);
    configToSave = await this.encryptConfig(configToSave);

    if (!config.oauth?.client_secret && existingServer?.config?.oauth?.client_secret) {
      configToSave = {
        ...configToSave,
        oauth: { ...configToSave.oauth, client_secret: existingServer.config.oauth.client_secret },
      };
    }

    if (
      config.apiKey?.source === 'admin' &&
      !config.apiKey?.key &&
      existingServer?.config?.apiKey?.source === 'admin' &&
      existingServer?.config?.apiKey?.key
    ) {
      configToSave = {
        ...configToSave,
        apiKey: {
          source: configToSave.apiKey!.source,
          authorization_type: configToSave.apiKey!.authorization_type,
          custom_header: configToSave.apiKey?.custom_header,
          key: existingServer.config.apiKey.key,
        },
      };
    }

    await updateMCPServerBB(serverName, { config: configToSave });
  }

  public async remove(serverName: string, userId?: string): Promise<void> {
    logger.debug(`[ServerConfigsDB.remove] removing ${serverName}. UserId: ${userId}`);
    const deletedServer = await deleteMCPServerBB(serverName) as unknown as MCPServerDocument | null;
    if (deletedServer?._id) {
      logger.debug(`[ServerConfigsDB.remove] removing all permissions entries of ${serverName}.`);
      await this._aclService.removeAllPermissions({
        resourceType: ResourceType.MCPSERVER,
        resourceId: String(deletedServer._id),
      });
      return;
    }
    logger.warn(`[ServerConfigsDB.remove] server with serverName ${serverName} does not exist`);
  }

  public async get(serverName: string, userId?: string): Promise<ParsedServerConfig | undefined> {
    const server = await findMCPServerByServerNameBB(serverName) as unknown as MCPServerDocument | null;
    if (!server) {
      return undefined;
    }

    if (!userId) {
      const directlyAccessibleMCPIds = await this._aclService.findPubliclyAccessibleResources({
        resourceType: ResourceType.MCPSERVER,
        requiredPermissions: PermissionBits.VIEW,
      });
      if (directlyAccessibleMCPIds.includes(String(server._id))) {
        return await this.mapDBServerToParsedConfig(server);
      }
      const hasAgentAccess = await this.hasAccessViaAgent(serverName);
      if (hasAgentAccess) {
        return { ...(await this.mapDBServerToParsedConfig(server)), consumeOnly: true };
      }
      return undefined;
    }

    const userHasDirectAccess = await this._aclService.checkPermission({
      userId,
      resourceType: ResourceType.MCPSERVER,
      requiredPermission: PermissionBits.VIEW,
      resourceId: String(server._id),
    });

    if (userHasDirectAccess) {
      return await this.mapDBServerToParsedConfig(server);
    }

    const hasAgentAccess = await this.hasAccessViaAgent(serverName, userId);
    if (hasAgentAccess) {
      return { ...(await this.mapDBServerToParsedConfig(server)), consumeOnly: true };
    }

    return undefined;
  }

  public async getAll(userId?: string): Promise<Record<string, ParsedServerConfig>> {
    let directlyAccessibleMCPIds: string[] = [];
    if (!userId) {
      directlyAccessibleMCPIds = await this._aclService.findPubliclyAccessibleResources({
        resourceType: ResourceType.MCPSERVER,
        requiredPermissions: PermissionBits.VIEW,
      });
    } else {
      directlyAccessibleMCPIds = await this._aclService.findAccessibleResources({
        userId,
        requiredPermissions: PermissionBits.VIEW,
        resourceType: ResourceType.MCPSERVER,
      });
    }

    let agentMCPServerNames: string[] = [];
    let accessibleAgentIds: string[] = [];

    if (!userId) {
      accessibleAgentIds = await this._aclService.findPubliclyAccessibleResources({
        resourceType: ResourceType.AGENT,
        requiredPermissions: PermissionBits.VIEW,
      });
    } else {
      accessibleAgentIds = await this._aclService.findAccessibleResources({
        userId,
        requiredPermissions: PermissionBits.VIEW,
        resourceType: ResourceType.AGENT,
      });
    }

    if (accessibleAgentIds.length > 0) {
      const agents = await getAgentsBB({ _id: { $in: accessibleAgentIds } });
      agentMCPServerNames = [
        ...new Set(
          (agents as Array<{ mcpServerNames?: string[] }>).flatMap((a) => a.mcpServerNames || []),
        ),
      ];
    }

    const directResults = await getListMCPServersByIdsBB(directlyAccessibleMCPIds) as unknown as {
      data: MCPServerDocument[];
    };

    const parsedConfigs: Record<string, ParsedServerConfig> = {};
    const directData = directResults.data || [];
    const directServerNames = new Set(directData.map((s) => s.serverName));

    const directParsed = await Promise.all(directData.map((s) => this.mapDBServerToParsedConfig(s)));
    directData.forEach((s, i) => {
      parsedConfigs[s.serverName] = directParsed[i];
    });

    const agentOnlyServerNames = agentMCPServerNames.filter((name) => !directServerNames.has(name));

    if (agentOnlyServerNames.length > 0) {
      const agentServers = await getListMCPServersByNamesBB(agentOnlyServerNames) as unknown as {
        data: MCPServerDocument[];
      };
      const agentData = agentServers.data || [];
      const agentParsed = await Promise.all(agentData.map((s) => this.mapDBServerToParsedConfig(s)));
      agentData.forEach((s, i) => {
        parsedConfigs[s.serverName] = { ...agentParsed[i], consumeOnly: true };
      });
    }

    return parsedConfigs;
  }

  public async reset(): Promise<void> {
    logger.warn('Attempt to reset the DB config storage');
  }

  private async mapDBServerToParsedConfig(serverDBDoc: MCPServerDocument): Promise<ParsedServerConfig> {
    const config: ParsedServerConfig = {
      ...serverDBDoc.config,
      dbId: String(serverDBDoc._id),
      updatedAt: serverDBDoc.updatedAt?.getTime(),
    };
    return await this.decryptConfig(config);
  }

  private transformUserApiKeyConfig(config: ParsedServerConfig): ParsedServerConfig {
    if (!config.apiKey || config.apiKey.source !== 'user') {
      return config;
    }

    const result = { ...config };
    const headerName =
      result.apiKey!.authorization_type === 'custom'
        ? result.apiKey!.custom_header || 'X-Api-Key'
        : 'Authorization';

    let headerValue: string;
    if (result.apiKey!.authorization_type === 'basic') {
      headerValue = 'Basic {{MCP_API_KEY}}';
    } else if (result.apiKey!.authorization_type === 'bearer') {
      headerValue = 'Bearer {{MCP_API_KEY}}';
    } else {
      headerValue = '{{MCP_API_KEY}}';
    }

    result.customUserVars = {
      ...result.customUserVars,
      MCP_API_KEY: { title: 'API Key', description: 'Your API key for this MCP server' },
    };

    const resultWithHeaders = result as ParsedServerConfig & { headers?: Record<string, string> };
    resultWithHeaders.headers = { ...resultWithHeaders.headers, [headerName]: headerValue };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { key: _removed, ...apiKeyWithoutKey } = result.apiKey!;
    result.apiKey = apiKeyWithoutKey;

    return result;
  }

  private async encryptConfig(config: ParsedServerConfig): Promise<ParsedServerConfig> {
    let result = { ...config };

    if (result.apiKey?.source === 'admin' && result.apiKey.key) {
      try {
        result.apiKey = { ...result.apiKey, key: await encryptV2(result.apiKey.key) };
      } catch (error) {
        logger.error('[ServerConfigsDB.encryptConfig] Failed to encrypt apiKey.key', error);
        throw new Error('Failed to encrypt MCP server configuration');
      }
    }

    if (result.oauth?.client_secret) {
      try {
        result = {
          ...result,
          oauth: { ...result.oauth, client_secret: await encryptV2(result.oauth.client_secret) },
        };
      } catch (error) {
        logger.error('[ServerConfigsDB.encryptConfig] Failed to encrypt client_secret', error);
        throw new Error('Failed to encrypt MCP server configuration');
      }
    }

    return result;
  }

  private async decryptConfig(config: ParsedServerConfig): Promise<ParsedServerConfig> {
    let result = { ...config };

    if (result.apiKey?.source === 'admin' && result.apiKey.key) {
      try {
        result.apiKey = { ...result.apiKey, key: await decryptV2(result.apiKey.key) };
      } catch (error) {
        logger.warn('[ServerConfigsDB.decryptConfig] Failed to decrypt apiKey.key', error);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { key: _removedKey, ...apiKeyWithoutKey } = result.apiKey;
        result.apiKey = apiKeyWithoutKey;
      }
    }

    if (result.oauth?.client_secret) {
      const oauthConfig = result.oauth as { client_secret: string } & typeof result.oauth;
      try {
        result = {
          ...result,
          oauth: { ...oauthConfig, client_secret: await decryptV2(oauthConfig.client_secret) },
        };
      } catch (error) {
        logger.warn('[ServerConfigsDB.decryptConfig] Failed to decrypt client_secret', error);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { client_secret: _removed, ...oauthWithoutSecret } = oauthConfig;
        result = { ...result, oauth: oauthWithoutSecret };
      }
    }

    return result;
  }
}
