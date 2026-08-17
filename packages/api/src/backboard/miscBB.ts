import { nanoid } from 'nanoid';
import { logger } from '@librechat/data-schemas';
import { backboardStorage } from './storage';

const BANNER_TYPE = 'librechat_banner';
const PROJECT_TYPE = 'librechat_project';
const AGENTCATEGORY_TYPE = 'librechat_agentcategory';
const MCPSERVER_TYPE = 'librechat_mcpserver';

function parseItem(item: {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}): Record<string, unknown> {
  try {
    const parsed = JSON.parse(item.content) as Record<string, unknown>;
    parsed._bbId = item.id;
    return parsed;
  } catch {
    return { _bbId: item.id, ...item.metadata };
  }
}

function matchesFilter(
  obj: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (obj[key] !== value) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

export async function getBannerBB(): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(BANNER_TYPE);
  const now = new Date();
  const banners = items.map(parseItem).filter((b) => {
    const displayFrom = b.displayFrom ? new Date(b.displayFrom as string) : null;
    const displayTo = b.displayTo ? new Date(b.displayTo as string) : null;
    if (displayFrom && displayFrom > now) {
      return false;
    }
    if (displayTo && displayTo < now) {
      return false;
    }
    return b.type === 'banner';
  });
  return banners[0] ?? null;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export async function getProjectByIdBB(
  projectId: string,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(PROJECT_TYPE);
  return items.map(parseItem).find((p) => p._id === projectId || p.id === projectId) ?? null;
}

export async function getProjectByNameBB(
  name: string,
): Promise<Record<string, unknown> | null> {
  const existing = await backboardStorage.findByMetadata(PROJECT_TYPE, 'projectName', name);
  if (existing) {
    return parseItem(existing);
  }

  if (name === 'instance') {
    const projectId = `proj_${nanoid()}`;
    const projectData: Record<string, unknown> = {
      _id: projectId,
      id: projectId,
      name: 'instance',
      promptGroupIds: [],
      agentIds: [],
    };
    const item = await backboardStorage.createItem(JSON.stringify(projectData), {
      type: PROJECT_TYPE,
      projectId,
      projectName: 'instance',
    });
    logger.info(`[getProjectByNameBB] Auto-created instance project ${projectId}`);
    projectData._bbId = item.id;
    return projectData;
  }

  return null;
}

export async function addGroupIdsToProjectBB(
  projectId: string,
  groupIds: string[],
): Promise<Record<string, unknown> | null> {
  const project = await getProjectByIdBB(projectId);
  if (!project) {
    return null;
  }

  const currentIds = (project.promptGroupIds as string[]) ?? [];
  const idSet = new Set(currentIds);
  for (const gid of groupIds) {
    idSet.add(gid);
  }

  return await updateProject(project, { promptGroupIds: Array.from(idSet) });
}

export async function removeGroupIdsFromProjectBB(
  projectId: string,
  groupIds: string[],
): Promise<Record<string, unknown> | null> {
  const project = await getProjectByIdBB(projectId);
  if (!project) {
    return null;
  }

  const currentIds = (project.promptGroupIds as string[]) ?? [];
  const removeSet = new Set(groupIds);
  const filtered = currentIds.filter((id) => !removeSet.has(id));

  return await updateProject(project, { promptGroupIds: filtered });
}

export async function removeGroupFromAllProjectsBB(
  groupId: string,
): Promise<void> {
  const items = await backboardStorage.listByType(PROJECT_TYPE);
  for (const item of items) {
    const project = parseItem(item);
    const currentIds = (project.promptGroupIds as string[]) ?? [];
    if (currentIds.includes(groupId)) {
      const filtered = currentIds.filter((id) => id !== groupId);
      await updateProject(project, { promptGroupIds: filtered });
    }
  }
}

export async function addAgentIdsToProjectBB(
  projectId: string,
  agentIds: string[],
): Promise<Record<string, unknown> | null> {
  const project = await getProjectByIdBB(projectId);
  if (!project) {
    return null;
  }

  const currentIds = (project.agentIds as string[]) ?? [];
  const idSet = new Set(currentIds);
  for (const aid of agentIds) {
    idSet.add(aid);
  }

  return await updateProject(project, { agentIds: Array.from(idSet) });
}

export async function removeAgentIdsFromProjectBB(
  projectId: string,
  agentIds: string[],
): Promise<Record<string, unknown> | null> {
  const project = await getProjectByIdBB(projectId);
  if (!project) {
    return null;
  }

  const currentIds = (project.agentIds as string[]) ?? [];
  const removeSet = new Set(agentIds);
  const filtered = currentIds.filter((id) => !removeSet.has(id));

  return await updateProject(project, { agentIds: filtered });
}

export async function removeAgentFromAllProjectsBB(
  agentId: string,
): Promise<void> {
  const items = await backboardStorage.listByType(PROJECT_TYPE);
  for (const item of items) {
    const project = parseItem(item);
    const currentIds = (project.agentIds as string[]) ?? [];
    if (currentIds.includes(agentId)) {
      const filtered = currentIds.filter((id) => id !== agentId);
      await updateProject(project, { agentIds: filtered });
    }
  }
}

async function updateProject(
  project: Record<string, unknown>,
  updates: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const bbId = project._bbId as string;
  const { _bbId: _, ...projectData } = project;
  const merged = { ...projectData, ...updates };

  await backboardStorage.deleteItem(bbId);
  const projId = (merged._id as string) ?? (merged.id as string) ?? '';
  const projName = (merged.name as string) ?? '';
  const newItem = await backboardStorage.createItem(JSON.stringify(merged), {
    type: PROJECT_TYPE,
    projectId: projId,
    projectName: projName,
  });
  merged._bbId = newItem.id;
  return merged;
}

// ---------------------------------------------------------------------------
// AgentCategory
// ---------------------------------------------------------------------------

export async function getActiveCategoriesBB(): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(AGENTCATEGORY_TYPE);
  return items
    .map(parseItem)
    .filter((c) => c.isActive !== false)
    .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));
}

