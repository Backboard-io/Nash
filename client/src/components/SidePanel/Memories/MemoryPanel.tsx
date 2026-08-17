import { useMemo, useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
import { UploadIcon, AlertCircleIcon, RefreshIcon } from '~/components/svg/NashMemoriesIcons';
import { matchSorter } from 'match-sorter';
import { SystemRoles, PermissionTypes, Permissions, LocalStorageKeys } from 'librechat-data-provider';
import {
  Button,
  Switch,
  TooltipAnchor,
  OGDialogTrigger,
  useToastContext,
} from '@librechat/client';
import type { TUserMemory } from 'librechat-data-provider';
import {
  useUpdateMemoryPreferencesMutation,
  useMemoriesQuery,
  useGetUserQuery,
} from '~/data-provider';
import { useLocalize, useAuthContext, useHasAccess } from '~/hooks';
import { cn } from '~/utils';
import { getTimestampedValue, setTimestampedValue } from '~/utils/timestamps';
import MemoryImportDialog from './MemoryImportDialog';
import MemoryCreateDialog from './MemoryCreateDialog';
import MemoryUsageBadge from './MemoryUsageBadge';
import AdminSettings from './AdminSettings';
import MemoryList from './MemoryList';
import MemoryFilterTabs, { type MemoryScope } from './MemoryFilterTabs';
import { type MemoryEmptyVariant } from './MemoryEmptyState';

const pageSize = 10;

export default function MemoryPanel() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { data: userData } = useGetUserQuery();
  const { data: memData, isLoading, isError, refetch } = useMemoriesQuery();
  const { showToast } = useToastContext();
  const [pageIndex, setPageIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeScope, setActiveScope] = useState<MemoryScope>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [referenceSavedMemories, setReferenceSavedMemories] = useState(true);
  const webSearchStorageKey = `${LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_}new`;
  const [webSearchDefault, setWebSearchDefault] = useState<boolean>(() => {
    try {
      return JSON.parse(getTimestampedValue(webSearchStorageKey) ?? 'false') === true;
    } catch {
      return false;
    }
  });
  const handleWebSearchToggle = (checked: boolean) => {
    setWebSearchDefault(checked);
    setTimestampedValue(webSearchStorageKey, JSON.stringify(checked));
  };

  const updateMemoryPreferencesMutation = useUpdateMemoryPreferencesMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_preferences_updated'),
        status: 'success',
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_error_updating_preferences'),
        status: 'error',
      });
      setReferenceSavedMemories((prev) => !prev);
    },
  });

  useEffect(() => {
    if (userData?.personalization?.memories !== undefined) {
      setReferenceSavedMemories(userData.personalization.memories);
    }
  }, [userData?.personalization?.memories]);

  const handleMemoryToggle = (checked: boolean) => {
    setReferenceSavedMemories(checked);
    updateMemoryPreferencesMutation.mutate({ memories: checked });
  };

  const hasReadAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.READ,
  });

  const hasUpdateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.UPDATE,
  });

  const hasCreateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.CREATE,
  });

  const hasOptOutAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.OPT_OUT,
  });

  const memories: TUserMemory[] = useMemo(() => memData?.memories ?? [], [memData]);

  const filteredMemories = useMemo(() => {
    return matchSorter(memories, searchQuery, {
      keys: ['value'],
      threshold: matchSorter.rankings.CONTAINS,
    });
  }, [memories, searchQuery]);

  // Every Nash memory is a global, user-level fact today, so "Global" is a superset
  // of "All". Workspace/Persona/Chat have no backing data yet and therefore surface
  // the scope-empty state instead of fabricated rows.
  const visibleMemories = useMemo(() => {
    if (activeScope === 'all' || activeScope === 'global') {
      return filteredMemories;
    }
    return [] as TUserMemory[];
  }, [filteredMemories, activeScope]);

  const totalPages = Math.max(1, Math.ceil(visibleMemories.length / pageSize));

  const currentRows = useMemo(() => {
    return visibleMemories.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  }, [visibleMemories, pageIndex]);

  // Reset page when search or scope changes
  useEffect(() => {
    setPageIndex(0);
  }, [searchQuery, activeScope]);

  // Clamp page if the result set shrinks (e.g. after a delete on the last page)
  useEffect(() => {
    if (pageIndex > totalPages - 1) {
      setPageIndex(totalPages - 1);
    }
  }, [pageIndex, totalPages]);

  if (!hasReadAccess) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-text-secondary">{localize('com_ui_no_read_access')}</p>
        </div>
      </div>
    );
  }

  const openCreateDialog = () => setCreateDialogOpen(true);

  const tealButtonClass =
    'inline-flex h-[41px] items-center justify-center gap-2 rounded-[10px] bg-brand-purple pl-4 pr-5 text-[14px] font-medium leading-[21px] text-brand-purple-foreground transition-colors hover:bg-brand-purple-hover active:bg-brand-purple-pressed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  const emptyVariant: MemoryEmptyVariant =
    searchQuery.length > 0
      ? 'no-results'
      : activeScope !== 'all' && activeScope !== 'global'
        ? 'scope-empty'
        : 'empty';

  return (
    <div className="flex h-full w-full flex-col">
      <div role="region" aria-label={localize('com_ui_memories')} className="flex flex-col">
        {/* Header: Title + Subtitle + Add memory */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="text-[28px] font-semibold leading-[42px] text-text-primary">
              {localize('com_ui_memories')}
            </h2>
            <p className="text-[14px] leading-[21px] text-text-secondary-alt">
              {localize('com_ui_memories_subtitle')}
            </p>
          </div>
          {hasCreateAccess && (
            <MemoryCreateDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <OGDialogTrigger asChild>
                <button
                  type="button"
                  className={tealButtonClass + ' shrink-0'}
                  aria-label={localize('com_ui_add_memory')}
                  onClick={openCreateDialog}
                >
                  <Plus size={16} aria-hidden="true" />
                  {localize('com_ui_add_memory')}
                </button>
              </OGDialogTrigger>
            </MemoryCreateDialog>
          )}
        </div>

        {isError && memories.length > 0 && (
          <div className="mt-4 flex h-[53px] items-center gap-3 rounded-[10px] border border-[#F4A0AE] bg-[#FDE8EF] py-[11px] pl-[14px] pr-3 dark:border-[#8B2238] dark:bg-[#2D1520]">
            <AlertCircleIcon size={17} className="shrink-0 text-text-destructive" />
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[19.5px] text-text-destructive">
              {localize('com_ui_memories_stale')}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="flex h-[31px] shrink-0 items-center gap-1.5 rounded-[7px] border border-[#F4A0AE] pl-2.5 pr-3 text-[12px] font-medium leading-[18px] text-text-destructive transition-colors hover:bg-black/5 dark:border-[#8B2238] dark:hover:bg-white/5"
            >
              <RefreshIcon size={13} />
              {localize('com_ui_retry')}
            </button>
          </div>
        )}

        {/* Search + import */}
        <div className="mt-6 flex items-center gap-3">
          <div className="relative flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 text-text-secondary"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={localize('com_ui_search_memories')}
              aria-label={localize('com_ui_search_memories')}
              className="h-[42px] w-full rounded-[10px] border border-border-light bg-surface-secondary pl-10 pr-[14px] text-[13.5px] leading-[20.25px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {hasCreateAccess && (
            <MemoryImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
              <OGDialogTrigger asChild>
                <TooltipAnchor
                  description={localize('com_ui_memory_import_title')}
                  side="bottom"
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-[38px] shrink-0 rounded-[8px] bg-surface-secondary text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      aria-label={localize('com_ui_memory_import_title')}
                      onClick={() => setImportDialogOpen(true)}
                    >
                      <UploadIcon size={18} />
                    </Button>
                  }
                />
              </OGDialogTrigger>
            </MemoryImportDialog>
          )}
        </div>

        {/* Use-memory toggle */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-3">
              <p className="text-[14px] font-medium leading-[21px] text-text-primary">
                {localize('com_ui_use_memory')}
              </p>
              {hasOptOutAccess && (
                <Switch
                  checked={referenceSavedMemories}
                  onCheckedChange={handleMemoryToggle}
                  aria-label={localize('com_ui_use_memory')}
                  disabled={updateMemoryPreferencesMutation.isLoading}
                  className="shrink-0 data-[state=checked]:bg-brand-purple"
                />
              )}
            </div>
            <p className="text-[12.5px] leading-[18.75px] text-text-secondary-alt">
              {localize('com_ui_use_memory_desc')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="text-[13px] font-medium leading-[19.5px] text-text-primary">
              {localize('com_ui_web_search')}
            </span>
            <Switch
              checked={webSearchDefault}
              onCheckedChange={handleWebSearchToggle}
              aria-label={localize('com_ui_web_search')}
              className="shrink-0 data-[state=checked]:bg-brand-purple"
            />
          </div>
        </div>

        {/* Scope filter tabs */}
        <div className="mt-4">
          <MemoryFilterTabs active={activeScope} onChange={setActiveScope} />
        </div>

        {/* Token-usage indicator (only when a limit is configured) */}
        {memData?.tokenLimit != null && (
          <div className="mt-4">
          <MemoryUsageBadge
            percentage={memData.usagePercentage ?? 0}
            tokenLimit={memData.tokenLimit}
            totalTokens={memData.totalTokens}
          />
          </div>
        )}

        {/* Memory List */}
        <div className="mt-4">
        <MemoryList
          memories={currentRows}
          hasUpdateAccess={hasUpdateAccess}
          isLoading={isLoading}
          isError={isError}
          emptyVariant={emptyVariant}
          onRetry={() => refetch()}
          onAddMemory={hasCreateAccess ? openCreateDialog : undefined}
        />
        </div>

        {/* Footer: Admin Settings + Pagination (stacked, left-aligned per Figma) */}
        {(user?.role === SystemRoles.ADMIN || visibleMemories.length > pageSize) && (
          <div className="mt-5 flex flex-col items-start gap-3">
            {user?.role === SystemRoles.ADMIN && <AdminSettings />}

            {visibleMemories.length > pageSize && (
              <div className="flex items-center gap-2" role="navigation" aria-label="Pagination">
                <button
                  type="button"
                  onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                  disabled={pageIndex === 0}
                  aria-label={localize('com_ui_prev')}
                  className={cn(
                    'h-[31px] rounded-[6px] px-3 text-[12.5px] leading-[18.75px] transition-colors',
                    pageIndex === 0
                      ? 'cursor-default text-text-secondary-alt'
                      : 'bg-[#ECEDEF] font-medium text-text-primary hover:bg-surface-hover dark:bg-[#181A1E]',
                  )}
                >
                  {localize('com_ui_prev')}
                </button>
                <div className="whitespace-nowrap text-[13px] leading-[19.5px] text-text-primary" aria-live="polite">
                  {pageIndex + 1} / {totalPages}
                </div>
                <button
                  type="button"
                  onClick={() => setPageIndex((prev) => (prev + 1 < totalPages ? prev + 1 : prev))}
                  disabled={pageIndex + 1 >= totalPages}
                  aria-label={localize('com_ui_next')}
                  className={cn(
                    'h-[31px] rounded-[6px] px-3 text-[12.5px] leading-[18.75px] transition-colors',
                    pageIndex + 1 >= totalPages
                      ? 'cursor-default text-text-secondary-alt'
                      : 'bg-[#ECEDEF] font-medium text-text-primary hover:bg-surface-hover dark:bg-[#181A1E]',
                  )}
                >
                  {localize('com_ui_next')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
