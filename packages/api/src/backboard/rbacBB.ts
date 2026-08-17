import { nanoid } from 'nanoid';
import { logger } from '@librechat/data-schemas';
import { SystemRoles, roleDefaults } from 'librechat-data-provider';
import { backboardStorage } from './storage';

const ROLE_TYPE = 'librechat_role';
const ACCESSROLE_TYPE = 'librechat_accessrole';
const ACLENTRY_TYPE = 'librechat_aclentry';
const GROUP_TYPE = 'librechat_group';

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
// Role
// ---------------------------------------------------------------------------

export async function listRolesBB(): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(ROLE_TYPE);
  return items.map(parseItem);
}

export async function getRoleByNameBB(
  roleName: string,
): Promise<Record<string, unknown> | null> {
  const existing = await backboardStorage.findByMetadata(ROLE_TYPE, 'roleName', roleName);
  if (existing) {
    return parseItem(existing);
  }

  const defaults = roleDefaults[roleName as keyof typeof roleDefaults];
  if (!defaults) {
    return null;
  }
  const roleData: Record<string, unknown> = { ...defaults, name: roleName };
  await backboardStorage.createItem(JSON.stringify(roleData), {
    type: ROLE_TYPE,
    roleName,
  });
  logger.info(`[getRoleByNameBB] Auto-created role: ${roleName}`);
  return roleData;
}

export async function updateAccessPermissionsBB(
  roleName: string,
  permissionsUpdate: Record<string, Record<string, boolean | undefined>>,
): Promise<void> {
  const existing = await backboardStorage.findByMetadata(ROLE_TYPE, 'roleName', roleName);
  if (!existing) {
    const defaults = roleDefaults[roleName as keyof typeof roleDefaults];
    const roleData: Record<string, unknown> = {
      ...(defaults ?? {}),
      name: roleName,
      permissions: permissionsUpdate,
    };
    await backboardStorage.createItem(JSON.stringify(roleData), {
      type: ROLE_TYPE,
      roleName,
    });
    return;
  }

  const current = parseItem(existing);
  const currentPerms = (current.permissions ?? {}) as Record<string, Record<string, unknown>>;

  for (const [permType, updates] of Object.entries(permissionsUpdate)) {
    if (!currentPerms[permType]) {
      currentPerms[permType] = {};
    }
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        currentPerms[permType][key] = value;
      }
    }
  }

  current.permissions = currentPerms;
  const { _bbId: _, ...roleData } = current;
  await backboardStorage.deleteItem(existing.id);
  await backboardStorage.createItem(JSON.stringify(roleData), {
    type: ROLE_TYPE,
    roleName,
  });
}

export async function initializeRolesBB(): Promise<void> {
  const existing = await backboardStorage.listByType(ROLE_TYPE);
  const existingNames = new Set(existing.map((item) => item.metadata.roleName as string));

  for (const roleName of [SystemRoles.ADMIN, SystemRoles.USER]) {
    if (existingNames.has(roleName)) {
      continue;
    }
    const defaults = roleDefaults[roleName as keyof typeof roleDefaults];
    const roleData: Record<string, unknown> = { ...defaults, name: roleName };
    await backboardStorage.createItem(JSON.stringify(roleData), {
      type: ROLE_TYPE,
      roleName,
    });
  }
}

// ---------------------------------------------------------------------------
// AccessRole
// ---------------------------------------------------------------------------

export async function createAccessRoleBB(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const roleId = (data.accessRoleId as string) ?? `ar_${nanoid()}`;
  const roleData: Record<string, unknown> = { ...data, accessRoleId: roleId, _id: roleId };
  const item = await backboardStorage.createItem(JSON.stringify(roleData), {
    type: ACCESSROLE_TYPE,
    accessRoleId: roleId,
  });
  roleData._bbId = item.id;
  return roleData;
}

