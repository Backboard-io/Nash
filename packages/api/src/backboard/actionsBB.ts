import { backboardStorage } from './storage';

const ACTION_TYPE = 'librechat_action';

function parseAction(item: {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}): Record<string, unknown> {
  try {
    const action = JSON.parse(item.content) as Record<string, unknown>;
    action._bbId = item.id;
    return action;
  } catch {
    return { _bbId: item.id, ...item.metadata };
  }
}

function matchesFilter(
  action: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (action[key] !== value) {
      return false;
    }
  }
  return true;
}

function stripSensitive(action: Record<string, unknown>): Record<string, unknown> {
  const metadata = action.metadata as Record<string, unknown> | undefined;
  if (!metadata) {
    return action;
  }
  const sensitiveFields = ['api_key', 'oauth_client_id', 'oauth_client_secret'];
  const cleaned = { ...metadata };
  for (const field of sensitiveFields) {
    delete cleaned[field];
  }
  return { ...action, metadata: cleaned };
}

export async function getActionsBB(
  filter: Record<string, unknown>,
  includeSensitive = false,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(ACTION_TYPE);
  let actions = items
    .map(parseAction)
    .filter((a) => matchesFilter(a, filter));

  if (!includeSensitive) {
    actions = actions.map(stripSensitive);
  }

  return actions;
}

export async function updateActionBB(
  filter: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const actionId = (filter.action_id as string) ?? '';
  const existing = await backboardStorage.findByMetadata(ACTION_TYPE, 'action_id', actionId);

  if (existing) {
    const current = parseAction(existing);
    const { _bbId: _, ...currentData } = current;
    const merged: Record<string, unknown> = { ...currentData, ...data, updatedAt: new Date().toISOString() };

    await backboardStorage.deleteItem(existing.id);
    const newItem = await backboardStorage.createItem(JSON.stringify(merged), {
      type: ACTION_TYPE,
      action_id: actionId,
      user: (merged.user as string) ?? (filter.user as string) ?? '',
    });
    merged._bbId = newItem.id;
    return merged;
  }

  const timestamp = new Date().toISOString();
  const actionData: Record<string, unknown> = {
    ...filter,
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const item = await backboardStorage.createItem(JSON.stringify(actionData), {
    type: ACTION_TYPE,
    action_id: actionId,
    user: (actionData.user as string) ?? (filter.user as string) ?? '',
  });

  actionData._bbId = item.id;
  return actionData;
}

export async function deleteActionBB(
  filter: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(ACTION_TYPE);
  const action = items.map(parseAction).find((a) => matchesFilter(a, filter));
  if (!action) {
    return null;
  }
  await backboardStorage.deleteItem(action._bbId as string);
  return action;
}

export async function deleteActionsBB(
  filter: Record<string, unknown>,
): Promise<number> {
  const items = await backboardStorage.listByType(ACTION_TYPE);
  const matching = items.map(parseAction).filter((a) => matchesFilter(a, filter));

  let deleted = 0;
  for (const action of matching) {
    const success = await backboardStorage.deleteItem(action._bbId as string);
    if (success) {
      deleted++;
    }
  }
  return deleted;
}
