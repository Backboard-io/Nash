import { backboardStorage } from './storage';

const ASSISTANT_TYPE = 'librechat_assistant';

function parseAssistant(item: {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}): Record<string, unknown> {
  try {
    const assistant = JSON.parse(item.content) as Record<string, unknown>;
    assistant._bbId = item.id;
    return assistant;
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

function applySelect(
  obj: Record<string, unknown>,
  select: Record<string, unknown>,
): Record<string, unknown> {
  const keys = Object.keys(select).filter((k) => select[k]);
  if (keys.length === 0) {
    return obj;
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  result._bbId = obj._bbId;
  return result;
}

export async function updateAssistantDocBB(
  filter: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const assistantId = (filter.assistant_id as string) ?? '';
  const existing = await backboardStorage.findByMetadata(ASSISTANT_TYPE, 'assistant_id', assistantId);

  if (existing) {
    const current = parseAssistant(existing);
    const { _bbId: _, ...currentData } = current;
    const merged: Record<string, unknown> = { ...currentData, ...data, updatedAt: new Date().toISOString() };

    await backboardStorage.deleteItem(existing.id);
    const newItem = await backboardStorage.createItem(JSON.stringify(merged), {
      type: ASSISTANT_TYPE,
      assistant_id: assistantId,
      user: (merged.user as string) ?? (filter.user as string) ?? '',
    });
    merged._bbId = newItem.id;
    return merged;
  }

  const timestamp = new Date().toISOString();
  const assistantData: Record<string, unknown> = {
    ...filter,
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const item = await backboardStorage.createItem(JSON.stringify(assistantData), {
    type: ASSISTANT_TYPE,
    assistant_id: assistantId,
    user: (assistantData.user as string) ?? (filter.user as string) ?? '',
  });

  assistantData._bbId = item.id;
  return assistantData;
}

export async function deleteAssistantBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(ASSISTANT_TYPE);
  const assistant = items.map(parseAssistant).find((a) => matchesFilter(a, filter));
  if (!assistant) {
    return null;
  }
  await backboardStorage.deleteItem(assistant._bbId as string);
  return assistant;
}

export async function getAssistantsBB(
  filter: Record<string, unknown>,
  select?: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(ASSISTANT_TYPE);
  let assistants = items
    .map(parseAssistant)
    .filter((a) => matchesFilter(a, filter));

  if (select) {
    assistants = assistants.map((a) => applySelect(a, select));
  }

  return assistants;
}

export async function getAssistantBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(ASSISTANT_TYPE);
  return items.map(parseAssistant).find((a) => matchesFilter(a, filter)) ?? null;
}
