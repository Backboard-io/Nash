import { backboardStorage } from './storage';

const PRESET_TYPE = 'librechat_preset';

export async function getPresetsBB(userId: string): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(PRESET_TYPE, userId);
  return items
    .map((item) => {
      try {
        const preset = JSON.parse(item.content) as Record<string, unknown>;
        return preset;
      } catch {
        return null;
      }
    })
    .filter((p): p is Record<string, unknown> => p !== null)
    .sort((a, b) => {
      const orderA = (a.order as number) ?? 999;
      const orderB = (b.order as number) ?? 999;
      return orderA - orderB;
    });
}

export async function savePresetBB(
  userId: string,
  preset: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const presetId = preset.presetId as string;

  if (presetId) {
    const existing = await backboardStorage.findByMetadata(
      PRESET_TYPE,
      'presetId',
      presetId,
      userId,
    );
    if (existing) {
      await backboardStorage.deleteItem(existing.id);
    }
  }

  preset.user = userId;
  const content = JSON.stringify(preset);
  await backboardStorage.createItem(content, {
    type: PRESET_TYPE,
    userId,
    presetId: presetId ?? '',
  });

  return preset;
}

export async function deletePresetsBB(
  userId: string,
  filter: Record<string, unknown>,
): Promise<number> {
  const presetId = filter.presetId as string | undefined;

  if (presetId) {
    const existing = await backboardStorage.findByMetadata(
      PRESET_TYPE,
      'presetId',
      presetId,
      userId,
    );
    if (existing) {
      await backboardStorage.deleteItem(existing.id);
      return 1;
    }
    return 0;
  }

  const all = await backboardStorage.listByType(PRESET_TYPE, userId);
  let count = 0;
  for (const item of all) {
    const deleted = await backboardStorage.deleteItem(item.id);
    if (deleted) {
      count++;
    }
  }
  return count;
}