export async function updateAccessRoleBB(
  accessRoleId: string,
  update: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const existing = await backboardStorage.findByMetadata(ACCESSROLE_TYPE, 'accessRoleId', accessRoleId);
  if (!existing) {
    return null;
  }

  const current = parseItem(existing);
  const { _bbId: _, ...currentData } = current;
  const merged = { ...currentData, ...update };

  await backboardStorage.deleteItem(existing.id);
  const newItem = await backboardStorage.createItem(JSON.stringify(merged), {
    type: ACCESSROLE_TYPE,
    accessRoleId,
  });
  merged._bbId = newItem.id;
  return merged;
}

export async function deleteAccessRoleBB(
  accessRoleId: string,
): Promise<{ deletedCount: number }> {
  const existing = await backboardStorage.findByMetadata(ACCESSROLE_TYPE, 'accessRoleId', accessRoleId);
  if (!existing) {
    return { deletedCount: 0 };
  }
  await backboardStorage.deleteItem(existing.id);
  return { deletedCount: 1 };
}

export async function getAllAccessRolesBB(): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(ACCESSROLE_TYPE);
  return items.map(parseItem);
}

export async function findAccessRoleByIdBB(
  roleId: string,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(ACCESSROLE_TYPE);
  return items.map(parseItem).find((r) => r._id === roleId || r.id === roleId) ?? null;
}

export async function seedDefaultRolesBB(): Promise<Record<string, Record<string, unknown>>> {
  const VIEW = 1;
  const EDITOR = 3;
  const OWNER = 15;

  const defaultRoles = [
    { accessRoleId: 'agent_viewer', name: 'com_ui_role_viewer', resourceType: 'agent', permBits: VIEW },
    { accessRoleId: 'agent_editor', name: 'com_ui_role_editor', resourceType: 'agent', permBits: EDITOR },
    { accessRoleId: 'agent_owner', name: 'com_ui_role_owner', resourceType: 'agent', permBits: OWNER },
    { accessRoleId: 'promptGroup_viewer', name: 'com_ui_role_viewer', resourceType: 'promptGroup', permBits: VIEW },
    { accessRoleId: 'promptGroup_editor', name: 'com_ui_role_editor', resourceType: 'promptGroup', permBits: EDITOR },
    { accessRoleId: 'promptGroup_owner', name: 'com_ui_role_owner', resourceType: 'promptGroup', permBits: OWNER },
    { accessRoleId: 'mcpServer_viewer', name: 'com_ui_mcp_server_role_viewer', resourceType: 'mcpServer', permBits: VIEW },
    { accessRoleId: 'mcpServer_editor', name: 'com_ui_mcp_server_role_editor', resourceType: 'mcpServer', permBits: EDITOR },
    { accessRoleId: 'mcpServer_owner', name: 'com_ui_mcp_server_role_owner', resourceType: 'mcpServer', permBits: OWNER },
    { accessRoleId: 'remoteAgent_viewer', name: 'com_ui_remote_agent_role_viewer', resourceType: 'remoteAgent', permBits: VIEW },
    { accessRoleId: 'remoteAgent_editor', name: 'com_ui_remote_agent_role_editor', resourceType: 'remoteAgent', permBits: EDITOR },
    { accessRoleId: 'remoteAgent_owner', name: 'com_ui_remote_agent_role_owner', resourceType: 'remoteAgent', permBits: OWNER },
  ];

  const result: Record<string, Record<string, unknown>> = {};
  for (const role of defaultRoles) {
    const existing = await backboardStorage.findByMetadata(ACCESSROLE_TYPE, 'accessRoleId', role.accessRoleId);
    if (existing) {
      result[role.accessRoleId] = parseItem(existing);
      continue;
    }
    const created = await createAccessRoleBB(role);
    result[role.accessRoleId] = created;
  }
  return result;
}

export async function findAccessRoleByIdentifierBB(
  identifier: string,
): Promise<Record<string, unknown> | null> {
  const existing = await backboardStorage.findByMetadata(ACCESSROLE_TYPE, 'accessRoleId', identifier);
  if (!existing) {
    return null;
  }
  return parseItem(existing);
}

