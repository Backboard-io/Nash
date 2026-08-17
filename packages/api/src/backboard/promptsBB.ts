import { nanoid } from 'nanoid';
import { logger } from '@librechat/data-schemas';
import { backboardStorage } from './storage';

const PROMPT_TYPE = 'librechat_prompt';
const PROMPTGROUP_TYPE = 'librechat_promptgroup';

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

export async function getPromptGroupsBB(
  filter: Record<string, unknown>,
): Promise<{
  promptGroups: Record<string, unknown>[];
  pageNumber: string;
  pageSize: string;
  pages: string;
}> {
  const pageNumber = Math.max(parseInt(String(filter.pageNumber ?? 1), 10), 1);
  const pageSize = Math.max(parseInt(String(filter.pageSize ?? 10), 10), 1);
  const { pageNumber: _pn, pageSize: _ps, name: _name, ...queryFilter } = filter;

  const items = await backboardStorage.listByType(PROMPTGROUP_TYPE);
  let groups = items.map(parseItem);

  if (_name) {
    const nameRegex = new RegExp(String(_name), 'i');
    groups = groups.filter((g) => nameRegex.test(String(g.name ?? '')));
  }

  groups = groups.filter((g) => matchesFilter(g, queryFilter));
  groups.sort((a, b) => {
    const dateA = (a.createdAt as string) ?? '';
    const dateB = (b.createdAt as string) ?? '';
    return dateB.localeCompare(dateA);
  });

  const total = groups.length;
  const start = (pageNumber - 1) * pageSize;
  const paged = groups.slice(start, start + pageSize);

  return {
    promptGroups: paged,
    pageNumber: String(pageNumber),
    pageSize: String(pageSize),
    pages: String(Math.ceil(total / pageSize)),
  };
}

export async function deletePromptGroupBB(filter: {
  _id: string;
  author?: string;
  role?: string;
}): Promise<{ message: string }> {
  const items = await backboardStorage.listByType(PROMPTGROUP_TYPE);
  const group = items
    .map(parseItem)
    .find((g) => g._id === filter._id || g.id === filter._id);

  if (!group) {
    throw new Error('Prompt group not found');
  }

  await backboardStorage.deleteItem(group._bbId as string);

  const promptItems = await backboardStorage.listByType(PROMPT_TYPE);
  for (const pItem of promptItems) {
    const prompt = parseItem(pItem);
    if (prompt.groupId === filter._id) {
      await backboardStorage.deleteItem(pItem.id);
    }
  }

  return { message: 'Prompt group deleted successfully' };
}

export async function getAllPromptGroupsBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(PROMPTGROUP_TYPE);
  let groups = items.map(parseItem);

  const { name: _name, ...queryFilter } = filter;
  if (_name) {
    const nameRegex = new RegExp(String(_name), 'i');
    groups = groups.filter((g) => nameRegex.test(String(g.name ?? '')));
  }

  groups = groups.filter((g) => matchesFilter(g, queryFilter));
  groups.sort((a, b) => {
    const dateA = (a.createdAt as string) ?? '';
    const dateB = (b.createdAt as string) ?? '';
    return dateB.localeCompare(dateA);
  });
  return groups;
}

