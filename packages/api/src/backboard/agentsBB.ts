import { nanoid } from 'nanoid';
import { logger } from '@librechat/data-schemas';
import {
  isAgentsEndpoint,
  isEphemeralAgentId,
  encodeEphemeralAgentId,
} from 'librechat-data-provider';
import { getCustomEndpointConfig } from '../app/config';
import { backboardStorage } from './storage';

const AGENT_TYPE = 'librechat_agent';

const DEFAULT_MODEL = 'openai/gpt-4o';

function ensureModelString(
  agent: Record<string, unknown>,
  fallback: string = DEFAULT_MODEL,
): string {
  const model =
    (agent.model as string | null | undefined) ??
    ((agent.model_parameters as Record<string, unknown>)?.model as string | null | undefined);
  return typeof model === 'string' && model.trim().length > 0 ? model : fallback;
}

interface LoadAgentParams {
  req: Record<string, unknown>;
  spec?: string;
  agent_id: string;
  endpoint: string;
  model_parameters?: Record<string, unknown>;
}

function parseAgent(item: { id: string; content: string; metadata: Record<string, unknown> }): Record<string, unknown> {
  try {
    const agent = JSON.parse(item.content) as Record<string, unknown>;
    agent._bbId = item.id;
    agent._id = (agent.id as string) ?? (agent.agent_id as string) ?? item.id;
    return agent;
  } catch {
    const fallback: Record<string, unknown> = { _bbId: item.id, ...item.metadata };
    fallback._id = (fallback.id as string) ?? (fallback.agent_id as string) ?? item.id;
    return fallback;
  }
}

function matchesFilter(
  agent: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if (Array.isArray(op.$in)) {
        if (!(op.$in as unknown[]).includes(agent[key])) {
          return false;
        }
        continue;
      }
      if (op.$ne !== undefined) {
        if (agent[key] === op.$ne) {
          return false;
        }
        continue;
      }
    }
    if (agent[key] !== value) {
      return false;
    }
  }
  return true;
}

export async function getAgentBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const searchKey = (filter.agent_id as string) ?? (filter.id as string) ?? (filter._id as string);
  if (searchKey) {
    const found = await backboardStorage.findByMetadata(AGENT_TYPE, 'agent_id', searchKey);
    if (found) {
      return parseAgent(found);
    }
  }
  const items = await backboardStorage.listByType(AGENT_TYPE);
  for (const item of items) {
    const agent = parseAgent(item);
    if (matchesFilter(agent, filter)) {
      return agent;
    }
  }
  return null;
}

export async function getAgentsBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(AGENT_TYPE);
  return items
    .map(parseAgent)
    .filter((agent) => matchesFilter(agent, filter));
}

export async function loadAgentBB(
  params: LoadAgentParams,
): Promise<Record<string, unknown> | null> {
  const { req, spec, agent_id, endpoint, model_parameters: _m } = params;
  if (!agent_id) {
    return null;
  }

  if (isEphemeralAgentId(agent_id)) {
    return loadEphemeralAgent({ req, spec, endpoint, model_parameters: _m });
  }

  const agent = await getAgentBB({ id: agent_id });
  if (!agent) {
    return null;
  }
  const versions = agent.versions as unknown[] | undefined;
  agent.version = versions ? versions.length : 0;
  const model = ensureModelString(agent);
  agent.model = model;
  const mp = (agent.model_parameters as Record<string, unknown>) ?? {};
  if (!mp.model || typeof mp.model !== 'string') {
    mp.model = model;
    agent.model_parameters = mp;
  }
  return agent;
}