export async function getRoleForPermissionsBB(params: {
  resourceType: string;
  permBits: number;
}): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(ACCESSROLE_TYPE);
  const roles = items.map(parseItem).filter((r) => r.resourceType === params.resourceType);

  const exact = roles.find((r) => r.permBits === params.permBits);
  if (exact) {
    return exact;
  }

  const sorted = roles
    .filter((r) => ((r.permBits as number) & params.permBits) === (r.permBits as number))
    .sort((a, b) => (b.permBits as number) - (a.permBits as number));

  return sorted[0] ?? null;
}

export async function findAccessRoleByPermissionsBB(params: {
  resourceType: string;
  permBits: number;
}): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(ACCESSROLE_TYPE);
  return items
    .map(parseItem)
    .find((r) => r.resourceType === params.resourceType && r.permBits === params.permBits) ?? null;
}

export async function findAccessRolesByResourceTypeBB(
  resourceType: string,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(ACCESSROLE_TYPE);
  return items.map(parseItem).filter((r) => r.resourceType === resourceType);
}

// ---------------------------------------------------------------------------
// AclEntry
// ---------------------------------------------------------------------------

function buildAclKey(entry: Record<string, unknown>): string {
  return `${entry.principalType}:${entry.principalId ?? 'public'}:${entry.resourceType}:${entry.resourceId}`;
}

export async function findEntriesByPrincipalBB(
  _principalType: string,
  principalId: string,
  resourceType?: string,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(ACLENTRY_TYPE);
  return items.map(parseItem).filter((e) => {
    if (String(e.principalId) !== String(principalId)) {
      return false;
    }
    if (resourceType && e.resourceType !== resourceType) {
      return false;
    }
    return true;
  });
}

export async function findEntriesByResourceBB(
  resourceType: string,
  resourceId: string,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(ACLENTRY_TYPE);
  return items.map(parseItem).filter((e) => {
    if (String(e.resourceId) !== String(resourceId)) {
      return false;
    }
    if (resourceType && e.resourceType !== resourceType) {
      return false;
    }
    return true;
  });
}

export async function findEntriesByPrincipalsAndResourceBB(
  principalIds: Array<{ principalType: string; principalId?: string }>,
  resourceType: string,
  resourceId: string,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(ACLENTRY_TYPE);
  const allEntries = items.map(parseItem);

  return allEntries.filter((e) => {
    if (String(e.resourceId) !== String(resourceId)) {
      return false;
    }
    if (resourceType && e.resourceType !== resourceType) {
      return false;
    }
    return principalIds.some((p) => {
      if (p.principalType === 'public') {
        return e.principalType === 'public';
      }
      return e.principalType === p.principalType && String(e.principalId) === String(p.principalId);
    });
  });
}

export async function hasPermissionBB(
  principalsList: Array<{ principalType: string; principalId?: string }>,
  resourceType: string,
  resourceId: string,
  permissionBit: number,
): Promise<boolean> {
  const items = await backboardStorage.listByType(ACLENTRY_TYPE);
  const allEntries = items.map(parseItem);

  return allEntries.some((e) => {
    if (e.resourceType !== resourceType || String(e.resourceId) !== String(resourceId)) {
      return false;
    }
    const bits = (e.permBits as number) ?? 0;
    if ((bits & permissionBit) !== permissionBit) {
      return false;
    }
    return principalsList.some((p) => {
      if (p.principalType === 'public') {
        return e.principalType === 'public';
      }
      return e.principalType === p.principalType && String(e.principalId) === String(p.principalId);
    });
  });
}

export async function getEffectivePermissionsBB(
  principalsList: Array<{ principalType: string; principalId?: string }>,
  resourceType: string,
  resourceId: string,
): Promise<number> {
  const entries = await findEntriesByPrincipalsAndResourceBB(
    principalsList,
    resourceType,
    resourceId,
  );

  let bits = 0;
  for (const entry of entries) {
    bits |= (entry.permBits as number) ?? 0;
  }
  return bits;
}