export async function getListPromptGroupsByAccessBB(params: {
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
  const items = await backboardStorage.listByType(PROMPTGROUP_TYPE);
  let groups = items.map(parseItem);

  if (params.accessibleIds != null) {
    if (params.accessibleIds.length === 0) {
      groups = [];
    } else {
      const idSet = new Set(params.accessibleIds);
      groups = groups.filter((g) => {
        const gid = (g._id as string) ?? (g.id as string);
        return idSet.has(gid);
      });
    }
  }

  if (params.otherParams) {
    groups = groups.filter((g) => matchesFilter(g, params.otherParams ?? {}));
  }

  groups.sort((a, b) => {
    const dateA = (a.updatedAt as string) ?? '';
    const dateB = (b.updatedAt as string) ?? '';
    return dateB.localeCompare(dateA);
  });

  const isPaginated = params.limit != null;
  const normalizedLimit = isPaginated ? Math.min(Math.max(1, params.limit ?? 20), 100) : groups.length;
  const data = groups.slice(0, normalizedLimit);
  const hasMore = isPaginated && groups.length > normalizedLimit;

  return {
    object: 'list',
    data,
    first_id: data.length > 0 ? (data[0]._id as string) ?? null : null,
    last_id: data.length > 0 ? (data[data.length - 1]._id as string) ?? null : null,
    has_more: hasMore,
    after: null,
  };
}

export async function createPromptGroupBB(saveData: {
  prompt: Record<string, unknown>;
  group: Record<string, unknown>;
  author: string;
  authorName?: string;
}): Promise<{
  prompt: Record<string, unknown>;
  group: Record<string, unknown>;
}> {
  const groupId = `pg_${nanoid()}`;
  const promptId = `p_${nanoid()}`;
  const timestamp = new Date().toISOString();

  const groupData: Record<string, unknown> = {
    ...saveData.group,
    _id: groupId,
    id: groupId,
    author: saveData.author,
    authorName: saveData.authorName ?? '',
    productionId: promptId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const promptData: Record<string, unknown> = {
    ...saveData.prompt,
    _id: promptId,
    id: promptId,
    author: saveData.author,
    groupId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await backboardStorage.createItem(JSON.stringify(groupData), {
    type: PROMPTGROUP_TYPE,
    groupId,
    author: saveData.author,
  });

  await backboardStorage.createItem(JSON.stringify(promptData), {
    type: PROMPT_TYPE,
    promptId,
    groupId,
    author: saveData.author,
  });

  return {
    prompt: promptData,
    group: { ...groupData, productionPrompt: { prompt: promptData.prompt } },
  };
}

export async function savePromptBB(saveData: {
  prompt: Record<string, unknown>;
  author: string;
}): Promise<{ prompt: Record<string, unknown> }> {
  const promptId = `p_${nanoid()}`;
  const timestamp = new Date().toISOString();
  const promptData: Record<string, unknown> = {
    ...saveData.prompt,
    _id: promptId,
    id: promptId,
    author: saveData.author,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const groupId = (saveData.prompt.groupId as string) ?? '';

  await backboardStorage.createItem(JSON.stringify(promptData), {
    type: PROMPT_TYPE,
    promptId,
    groupId,
    author: saveData.author,
  });

  return { prompt: promptData };
}

export async function getPromptsBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(PROMPT_TYPE);
  return items
    .map(parseItem)
    .filter((p) => matchesFilter(p, filter))
    .sort((a, b) => {
      const dateA = (a.createdAt as string) ?? '';
      const dateB = (b.createdAt as string) ?? '';
      return dateB.localeCompare(dateA);
    });
}

export async function getPromptBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(PROMPT_TYPE);
  const parsed = items.map(parseItem);
  return parsed.find((p) => matchesFilter(p, filter)) ?? null;
}

export async function getRandomPromptGroupsBB(filter: {
  limit: number;
  skip: number;
}): Promise<{ prompts: Record<string, unknown>[] }> {
  const items = await backboardStorage.listByType(PROMPTGROUP_TYPE);
  const groups = items
    .map(parseItem)
    .filter((g) => g.category && (g.category as string) !== '');

  const shuffled = groups.sort(() => Math.random() - 0.5);
  const sliced = shuffled.slice(filter.skip, filter.skip + filter.limit);
  return { prompts: sliced };
}

export async function getPromptGroupsWithPromptsBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(PROMPTGROUP_TYPE);
  const group = items.map(parseItem).find((g) => matchesFilter(g, filter));
  if (!group) {
    return null;
  }

  const promptItems = await backboardStorage.listByType(PROMPT_TYPE);
  const groupId = (group._id as string) ?? (group.id as string);
  const prompts = promptItems
    .map(parseItem)
    .filter((p) => p.groupId === groupId);

  group.prompts = prompts;
  return group;
}

export async function getPromptGroupBB(
  id: string,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(PROMPTGROUP_TYPE);
  return items.map(parseItem).find((g) => g._id === id || g.id === id) ?? null;
}

export async function deletePromptBB(filter: {
  promptId: string;
  groupId: string;
  author?: string;
  role?: string;
}): Promise<Record<string, unknown>> {
  const items = await backboardStorage.listByType(PROMPT_TYPE);
  const prompt = items.map(parseItem).find((p) => {
    const pid = (p._id as string) ?? (p.id as string);
    return pid === filter.promptId && p.groupId === filter.groupId;
  });

  if (!prompt) {
    throw new Error('Failed to delete the prompt');
  }

  await backboardStorage.deleteItem(prompt._bbId as string);

  const remaining = items
    .map(parseItem)
    .filter((p) => p.groupId === filter.groupId && ((p._id as string) ?? (p.id as string)) !== filter.promptId);

  if (remaining.length === 0) {
    const groupItems = await backboardStorage.listByType(PROMPTGROUP_TYPE);
    const group = groupItems.map(parseItem).find((g) => {
      const gid = (g._id as string) ?? (g.id as string);
      return gid === filter.groupId;
    });
    if (group) {
      await backboardStorage.deleteItem(group._bbId as string);
    }
    return {
      prompt: 'Prompt deleted successfully',
      promptGroup: { message: 'Prompt group deleted successfully', id: filter.groupId },
    };
  }

  return { prompt: 'Prompt deleted successfully' };
}

export async function deleteUserPromptsBB(userId: string): Promise<void> {
  try {
    const groupItems = await backboardStorage.listByType(PROMPTGROUP_TYPE);
    for (const item of groupItems) {
      if (item.metadata.author === userId) {
        await backboardStorage.deleteItem(item.id);
      }
    }

    const promptItems = await backboardStorage.listByType(PROMPT_TYPE);
    for (const item of promptItems) {
      if (item.metadata.author === userId) {
        await backboardStorage.deleteItem(item.id);
      }
    }
  } catch (error) {
    logger.error('[deleteUserPromptsBB] Error:', error);
  }
}

export async function updatePromptGroupBB(
  id: string,
  update: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(PROMPTGROUP_TYPE);
  const group = items.map(parseItem).find((g) => g._id === id || g.id === id);
  if (!group) {
    return null;
  }

  const bbId = group._bbId as string;
  const { _bbId: _, removeProjectIds, projectIds: addProjectIds, ...updateFields } = update;
  const { _bbId: __, ...groupData } = group;

  if (removeProjectIds && Array.isArray(removeProjectIds)) {
    const removeSet = new Set(removeProjectIds as string[]);
    const current = (groupData.projectIds as string[]) ?? [];
    groupData.projectIds = current.filter((p) => !removeSet.has(p));
  }

  if (addProjectIds && Array.isArray(addProjectIds)) {
    const current = (groupData.projectIds as string[]) ?? [];
    const existingSet = new Set(current);
    for (const pid of addProjectIds as string[]) {
      if (!existingSet.has(pid)) {
        (groupData.projectIds as string[]).push(pid);
      }
    }
  }

  const merged: Record<string, unknown> = { ...groupData, ...updateFields, updatedAt: new Date().toISOString() };

  await backboardStorage.deleteItem(bbId);
  const content = JSON.stringify(merged);
  const groupId = (merged._id as string) ?? (merged.id as string) ?? id;
  await backboardStorage.createItem(content, {
    type: PROMPTGROUP_TYPE,
    groupId,
    author: (merged.author as string) ?? '',
  });

  return merged;
}

export async function makePromptProductionBB(promptId: string): Promise<{ message: string }> {
  const promptItems = await backboardStorage.listByType(PROMPT_TYPE);
  const prompt = promptItems.map(parseItem).find((p) => {
    const pid = (p._id as string) ?? (p.id as string);
    return pid === promptId;
  });

  if (!prompt) {
    throw new Error('Prompt not found');
  }

  const groupId = prompt.groupId as string;
  if (groupId) {
    await updatePromptGroupBB(groupId, { productionId: promptId });
  }

  return { message: 'Prompt production made successfully' };
}

export async function updatePromptLabelsBB(
  promptId: string,
  labels: string[],
): Promise<{ message: string }> {
  const promptItems = await backboardStorage.listByType(PROMPT_TYPE);
  const prompt = promptItems.map(parseItem).find((p) => {
    const pid = (p._id as string) ?? (p.id as string);
    return pid === promptId;
  });

  if (!prompt) {
    return { message: 'Prompt not found' };
  }

  const bbId = prompt._bbId as string;
  const { _bbId: _, ...promptData } = prompt;
  promptData.labels = labels;

  await backboardStorage.deleteItem(bbId);
  await backboardStorage.createItem(JSON.stringify(promptData), {
    type: PROMPT_TYPE,
    promptId: (promptData._id as string) ?? (promptData.id as string) ?? '',
    groupId: (promptData.groupId as string) ?? '',
    author: (promptData.author as string) ?? '',
  });

  return { message: 'Prompt labels updated successfully' };
}