function loadEphemeralAgent({
  req,
  spec,
  endpoint,
  model_parameters: _m,
}: {
  req: Record<string, unknown>;
  spec?: string;
  endpoint: string;
  model_parameters?: Record<string, unknown>;
}): Record<string, unknown> {
  const { model, ...model_parameters } = _m ?? {};
  const config = req.config as Record<string, unknown> | undefined;
  const modelSpecs = (config?.modelSpecs as Record<string, unknown>)?.list as
    | Record<string, unknown>[]
    | undefined;

  let modelSpec: Record<string, unknown> | null = null;
  if (spec != null && spec !== '') {
    modelSpec = modelSpecs?.find((s) => s.name === spec) ?? null;
  }

  const body = req.body as Record<string, unknown> | undefined;
  const instructions = body?.promptPrefix as string | undefined;

  const appConfig = config;
  let endpointConfig: Record<string, unknown> | undefined;
  if (!isAgentsEndpoint(endpoint)) {
    try {
      endpointConfig = getCustomEndpointConfig({
        endpoint,
        appConfig: appConfig as never,
      }) as unknown as Record<string, unknown> | undefined;
    } catch {
      logger.debug('[loadEphemeralAgent] No custom endpoint config found');
    }
  }

  const sender =
    (model_parameters.modelLabel as string) ??
    (modelSpec?.label as string) ??
    (endpointConfig?.modelDisplayLabel as string) ??
    '';

  const resolvedModel = typeof model === 'string' && model.trim().length > 0 ? model : DEFAULT_MODEL;
  const ephemeralId = encodeEphemeralAgentId({
    endpoint,
    model: resolvedModel,
    sender,
  });

  const mpWithModel = { ...model_parameters, model: resolvedModel };
  return {
    id: ephemeralId,
    instructions,
    provider: endpoint,
    model_parameters: mpWithModel,
    model: resolvedModel,
    tools: [],
  };
}

export async function createAgentBB(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const agentId = (data.id as string) ?? `agent_${nanoid()}`;
  const timestamp = new Date().toISOString();
  const agentData: Record<string, unknown> = {
    ...data,
    id: agentId,
    agent_id: agentId,
    createdAt: timestamp,
    updatedAt: timestamp,
    category: (data.category as string) || 'general',
  };

  const content = JSON.stringify(agentData);
  const item = await backboardStorage.createItem(content, {
    type: AGENT_TYPE,
    agent_id: agentId,
    author: (data.author as string) ?? '',
  });

  agentData._bbId = item.id;
  agentData._id = agentId;
  return agentData;
}

export async function updateAgentBB(
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const existing = await getAgentBB(filter);
  if (!existing) {
    return null;
  }

  const bbId = existing._bbId as string;
  const { _bbId: _, ...agentData } = existing;
  const merged: Record<string, unknown> = { ...agentData, ...update, updatedAt: new Date().toISOString() };

  await backboardStorage.deleteItem(bbId);
  const content = JSON.stringify(merged);
  const newItem = await backboardStorage.createItem(content, {
    type: AGENT_TYPE,
    agent_id: (merged.id as string) ?? (merged.agent_id as string) ?? '',
    author: (merged.author as string) ?? '',
  });

  merged._bbId = newItem.id;
  return merged;
}

export async function deleteAgentBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const existing = await getAgentBB(filter);
  if (!existing) {
    return null;
  }
  await backboardStorage.deleteItem(existing._bbId as string);
  return existing;
}

export async function deleteUserAgentsBB(userId: string): Promise<void> {
  try {
    const items = await backboardStorage.listByType(AGENT_TYPE, userId);
    for (const item of items) {
      await backboardStorage.deleteItem(item.id);
    }
    const allItems = await backboardStorage.listByType(AGENT_TYPE);
    for (const item of allItems) {
      if (item.metadata.author === userId) {
        await backboardStorage.deleteItem(item.id);
      }
    }
  } catch (error) {
    logger.error('[deleteUserAgentsBB] Error:', error);
  }
}

export async function revertAgentVersionBB(
  _userId: string,
  _agentId: string,
  _versionIndex: number,
): Promise<null> {
  return null;
}