export async function getEffectivePermissionsForResourcesBB(
  principalsList: Array<{ principalType: string; principalId?: string }>,
  resourceType: string,
  resourceIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!resourceIds || resourceIds.length === 0) {
    return result;
  }

  const items = await backboardStorage.listByType(ACLENTRY_TYPE);
  const allEntries = items.map(parseItem);
  const resourceSet = new Set(resourceIds.map(String));

  for (const entry of allEntries) {
    if (entry.resourceType !== resourceType) {
      continue;
    }
    const rid = String(entry.resourceId);
    if (!resourceSet.has(rid)) {
      continue;
    }
    const matchesPrincipal = principalsList.some((p) => {
      if (p.principalType === 'public') {
        return entry.principalType === 'public';
      }
      return entry.principalType === p.principalType && String(entry.principalId) === String(p.principalId);
    });
    if (matchesPrincipal) {
      const current = result.get(rid) ?? 0;
      result.set(rid, current | ((entry.permBits as number) ?? 0));
    }
  }

  return result;
}

export async function grantPermissionBB(
  principalType: string,
  principalId: string | null,
  resourceType: string,
  resourceId: string,
  permBits: number,
  grantedBy: string,
  _session?: unknown,
  roleId?: string,
): Promise<Record<string, unknown>> {
  const aclKey = buildAclKey({ principalType, principalId, resourceType, resourceId });

  const existing = await backboardStorage.findByMetadata(ACLENTRY_TYPE, 'aclKey', aclKey);
  if (existing) {
    await backboardStorage.deleteItem(existing.id);
  }

  const entryData: Record<string, unknown> = {
    principalType,
    principalId,
    resourceType,
    resourceId,
    permBits,
    grantedBy,
    grantedAt: new Date().toISOString(),
  };
  if (roleId) {
    entryData.roleId = roleId;
  }

  const item = await backboardStorage.createItem(JSON.stringify(entryData), {
    type: ACLENTRY_TYPE,
    aclKey,
  });
  entryData._bbId = item.id;
  return entryData;
}

export async function revokePermissionBB(
  principalType: string,
  principalId: string | null,
  resourceType: string,
  resourceId: string,
  _session?: unknown,
): Promise<{ deletedCount: number }> {
  const aclKey = buildAclKey({ principalType, principalId, resourceType, resourceId });

  const existing = await backboardStorage.findByMetadata(ACLENTRY_TYPE, 'aclKey', aclKey);
  if (!existing) {
    return { deletedCount: 0 };
  }
  await backboardStorage.deleteItem(existing.id);
  return { deletedCount: 1 };
}

export async function modifyPermissionBitsBB(
  principalType: string,
  principalId: string | null,
  resourceType: string,
  resourceId: string,
  addBits?: number | null,
  removeBits?: number | null,
  _session?: unknown,
): Promise<Record<string, unknown> | null> {
  const aclKey = buildAclKey({ principalType, principalId, resourceType, resourceId });

  const existing = await backboardStorage.findByMetadata(ACLENTRY_TYPE, 'aclKey', aclKey);
  if (!existing) {
    return null;
  }

  const entry = parseItem(existing);
  let bits = (entry.permBits as number) ?? 0;
  if (addBits) {
    bits |= addBits;
  }
  if (removeBits) {
    bits &= ~removeBits;
  }
  entry.permBits = bits;

  const { _bbId: _, ...entryData } = entry;
  await backboardStorage.deleteItem(existing.id);
  const newItem = await backboardStorage.createItem(JSON.stringify(entryData), {
    type: ACLENTRY_TYPE,
    aclKey,
  });
  entryData._bbId = newItem.id;
  return entryData;
}