export async function getCategoriesWithCountsBB(): Promise<Record<string, unknown>[]> {
  const categories = await getActiveCategoriesBB();
  return categories.map((c) => ({ ...c, agentCount: 0 }));
}

export async function getValidCategoryValuesBB(): Promise<string[]> {
  const categories = await getActiveCategoriesBB();
  return categories
    .map((c) => c.value as string)
    .filter(Boolean);
}

export async function seedCategoriesBB(
  categories: Array<{
    value: string;
    label?: string;
    description?: string;
    order?: number;
    custom?: boolean;
  }>,
): Promise<void> {
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const existing = await backboardStorage.findByMetadata(AGENTCATEGORY_TYPE, 'categoryValue', cat.value);
    if (existing) {
      continue;
    }
    const catData: Record<string, unknown> = {
      _id: `cat_${nanoid()}`,
      value: cat.value,
      label: cat.label ?? cat.value,
      description: cat.description ?? '',
      order: cat.order ?? i,
      isActive: true,
      custom: cat.custom ?? false,
    };
    await backboardStorage.createItem(JSON.stringify(catData), {
      type: AGENTCATEGORY_TYPE,
      categoryValue: cat.value,
    });
  }
}

export async function findCategoryByValueBB(
  value: string,
): Promise<Record<string, unknown> | null> {
  const existing = await backboardStorage.findByMetadata(AGENTCATEGORY_TYPE, 'categoryValue', value);
  if (!existing) {
    return null;
  }
  return parseItem(existing);
}

export async function createCategoryBB(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const catId = `cat_${nanoid()}`;
  const catData: Record<string, unknown> = { ...data, _id: catId, id: catId, isActive: true };
  const value = (data.value as string) ?? '';
  const item = await backboardStorage.createItem(JSON.stringify(catData), {
    type: AGENTCATEGORY_TYPE,
    categoryValue: value,
  });
  catData._bbId = item.id;
  return catData;
}

export async function updateCategoryBB(
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(AGENTCATEGORY_TYPE);
  const category = items.map(parseItem).find((c) =>
    c._id === id || c.id === id || c.value === id,
  );
  if (!category) {
    return null;
  }

  const bbId = category._bbId as string;
  const { _bbId: _, ...catData } = category;
  const merged = { ...catData, ...data };

  await backboardStorage.deleteItem(bbId);
  const value = (merged.value as string) ?? '';
  const newItem = await backboardStorage.createItem(JSON.stringify(merged), {
    type: AGENTCATEGORY_TYPE,
    categoryValue: value,
  });
  merged._bbId = newItem.id;
  return merged;
}

export async function deleteCategoryBB(
  id: string,
): Promise<boolean> {
  const items = await backboardStorage.listByType(AGENTCATEGORY_TYPE);
  const category = items.map(parseItem).find((c) =>
    c._id === id || c.id === id || c.value === id,
  );
  if (!category) {
    return false;
  }
  return await backboardStorage.deleteItem(category._bbId as string);
}

export async function findCategoryByIdBB(
  id: string,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(AGENTCATEGORY_TYPE);
  return items.map(parseItem).find((c) => c._id === id || c.id === id) ?? null;
}

export async function getAllCategoriesBB(): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(AGENTCATEGORY_TYPE);
  return items
    .map(parseItem)
    .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));
}

