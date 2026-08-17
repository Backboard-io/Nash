import type { IPromptGroup as IPromptGroup } from '@librechat/data-schemas';

export interface PromptGroupsListResponse {
  promptGroups: IPromptGroup[];
  pageNumber: string;
  pageSize: string;
  pages: string;
  has_more: boolean;
  after: string | null;
}

export interface PromptGroupsAllResponse {
  data: IPromptGroup[];
}

export interface AccessiblePromptGroupsResult {
  object: 'list';
  data: IPromptGroup[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
  after: string | null;
}