export async function findAccessibleResourcesBB(
  principalsList: Array<{ principalType: string; principalId?: string }>,
  resourceType: string,
  requiredPermBit: number,
): Promise<string[]> {
  const items = await backboardStorage.listByType(ACLENTRY_TYPE);
  const allEntries = items.map(parseItem);
  const resourceIds = new Set<string>();

  for (const entry of allEntries) {
    if (entry.resourceType !== resourceType) {
      continue;
    }
    const bits = (entry.permBits as number) ?? 0;
    if ((bits & requiredPermBit) !== requiredPermBit) {
      continue;
    }
    const matchesPrincipal = principalsList.some((p) => {
      if (p.principalType === 'public') {
        return entry.principalType === 'public';
      }
      return entry.principalType === p.principalType && String(entry.principalId) === String(p.principalId);
    });
    if (matchesPrincipal) {
      resourceIds.add(String(entry.resourceId));
    }
  }

  return Array.from(resourceIds);
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export async function findGroupByIdBB(
  groupId: string,
): Promise<Record<string, unknown> | null> {
  const items = await backboardStorage.listByType(GROUP_TYPE);
  return items.map(parseItem).find((g) => g._id === groupId || g.id === groupId) ?? null;
}

export async function findGroupByExternalIdBB(
  externalId: string,
): Promise<Record<string, unknown> | null> {
  const existing = await backboardStorage.findByMetadata(GROUP_TYPE, 'idOnTheSource', externalId);
  if (!existing) {
    return null;
  }
  return parseItem(existing);
}

export async function findGroupsByNamePatternBB(
  pattern: string,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(GROUP_TYPE);
  const regex = new RegExp(pattern, 'i');
  return items.map(parseItem).filter((g) => {
    const name = String(g.name ?? '');
    const email = String(g.email ?? '');
    const description = String(g.description ?? '');
    return regex.test(name) || regex.test(email) || regex.test(description);
  });
}

export async function findGroupsByMemberIdBB(
  userId: string,
): Promise<Record<string, unknown>[]> {
  const items = await backboardStorage.listByType(GROUP_TYPE);
  return items.map(parseItem).filter((g) => {
    const memberIds = (g.memberIds as string[]) ?? [];
    return memberIds.includes(userId);
  });
}

export async function createGroupBB(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const groupId = `grp_${nanoid()}`;
  const groupData: Record<string, unknown> = { ...data, _id: groupId, id: groupId };
  const item = await backboardStorage.createItem(JSON.stringify(groupData), {
    type: GROUP_TYPE,
    groupId,
    idOnTheSource: (data.idOnTheSource as string) ?? '',
  });
  groupData._bbId = item.id;
  return groupData;
}

export async function upsertGroupByExternalIdBB(data: {
  idOnTheSource: string;
  source: string;
  name?: string;
  description?: string;
  email?: string;
  memberIds?: string[];
}): Promise<Record<string, unknown>> {
  const existing = await backboardStorage.findByMetadata(GROUP_TYPE, 'idOnTheSource', data.idOnTheSource);

  if (existing) {
    const current = parseItem(existing);
    const { _bbId: _, ...currentData } = current;
    const merged: Record<string, unknown> = { ...currentData, ...data };
    await backboardStorage.deleteItem(existing.id);
    const newItem = await backboardStorage.createItem(JSON.stringify(merged), {
      type: GROUP_TYPE,
      groupId: (merged._id as string) ?? (merged.id as string) ?? '',
      idOnTheSource: data.idOnTheSource,
    });
    merged._bbId = newItem.id;
    return merged;
  }

  return await createGroupBB(data);
}

export async function addUserToGroupBB(
  groupId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const group = await findGroupByIdBB(groupId);
  if (!group) {
    return null;
  }

  const memberIds = (group.memberIds as string[]) ?? [];
  if (!memberIds.includes(userId)) {
    memberIds.push(userId);
  }

  const bbId = group._bbId as string;
  const { _bbId: _, ...groupData } = group;
  groupData.memberIds = memberIds;

  await backboardStorage.deleteItem(bbId);
  const gid = (groupData._id as string) ?? (groupData.id as string) ?? groupId;
  const newItem = await backboardStorage.createItem(JSON.stringify(groupData), {
    type: GROUP_TYPE,
    groupId: gid,
    idOnTheSource: (groupData.idOnTheSource as string) ?? '',
  });
  groupData._bbId = newItem.id;
  return groupData;
}

export async function removeUserFromGroupBB(
  groupId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const group = await findGroupByIdBB(groupId);
  if (!group) {
    return null;
  }

  const memberIds = (group.memberIds as string[]) ?? [];
  const filtered = memberIds.filter((m) => m !== userId);

  const bbId = group._bbId as string;
  const { _bbId: _, ...groupData } = group;
  groupData.memberIds = filtered;

  await backboardStorage.deleteItem(bbId);
  const gid = (groupData._id as string) ?? (groupData.id as string) ?? groupId;
  const newItem = await backboardStorage.createItem(JSON.stringify(groupData), {
    type: GROUP_TYPE,
    groupId: gid,
    idOnTheSource: (groupData.idOnTheSource as string) ?? '',
  });
  groupData._bbId = newItem.id;
  return groupData;
}

export async function getUserGroupsBB(
  userId: string,
): Promise<Record<string, unknown>[]> {
  return await findGroupsByMemberIdBB(userId);
}

export async function getUserPrincipalsBB(
  params: { userId: string; role?: string | null },
  _session?: unknown,
): Promise<Array<{ principalType: string; principalId?: string }>> {
  const { userId } = params;
  const principals: Array<{ principalType: string; principalId?: string }> = [
    { principalType: 'user', principalId: userId },
  ];

  const groups = await getUserGroupsBB(userId);
  for (const group of groups) {
    const gid = (group._id as string) ?? (group.id as string);
    if (gid) {
      principals.push({ principalType: 'group', principalId: gid });
    }
  }

  principals.push({ principalType: 'public' });
  return principals;
}

export async function syncUserEntraGroupsBB(params: {
  userId: string;
  entraGroups: Array<{ id: string; name: string; description?: string; email?: string }>;
}): Promise<{
  addedGroups: Record<string, unknown>[];
  removedGroups: Record<string, unknown>[];
}> {
  const addedGroups: Record<string, unknown>[] = [];
  const removedGroups: Record<string, unknown>[] = [];
  const entraIdMap = new Set<string>();

  for (const entraGroup of params.entraGroups) {
    entraIdMap.add(entraGroup.id);
    let group = await findGroupByExternalIdBB(entraGroup.id);

    if (!group) {
      group = await createGroupBB({
        name: entraGroup.name,
        description: entraGroup.description,
        email: entraGroup.email,
        idOnTheSource: entraGroup.id,
        source: 'entra',
        memberIds: [params.userId],
      });
      addedGroups.push(group);
    } else {
      const memberIds = (group.memberIds as string[]) ?? [];
      if (!memberIds.includes(params.userId)) {
        const updated = await addUserToGroupBB(
          (group._id as string) ?? (group.id as string),
          params.userId,
        );
        if (updated) {
          addedGroups.push(updated);
        }
      }
    }
  }

  const userGroups = await findGroupsByMemberIdBB(params.userId);
  for (const group of userGroups) {
    if (group.source !== 'entra') {
      continue;
    }
    const externalId = group.idOnTheSource as string;
    if (externalId && !entraIdMap.has(externalId)) {
      const removed = await removeUserFromGroupBB(
        (group._id as string) ?? (group.id as string),
        params.userId,
      );
      if (removed) {
        removedGroups.push(removed);
      }
    }
  }

  return { addedGroups, removedGroups };
}

export async function searchPrincipalsBB(params: {
  searchPattern: string;
  limitPerType?: number;
  typeFilter?: string[] | null;
}): Promise<Record<string, unknown>[]> {
  if (!params.searchPattern || params.searchPattern.trim().length === 0) {
    return [];
  }

  const results: Record<string, unknown>[] = [];
  const regex = new RegExp(params.searchPattern.trim(), 'i');
  const limit = params.limitPerType ?? 10;

  if (!params.typeFilter || params.typeFilter.includes('group')) {
    const groups = await findGroupsByNamePatternBB(params.searchPattern);
    for (const group of groups.slice(0, limit)) {
      results.push({
        id: (group._id as string) ?? (group.id as string),
        type: 'group',
        name: group.name,
        email: group.email,
        description: group.description,
        source: group.source ?? 'local',
      });
    }
  }

  if (!params.typeFilter || params.typeFilter.includes('role')) {
    const roles = await listRolesBB();
    const matchingRoles = roles.filter((r) => regex.test(String(r.name ?? '')));
    for (const role of matchingRoles.slice(0, limit)) {
      results.push({
        id: role.name,
        type: 'role',
        name: role.name,
        source: 'local',
      });
    }
  }

  return results;
}