export async function ensureDefaultCategoriesBB(): Promise<boolean> {
  const defaultCategories = [
    { value: 'general', label: 'com_agents_category_general', description: 'com_agents_category_general_description', order: 0 },
    { value: 'hr', label: 'com_agents_category_hr', description: 'com_agents_category_hr_description', order: 1 },
    { value: 'rd', label: 'com_agents_category_rd', description: 'com_agents_category_rd_description', order: 2 },
    { value: 'finance', label: 'com_agents_category_finance', description: 'com_agents_category_finance_description', order: 3 },
    { value: 'it', label: 'com_agents_category_it', description: 'com_agents_category_it_description', order: 4 },
    { value: 'sales', label: 'com_agents_category_sales', description: 'com_agents_category_sales_description', order: 5 },
    { value: 'aftersales', label: 'com_agents_category_aftersales', description: 'com_agents_category_aftersales_description', order: 6 },
  ];

  let changed = false;
  for (const cat of defaultCategories) {
    const existing = await findCategoryByValueBB(cat.value);
    if (!existing) {
      await createCategoryBB({ ...cat, isActive: true, custom: false });
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// MCPServer
// ---------------------------------------------------------------------------

export async function createMCPServerBB(data: {
  config: Record<string, unknown>;
  author: string;
}): Promise<Record<string, unknown>> {
  const title = (data.config.title as string) ?? '';
  let serverName: string;
  if (title) {
    const slug = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    serverName = slug || `mcp-${nanoid(16)}`;
  } else {
    serverName = `mcp-${nanoid(16)}`;
  }

  const existing = await backboardStorage.findByMetadata(MCPSERVER_TYPE, 'serverName', serverName);
  if (existing) {
    serverName = `${serverName}-${nanoid(4)}`;
  }

  const serverId = `mcp_${nanoid()}`;
  const timestamp = new Date().toISOString();
  const serverData: Record<string, unknown> = {
    _id: serverId,
    id: serverId,
    serverName,
    config: data.config,
    author: data.author,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const item = await backboardStorage.createItem(JSON.stringify(serverData), {
    type: MCPSERVER_TYPE,
    serverName,
    author: data.author,
  });
  serverData._bbId = item.id;
  return serverData;
}

export async function findMCPServerByServerNameBB(
  serverName: string,
): Promise<Record<string, unknown> | null> {
  const existing = await backboardStorage.findByMetadata(MCPSERVER_TYPE, 'serverName', serverName);
  if (!existing) {
    return null;
  }
  return parseItem(existing);
}

export async function findMCPServerByObjectIdBB(
  id: string,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(MCPSERVER_TYPE);
  return items.map(parseItem).find((s) => s._id === id || s.id === id) ?? null;
}

export async function findMCPServersByAuthorBB(
  authorId: string,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(MCPSERVER_TYPE);
  return items
    .map(parseItem)
    .filter((s) => s.author === authorId)
    .sort((a, b) => {
      const dateA = (a.updatedAt as string) ?? '';
      const dateB = (b.updatedAt as string) ?? '';
      return dateB.localeCompare(dateA);
    });
}

export async function getListMCPServersByIdsBB(
  ids: string[],
): Promise<{ data: Record<string, unknown>[]; has_more: boolean; after: string | null }> {
  if (!ids || ids.length === 0) {
    return { data: [], has_more: false, after: null };
  }
  const items = await backboardStorage.listByType(MCPSERVER_TYPE);
  const idSet = new Set(ids);
  const data = items
    .map(parseItem)
    .filter((s) => {
      const sid = (s._id as string) ?? (s.id as string);
      return idSet.has(sid);
    });
  return { data, has_more: false, after: null };
}

export async function getListMCPServersByNamesBB(
  names: string[],
): Promise<{ data: Record<string, unknown>[] }> {
  if (!names || names.length === 0) {
    return { data: [] };
  }
  const items = await backboardStorage.listByType(MCPSERVER_TYPE);
  const nameSet = new Set(names);
  const data = items
    .map(parseItem)
    .filter((s) => nameSet.has(s.serverName as string));
  return { data };
}

export async function updateMCPServerBB(
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(MCPSERVER_TYPE);
  const server = items.map(parseItem).find((s) =>
    s._id === id || s.id === id || s.serverName === id,
  );
  if (!server) {
    return null;
  }

  const bbId = server._bbId as string;
  const { _bbId: _, ...serverData } = server;
  const merged: Record<string, unknown> = { ...serverData, ...data, updatedAt: new Date().toISOString() };

  await backboardStorage.deleteItem(bbId);
  const serverName = (merged.serverName as string) ?? '';
  const newItem = await backboardStorage.createItem(JSON.stringify(merged), {
    type: MCPSERVER_TYPE,
    serverName,
    author: (merged.author as string) ?? '',
  });
  merged._bbId = newItem.id;
  return merged;
}

export async function deleteMCPServerBB(
  id: string,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(MCPSERVER_TYPE);
  const server = items.map(parseItem).find((s) =>
    s._id === id || s.id === id || s.serverName === id,
  );
  if (!server) {
    return null;
  }
  await backboardStorage.deleteItem(server._bbId as string);
  return server;
}
