import { SystemCategories } from 'librechat-data-provider';
import type { IPromptGroupDocument as IPromptGroup } from '@librechat/data-schemas';
import type { PromptGroupsListResponse } from '~/types';
import { escapeRegExp } from '~/utils/common';

export function formatPromptGroupsResponse({
  promptGroups = [],
  pageNumber,
  pageSize,
  actualLimit,
  hasMore = false,
  after = null,
}: {
  promptGroups: IPromptGroup[];
  pageNumber?: string;
  pageSize?: string;
  actualLimit?: string | number;
  hasMore?: boolean;
  after?: string | null;
}): PromptGroupsListResponse {
  const currentPage = parseInt(pageNumber || '1');

  const totalPages = hasMore ? '9999' : currentPage.toString();

  return {
    promptGroups,
    pageNumber: pageNumber || '1',
    pageSize: pageSize || String(actualLimit) || '10',
    pages: totalPages,
    has_more: hasMore,
    after,
  };
}

export function createEmptyPromptGroupsResponse({
  pageNumber,
  pageSize,
  actualLimit,
}: {
  pageNumber?: string;
  pageSize?: string;
  actualLimit?: string | number;
}): PromptGroupsListResponse {
  return {
    promptGroups: [],
    pageNumber: pageNumber || '1',
    pageSize: pageSize || String(actualLimit) || '10',
    pages: '0',
    has_more: false,
    after: null,
  };
}

export function markPublicPromptGroups(
  promptGroups: IPromptGroup[],
  publiclyAccessibleIds: string[],
): IPromptGroup[] {
  if (!promptGroups.length) {
    return [];
  }

  const publicIdSet = new Set(publiclyAccessibleIds.map(String));

  return promptGroups.map((group) => {
    const isPublic = publicIdSet.has(String(group._id));
    return isPublic ? ({ ...group, isPublic: true } as IPromptGroup) : group;
  });
}

export function buildPromptGroupFilter({
  name,
  category,
  ...otherFilters
}: {
  name?: string;
  category?: string;
  [key: string]: string | number | boolean | RegExp | undefined;
}): {
  filter: Record<string, string | number | boolean | RegExp | undefined>;
  searchShared: boolean;
  searchSharedOnly: boolean;
} {
  const filter: Record<string, string | number | boolean | RegExp | undefined> = {
    ...otherFilters,
  };
  let searchShared = true;
  let searchSharedOnly = false;

  if (name) {
    filter.name = new RegExp(escapeRegExp(name), 'i');
  }

  if (category === SystemCategories.MY_PROMPTS) {
    searchShared = false;
  } else if (category === SystemCategories.NO_CATEGORY) {
    filter.category = '';
  } else if (category === SystemCategories.SHARED_PROMPTS) {
    searchSharedOnly = true;
  } else if (category) {
    filter.category = category;
  }

  return { filter, searchShared, searchSharedOnly };
}

export async function filterAccessibleIdsBySharedLogic({
  accessibleIds,
  searchShared,
  searchSharedOnly,
  publicPromptGroupIds,
}: {
  accessibleIds: string[];
  searchShared: boolean;
  searchSharedOnly: boolean;
  publicPromptGroupIds?: string[];
}): Promise<string[]> {
  const publicIdStrings = new Set((publicPromptGroupIds || []).map(String));

  if (!searchShared) {
    return accessibleIds.filter((id) => !publicIdStrings.has(String(id)));
  }

  if (searchSharedOnly) {
    if (!publicPromptGroupIds?.length) {
      return [];
    }
    const accessibleIdStrings = new Set(accessibleIds.map(String));
    return publicPromptGroupIds.filter((id) => accessibleIdStrings.has(String(id)));
  }

  return [...accessibleIds, ...(publicPromptGroupIds || [])];
}