export async function updateAgentProjectsBB(params: {
  user: { id: string; role?: string };
  agentId: string;
  projectIds?: string[];
  removeProjectIds?: string[];
}): Promise<Record<string, unknown> | null> {
  const agent = await getAgentBB({ id: params.agentId });
  if (!agent) {
    return null;
  }

  const currentProjects = (agent.projectIds as string[]) ?? [];
  let updatedProjects = [...currentProjects];

  if (params.removeProjectIds) {
    const removeSet = new Set(params.removeProjectIds);
    updatedProjects = updatedProjects.filter((p) => !removeSet.has(p));
  }

  if (params.projectIds) {
    const existingSet = new Set(updatedProjects);
    for (const pid of params.projectIds) {
      if (!existingSet.has(pid)) {
        updatedProjects.push(pid);
      }
    }
  }

  return await updateAgentBB({ id: params.agentId }, { projectIds: updatedProjects });
}

export async function countPromotedAgentsBB(_userId?: string): Promise<number> {
  const items = await backboardStorage.listByType(AGENT_TYPE);
  return items.filter((item) => {
    try {
      const agent = JSON.parse(item.content) as Record<string, unknown>;
      return agent.is_promoted === true;
    } catch {
      return false;
    }
  }).length;
}

export async function addAgentResourceFileBB(
  agentId: string,
  toolResource: string,
  fileId: string,
): Promise<Record<string, unknown> | null> {
  const agent = await getAgentBB({ id: agentId });
  if (!agent) {
    throw new Error('Agent not found for adding resource file');
  }

  const toolResources = (agent.tool_resources as Record<string, Record<string, unknown>>) ?? {};
  const resource = toolResources[toolResource] ?? {};
  const fileIds = (resource.file_ids as string[]) ?? [];

  if (!fileIds.includes(fileId)) {
    fileIds.push(fileId);
  }
  resource.file_ids = fileIds;
  toolResources[toolResource] = resource;

  const tools = (agent.tools as string[]) ?? [];
  if (!tools.includes(toolResource)) {
    tools.push(toolResource);
  }

  return await updateAgentBB({ id: agentId }, { tool_resources: toolResources, tools });
}

export async function getListAgentsByAccessBB(params: {
  accessibleIds?: string[];
  otherParams?: Record<string, unknown>;
  limit?: number | null;
  after?: string | null;
}): Promise<{
  object: string;
  data: Record<string, unknown>[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
  after: string | null;
}> {
  const allItems = await backboardStorage.listByType(AGENT_TYPE);
  let agents = allItems.map(parseAgent);

  if (params.accessibleIds != null) {
    if (params.accessibleIds.length === 0) {
      agents = [];
    } else {
      const idSet = new Set(params.accessibleIds);
      agents = agents.filter((a) => {
        const aid = (a._id as string) ?? (a.id as string);
        return idSet.has(aid);
      });
    }
  }

  if (params.otherParams) {
    agents = agents.filter((a) => matchesFilter(a, params.otherParams ?? {}));
  }

  agents.sort((a, b) => {
    const dateA = (a.updatedAt as string) ?? '';
    const dateB = (b.updatedAt as string) ?? '';
    return dateB.localeCompare(dateA);
  });

  const isPaginated = params.limit != null;
  const normalizedLimit = isPaginated ? Math.min(Math.max(1, params.limit ?? 20), 100) : agents.length;

  const data = agents.slice(0, normalizedLimit);
  const hasMore = isPaginated && agents.length > normalizedLimit;

  return {
    object: 'list',
    data,
    first_id: data.length > 0 ? (data[0].id as string) ?? null : null,
    last_id: data.length > 0 ? (data[data.length - 1].id as string) ?? null : null,
    has_more: hasMore,
    after: null,
  };
}

export async function removeAgentResourceFilesBB(
  agentId: string,
  toolResource: string,
  fileIds: string[],
): Promise<Record<string, unknown> | null> {
  const agent = await getAgentBB({ id: agentId });
  if (!agent) {
    throw new Error('Agent not found for removing resource files');
  }

  const toolResources = (agent.tool_resources as Record<string, Record<string, unknown>>) ?? {};
  const resource = toolResources[toolResource] ?? {};
  const currentFileIds = (resource.file_ids as string[]) ?? [];
  const removeSet = new Set(fileIds);
  resource.file_ids = currentFileIds.filter((fid) => !removeSet.has(fid));
  toolResources[toolResource] = resource;

  return await updateAgentBB({ id: agentId }, { tool_resources: toolResources });
}
