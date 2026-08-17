import { useMemo, useRef, useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { NotificationSeverity } from '~/common';
import { UploadIcon, AlertCircleIcon, RefreshIcon } from '~/components/svg/NashMemoriesIcons';
import { matchSorter } from 'match-sorter';
import {
  SystemRoles,
  PermissionTypes,
  Permissions,
  QueryKeys,
  request,
  apiBaseUrl,
} from 'librechat-data-provider';
import { useQueries } from '@tanstack/react-query';
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
  useFoldersQuery,
} from '~/data-provider';
import type { ScopedMemory } from './types';
import { useLocalize, useAuthContext, useHasAccess } from '~/hooks';
import { cn } from '~/utils';
import MemoryImportDialog from './MemoryImportDialog';
import MemoryCreateDialog from './MemoryCreateDialog';
import MemoryUsageBadge from './MemoryUsageBadge';
import AdminSettings from './AdminSettings';
import MemoryList from './MemoryList';
import SearchField from '~/components/ui/SearchField';
import MemoryFilterTabs, { type MemoryScope } from './MemoryFilterTabs';
import {
  SortMenu,
  ViewToggle,
  type BookmarkView,
} from '~/components/SidePanel/Bookmarks/BookmarkControls';

type MemorySort = 'recent' | 'oldest' | 'longest';
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
  const [view, setView] = useState<BookmarkView>('list');
  const [sort, setSort] = useState<MemorySort>('recent');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [referenceSavedMemories, setReferenceSavedMemories] = useState(true);

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

  /**
   * Memory being off is a state, not an event — §8 rule 2: it returns whenever
   * the page is opened while it is still off, and dismissing it only covers
   * this visit. Warning severity, no auto-dismiss, and it does not fire on the
   * toggle itself (that already toasts "Preferences updated").
   */
  const announcedOff = useRef(false);
  useEffect(() => {
    if (referenceSavedMemories || announcedOff.current || userData == null) {
      return;
    }
    announcedOff.current = true;
    showToast({
      message: localize('com_ui_memories_off_notice'),
      severity: NotificationSeverity.WARNING,
      duration: 100000,
    });
  }, [referenceSavedMemories, userData, showToast, localize]);

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

  const { data: foldersData } = useFoldersQuery();
  const folders = useMemo(() => foldersData ?? [], [foldersData]);
  const folderMemoryQueries = useQueries({
    queries: folders.map((folder) => ({
      queryKey: [QueryKeys.folders, folder.folderId, 'memories'],
      queryFn: () =>
        request.get(
          `${apiBaseUrl()}/api/folders/${folder.folderId}/memories`,
        ) as Promise<{ memories: TUserMemory[] }>,
      refetchOnWindowFocus: false,
    })),
  });

  const globalMemories: ScopedMemory[] = useMemo(
    () => (memData?.memories ?? []).map((m) => ({ ...m, scope: 'global' as const })),
    [memData],
  );
  const workspaceMemories: ScopedMemory[] = useMemo(
    () =>
      folders.flatMap((folder, index) =>
        (folderMemoryQueries[index]?.data?.memories ?? []).map((m) => ({
          ...m,
          scope: 'workspace' as const,
          folderId: folder.folderId,
          folderName: folder.name,
        })),
      ),
    /* `dataUpdatedAt`, not `data`. Joining the data objects produced
       "[object Object]|[object Object]" — a string that is identical before
       and after a memory is added, so this memo never recomputed and a newly
       created workspace memory did not appear until a full reload.
       `dataUpdatedAt` is a timestamp React Query bumps on every write. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folders, folderMemoryQueries.map((q) => q.dataUpdatedAt).join('|')],
  );

  const memories: ScopedMemory[] = useMemo(
    () => [...globalMemories, ...workspaceMemories],
    [globalMemories, workspaceMemories],
  );

  const filteredMemories = useMemo(() => {
    return matchSorter(memories, searchQuery, {
      keys: ['value'],
      threshold: matchSorter.rankings.CONTAINS,
    });
  }, [memories, searchQuery]);

  /* Persona and Chat still have no backing data — personas carry an assistant
     id but the API has no memories route for one, and chat memories are
     written by the model rather than stored per conversation. Both surface the
     scope-empty state rather than fabricated rows. */
  const visibleMemories = useMemo(() => {
    if (activeScope === 'all') {
      return filteredMemories;
    }
    if (activeScope === 'global' || activeScope === 'workspace') {
      return filteredMemories.filter((m) => m.scope === activeScope);
    }
    return [] as ScopedMemory[];
  }, [filteredMemories, activeScope]);

  const sortedMemories = useMemo(() => {
    const time = (m: ScopedMemory) => new Date(m.updated_at || 0).getTime();
    const rows = [...visibleMemories];
    if (sort === 'oldest') {
      return rows.sort((a, b) => time(a) - time(b));
    }
    if (sort === 'longest') {
      return rows.sort((a, b) => (b.tokenCount ?? 0) - (a.tokenCount ?? 0));
    }
    return rows.sort((a, b) => time(b) - time(a));
  }, [visibleMemories, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedMemories.length / pageSize));

  const currentRows = useMemo(() => {
    return sortedMemories.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  }, [sortedMemories, pageIndex]);

  // Reset page when search or scope changes
  useEffect(() => {
    setPageIndex(0);
  }, [searchQuery, activeScope, sort]);

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

  /* §4 `.primary.sm` — the same button "New folder", "Create Persona" and
     "+ New" are. §1: accent is not the colour of buttons, and this one was the
     only purple thing on the page. */
  /* The page's create action, icon only — a `+` at the top right is where
     every page puts it, so the word restated the position. The label lives in
     `aria-label` and the tooltip. */
  const primaryButtonClass =
    'grid size-[39px] shrink-0 place-items-center rounded-[10px] bg-text-primary text-surface-primary transition-opacity hover:opacity-90 focus:outline-none';

  const emptyVariant: MemoryEmptyVariant =
    searchQuery.length > 0
      ? 'no-results'
      : activeScope !== 'all' && activeScope !== 'global'
        ? 'scope-empty'
        : 'empty';

  return (
    <div role="region" aria-label={localize('com_ui_memories')}>
      <div className="flex flex-col">
        {/* The same header the other three pages use: a 30/600 title over a
            13.5 sub with the primary hard right, wrapping to its own row on
            narrow screens. `h-full` on the wrapper and a `gap-5` header were
            the two things still spacing this page differently. */}
        <header className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[30px] font-semibold leading-[38px] tracking-[-0.5px] text-text-primary">
              {localize('com_ui_memories')}
            </h2>
            <p className="mt-[7px] max-w-2xl text-[13.5px] leading-[20px] text-text-secondary-alt">
              {localize('com_ui_memories_subtitle')}
            </p>
          </div>
          {hasCreateAccess && (
            <MemoryCreateDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <OGDialogTrigger asChild>
                <button
                  type="button"
                  className={primaryButtonClass}
                  aria-label={localize('com_ui_add_memory')}
                  title={localize('com_ui_add_memory')}
                  onClick={openCreateDialog}
                >
                  <Plus size={17} aria-hidden="true" />
                </button>
              </OGDialogTrigger>
            </MemoryCreateDialog>
          )}
        </header>

        {isError && memories.length > 0 && (
          /* §1: nothing outside tokens.css writes a hex. This banner had four
             of them inline. */
          <div className="mt-4 flex h-[53px] items-center gap-3 rounded-[10px] border border-border-destructive bg-surface-destructive-subtle py-[11px] pl-[14px] pr-3">
            <AlertCircleIcon size={17} className="shrink-0 text-text-destructive" />
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[19.5px] text-text-destructive">
              {localize('com_ui_memories_stale')}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="flex h-[31px] shrink-0 items-center gap-1.5 rounded-[7px] border border-border-destructive pl-2.5 pr-3 text-[12px] font-medium leading-[18px] text-text-destructive transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <RefreshIcon size={13} />
              {localize('com_ui_retry')}
            </button>
          </div>
        )}

        {/* Search · import — §6's standard row at the standard 20 below the
            header. The field was a fourth hand-written search box: 38 tall,
            radius 9, 12.5px, where the standard is 40 / 10 / 13. */}
        <div className="flex items-center gap-[10px] pt-[20px]">
          <SearchField
            value={searchQuery}
            onChange={setSearchQuery}
            onClear={() => setSearchQuery('')}
            placeholder={localize('com_ui_search_memories')}
          />
          <SortMenu
            sort={sort}
            onChange={setSort}
            options={[
              { key: 'recent', label: localize('com_ui_bookmarks_sort_recent') },
              { key: 'oldest', label: localize('com_ui_bookmarks_sort_oldest') },
              { key: 'longest', label: localize('com_ui_memories_sort_longest') },
            ]}
          />
          <ViewToggle view={view} onChange={setView} />
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
                      /* §4 `.iconbtn.boxed` — a lone icon action beside a
                         field, sized to the field it sits next to. */
                      className="size-10 shrink-0 rounded-[10px] bg-surface-secondary text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      aria-label={localize('com_ui_memory_import_title')}
                      onClick={() => setImportDialogOpen(true)}
                    >
                      <UploadIcon size={16} />
                    </Button>
                  }
                />
              </OGDialogTrigger>
            </MemoryImportDialog>
          )}
        </div>

        {/* Use-memory toggle */}
        {/* On the same 4px ladder as everything else on the page. */}
        <div className="flex items-center justify-between gap-3 pt-4">
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
        </div>

        {/* Scope filter tabs, on the standard `pb-1 pt-4` and with the label
            the other three pages carry — a bare row of pills reads as tabs you
            are inside of rather than a narrowing of the list below. */}
        <div className="flex items-center gap-2 pb-1 pt-4">
          <span className="shrink-0 text-[12.5px] leading-[19px] text-text-secondary-alt">
            {localize('com_ui_filter')}
          </span>
          {/* Counts follow the same rule as the rows: every Nash memory is a
              user-level fact today, so All and Global hold them and the other
              scopes are genuinely empty rather than showing a stale number. */}
          <MemoryFilterTabs
            active={activeScope}
            onChange={setActiveScope}
            counts={{
              all: memories.length,
              global: memories.length,
              workspace: 0,
              persona: 0,
              chat: 0,
            }}
          />
        </div>

        {/* Token-usage indicator (only when a limit is configured) */}
        {memData?.tokenLimit != null && (
          <div className="pt-4">
          <MemoryUsageBadge
            percentage={memData.usagePercentage ?? 0}
            tokenLimit={memData.tokenLimit}
            totalTokens={memData.totalTokens}
          />
          </div>
        )}

        {/* Memory List — the content gap every page uses.
            With memory off the rows fade to say they are not in play, but stay
            fully interactive: they are still yours to read, edit and delete.
            §4's disabled treatment is for controls that do nothing; these do.
            The fade is on the rows only, so the ⋯ menus and their buttons keep
            their normal colour and remain legible. */}
        <div
          className={cn(
            'pt-[22px] transition-opacity duration-hover',
            !referenceSavedMemories && 'opacity-60',
          )}
        >
        <MemoryList
          memories={currentRows}
          hasUpdateAccess={hasUpdateAccess}
          isLoading={isLoading}
          isError={isError}
          emptyVariant={emptyVariant}
          onRetry={() => refetch()}
          onAddMemory={hasCreateAccess ? openCreateDialog : undefined}
          view={view}
        />
        </div>

        {/* Footer: Admin Settings + Pagination (stacked, left-aligned per Figma) */}
        {(user?.role === SystemRoles.ADMIN || visibleMemories.length > pageSize) && (
          <div className="flex flex-col items-start gap-3 pt-5">
            {user?.role === SystemRoles.ADMIN && <AdminSettings />}

            {visibleMemories.length > pageSize && (
              <div className="flex items-center gap-2" role="navigation" aria-label="Pagination">
                <button
                  type="button"
                  onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                  disabled={pageIndex === 0}
                  aria-label={localize('com_ui_prev')}
                  /* §3: a pager button is radius 9, and the same button in
                     both directions. These were radius 6 with two inline hexes
                     for their fill, which §1 rules out — and the disabled one
                     lost its shape entirely, so the pair read as one button and
                     one label. Now: §4's disabled opacity .42. */
                  className={cn('inline-flex h-8 items-center justify-center rounded-[9px] px-3.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none disabled:cursor-default disabled:opacity-[.42] disabled:hover:bg-transparent disabled:hover:text-text-secondary')}
                >
                  {localize('com_ui_prev')}
                </button>
                <div className="whitespace-nowrap text-[13px] leading-[19.5px] text-text-secondary-alt" aria-live="polite">
                  {pageIndex + 1} / {totalPages}
                </div>
                <button
                  type="button"
                  onClick={() => setPageIndex((prev) => (prev + 1 < totalPages ? prev + 1 : prev))}
                  disabled={pageIndex + 1 >= totalPages}
                  aria-label={localize('com_ui_next')}
                  className={cn('inline-flex h-8 items-center justify-center rounded-[9px] px-3.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none disabled:cursor-default disabled:opacity-[.42] disabled:hover:bg-transparent disabled:hover:text-text-secondary')}
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
