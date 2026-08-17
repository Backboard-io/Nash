import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSetRecoilState } from 'recoil';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Code,
  Download,
  Eye,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import {
  Table,
  Button,
  Spinner,
  Checkbox,
  TableRow,
  TrashIcon,
  TableHead,
  TableBody,
  TableCell,
  FileUpload,
  TableHeader,
  TooltipAnchor,
  useMediaQuery,
} from '@librechat/client';
import {
  flexRender,
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type Column,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { FileSources, FileContext, getSessionKey } from 'librechat-data-provider';
import type { TFile } from 'librechat-data-provider';
import { useLocalize, useFileHandling } from '~/hooks';
import { useDeleteFilesFromTable } from '~/hooks/Files';
import { useChatContext } from '~/Providers';
import ImagePreview from '~/components/Chat/Input/Files/ImagePreview';
import FilePreview from '~/components/Chat/Input/Files/FilePreview';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { OGDialog, OGDialogTemplate } from '@librechat/client';
import { useGetFiles } from '~/data-provider';
import SearchField from '~/components/ui/SearchField';
import EmptyState from '~/components/ui/EmptyState';
import FileRowMenu from './FileRowMenu';
import FilterPill from '~/components/ui/FilterPill';
import { ViewToggle } from '~/components/SidePanel/Bookmarks/BookmarkControls';
import { formatDate, getFileType, cn } from '~/utils';
import store from '~/store';

export type FileTab = 'all' | 'images' | 'files';

type FilesContentProps = {
  initialTab?: FileTab;
  controlledTab?: FileTab;
  showTabs?: boolean;
  title?: string;
  subtitle?: string;
  regionLabel?: string;
  /** Called instead of the internal tab state when a filter chip is picked. */
  onTabChange?: (tab: FileTab) => void;
  /**
   * A side panel rendered beside the table, below the page controls.
   *
   * It is passed in rather than sitting outside this component so the header,
   * search and filter strip get the page's full width — a rail that is a
   * sibling of the whole column squeezes the search field for the entire height
   * of the page, including the part of it that has nothing beside it.
   */
  rail?: React.ReactNode;
};

const isImageFile = (file?: TFile) => file?.type?.startsWith('image') === true;

/**
 * Types a browser will actually render inside an iframe.
 *
 * Anything else — .docx, .xlsx, .zip — makes the iframe fire a **download**
 * instead, so opening the preview quietly saved the file to disk. Clicking a
 * filename should preview and nothing else; downloading is a separate,
 * deliberate action in the row menu.
 */
const isInlineRenderable = (file?: TFile) => {
  const mime = (file?.type ?? '').split(';', 1)[0].trim().toLowerCase();
  return (
    mime === 'application/pdf' ||
    mime === 'application/json' ||
    mime === 'image/svg+xml' ||
    mime.startsWith('text/')
  );
};

function formatSize(bytes?: number): string {
  if (bytes == null || !Number.isFinite(Number(bytes))) {
    return '—';
  }
  const value = Number(bytes);
  if (value < 1024) {
    return `${Math.max(0, Math.round(value))} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `${(mb / 1024).toFixed(1)} GB`;
}

function dirKeyFromUploadPath(src: string): string {
  const marker = '/uploads/';
  const markerIndex = src.indexOf(marker);
  if (markerIndex < 0) {
    return '';
  }
  const remainder = src.slice(markerIndex + marker.length);
  return remainder.split('/')[0] ?? '';
}

/**
 * Resolves the URL a file can actually be fetched from. `filepath` for local-source files is an
 * unservable `/uploads/<dirKey>/…` path, so it is rewritten to the authenticated download route;
 * returns `''` when no servable URL exists. Exported so other surfaces (the Library rail) reuse
 * this instead of fetching `filepath` directly.
 */
export function getFileSource(file?: Pick<TFile, 'preview' | 'filepath' | 'file_id'>): string {
  const src = file?.preview || file?.filepath || '';
  if (!src || isBrowserManagedUrl(src) || isNashProtectedFileUrl(src)) {
    return src;
  }

  const dirKey = dirKeyFromUploadPath(src);
  if (dirKey && file?.file_id) {
    return `/api/files/download/${encodeURIComponent(dirKey)}/${encodeURIComponent(file.file_id)}`;
  }

  if (src.startsWith('/')) {
    return '';
  }

  return src;
}

function isBrowserManagedUrl(src: string): boolean {
  return src.startsWith('blob:') || src.startsWith('data:');
}

function isNashProtectedFileUrl(src: string): boolean {
  if (!src || isBrowserManagedUrl(src)) {
    return false;
  }
  try {
    const url = new URL(src, window.location.origin);
    return (
      url.origin === window.location.origin &&
      (url.pathname.startsWith('/api/files/download/') || url.pathname.startsWith('/images/'))
    );
  } catch {
    return src.startsWith('/api/files/download/') || src.startsWith('/images/');
  }
}

function buildSessionHeaders(): Record<string, string> {
  const sessionKey = getSessionKey();
  return sessionKey ? { 'X-Session-Key': sessionKey } : {};
}

async function createAuthenticatedObjectUrl(src: string): Promise<string> {
  const response = await fetch(src, {
    credentials: 'same-origin',
    headers: buildSessionHeaders(),
  });
  if (!response.ok) {
    throw new Error(`File request failed with ${response.status}`);
  }
  return window.URL.createObjectURL(await response.blob());
}

export async function downloadFile(file: TFile): Promise<void> {
  try {
    const src = getFileSource(file);
    if (!src) {
      return;
    }

    let downloadUrl = src;
    let shouldRevoke = false;
    if (isNashProtectedFileUrl(src)) {
      downloadUrl = await createAuthenticatedObjectUrl(src);
      shouldRevoke = true;
    }

    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = file.filename;
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    if (shouldRevoke) {
      window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1_000);
    }
  } catch (error) {
    console.error('[Nash library] file download failed:', file.file_id, error);
  }
}

function useAuthenticatedPreviewUrl(src: string): string {
  const [resolvedSrc, setResolvedSrc] = useState(() => (isNashProtectedFileUrl(src) ? '' : src));

  useEffect(() => {
    if (!src) {
      setResolvedSrc('');
      return;
    }
    if (!isNashProtectedFileUrl(src)) {
      setResolvedSrc(src);
      return;
    }

    let objectUrl = '';
    let cancelled = false;

    createAuthenticatedObjectUrl(src)
      .then((url) => {
        objectUrl = url;
        if (!cancelled) {
          setResolvedSrc(url);
        }
      })
      .catch((error) => {
        console.error('[Nash library] image preview failed:', src, error);
        if (!cancelled) {
          setResolvedSrc('');
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  return resolvedSrc;
}

function AuthenticatedImagePreview({
  file,
  className,
}: {
  file: TFile;
  className?: string;
}) {
  const imageUrl = useAuthenticatedPreviewUrl(getFileSource(file));
  if (!imageUrl) {
    return <FilePreview fileType={getFileType(file.type)} file={file} />;
  }
  return (
    <ImagePreview
      url={imageUrl}
      className={className}
      source={file.source}
      alt={file.filename}
    />
  );
}

function FilePreviewDialog({
  file,
  open,
  onOpenChange,
}: {
  file: TFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const [previewSrc, setPreviewSrc] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!open || !file) {
      setPreviewSrc('');
      setIsLoading(false);
      setErrored(false);
      return;
    }

    const src = getFileSource(file);
    let objectUrl = '';
    let cancelled = false;

    setErrored(false);
    if (!src) {
      setPreviewSrc('');
      return;
    }

    if (!isNashProtectedFileUrl(src)) {
      setPreviewSrc(src);
      setIsLoading(false);
      return;
    }

    setPreviewSrc('');
    setIsLoading(true);
    createAuthenticatedObjectUrl(src)
      .then((url) => {
        objectUrl = url;
        if (!cancelled) {
          setPreviewSrc(url);
          setIsLoading(false);
        }
      })
      .catch((error) => {
        console.error('[Nash library] file preview failed:', file.file_id, error);
        if (!cancelled) {
          setErrored(true);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file, open]);

  const canPreview = Boolean(previewSrc) && !errored;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* §7 `.scrim`: rgba(0,0,0,.6) in dark, not black/80. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[250] bg-[rgba(16,18,24,0.42)] dark:bg-black/60" />
        <DialogPrimitive.Content /* §7: --elevated fill, radius 16, no border in dark — the shadow
             does the work; light gets the inset ring instead. */
          className="fixed inset-4 z-[251] flex flex-col overflow-hidden rounded-2xl bg-surface-hover text-text-primary shadow-[0_10px_28px_rgba(16,18,24,0.14)] ring-1 ring-inset ring-border-light dark:shadow-[0_12px_34px_rgba(0,0,0,0.35)] dark:ring-0 outline-none md:inset-10">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border-light px-4 py-3">
            <DialogPrimitive.Title className="min-w-0 truncate text-base font-semibold">
              {file?.filename ?? localize('com_ui_preview')}
            </DialogPrimitive.Title>
            <div className="flex shrink-0 items-center gap-1">
              {file != null && (
                <TooltipAnchor
                  description={localize('com_ui_download')}
                  render={
                    <button
                      type="button"
                      onClick={() => void downloadFile(file)}
                      className="flex size-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                      aria-label={localize('com_ui_download')}
                    >
                      <Download className="size-4" aria-hidden="true" />
                    </button>
                  }
                />
              )}
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="flex size-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                  aria-label={localize('com_ui_close')}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-primary">
            {isLoading ? (
              <Spinner className="size-6" />
            ) : !canPreview || file == null ? (
              <div className="flex flex-col items-center gap-3 px-6 text-center text-sm text-text-secondary">
                {file != null && <FilePreview fileType={getFileType(file.type)} file={file} />}
                <span>Preview unavailable.</span>
              </div>
            ) : isImageFile(file) ? (
              <img
                src={previewSrc}
                alt={file.filename}
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            ) : isInlineRenderable(file) ? (
              <iframe
                title={file.filename}
                src={previewSrc}
                className="h-full w-full border-0 bg-white"
              />
            ) : (
              /* No inline preview for this type, and deliberately no iframe:
                 an iframe pointed at a .docx downloads it, which turned a
                 preview click into a silent save. Offer the download instead of
                 performing it. */
              <div className="flex flex-col items-center gap-4 px-6 text-center">
                <FilePreview fileType={getFileType(file.type)} file={file} />
                <div>
                  <p className="text-[14px] font-medium text-text-primary">{file.filename}</p>
                  <p className="mt-1 text-[12.5px] text-text-secondary-alt">
                    {localize('com_ui_preview_unavailable')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void downloadFile(file)}
                  className="inline-flex h-[34px] items-center gap-2 rounded-[8px] bg-text-primary px-[16px] text-[13px] font-medium text-surface-primary transition-opacity hover:opacity-90 focus:outline-none"
                >
                  <Download size={15} aria-hidden="true" />
                  {localize('com_ui_download')}
                </button>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Small lucide glyph describing a file's kind. Never pass strokeWidth to lucide. */
function FileTypeIcon({
  file,
  size = 14,
}: {
  file: Pick<TFile, 'type' | 'filename'>;
  size?: number;
}) {
  const mime = (file.type ?? '').split(';')[0].trim().toLowerCase();
  const name = (file.filename ?? '').toLowerCase();
  if (mime === 'image/svg+xml' || name.endsWith('.svg')) {
    return <Code size={size} aria-hidden="true" />;
  }
  if (mime.startsWith('image/')) {
    return <ImageIcon size={size} aria-hidden="true" />;
  }
  if (mime.startsWith('audio/')) {
    return <FileAudio size={size} aria-hidden="true" />;
  }
  if (mime.startsWith('video/')) {
    return <FileVideo size={size} aria-hidden="true" />;
  }
  if (
    mime === 'application/json' ||
    mime === 'text/html' ||
    mime === 'text/css' ||
    mime.startsWith('text/x-') ||
    mime.startsWith('application/x-')
  ) {
    return <Code size={size} aria-hidden="true" />;
  }
  return <FileText size={size} aria-hidden="true" />;
}

/** 28px rounded tile that carries the file-kind glyph in the table's Name column. */
function FileTypeTile({ file }: { file: Pick<TFile, 'type' | 'filename'> }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-text-secondary-alt">
      <FileTypeIcon file={file} />
    </span>
  );
}

type UploadingRow = {
  id: string;
  filename: string;
  size?: number;
  progress: number;
};

/**
 * In-flight upload row. `progress` is the real client upload-pipeline value held in
 * the shared file map — it is milestone based (there is no bytes-transferred callback
 * on the multipart request), so it advances in steps rather than continuously.
 */
function UploadProgressRow({
  row,
  onCancel,
}: {
  row: UploadingRow;
  onCancel: (id: string) => void;
}) {
  const localize = useLocalize();
  const percent = Math.min(100, Math.max(0, Math.round((row.progress ?? 0) * 100)));
  return (
    <div
      data-testid="files-upload-row"
      className="flex h-[42px] items-center gap-3 rounded-[10px] bg-surface-hover pl-3 pr-4"
    >
      {/* §1: never fake a surface with opacity, and accent is not decoration.
          This tile was `bg-brand-purple/10` behind an accent glyph. */}
      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[8px] bg-surface-active text-text-secondary">
        <Upload size={14} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
        {row.filename}
      </span>
      <div
        role="progressbar"
        aria-label={`${localize('com_ui_uploading')} ${row.filename}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="hidden h-1 w-[341px] max-w-[38%] overflow-hidden rounded-full bg-surface-primary-alt md:block"
      >
        <div
          /* Progress is state, but it is not *selection* — §1 keeps accent for
             the one selected thing on a screen. A determinate bar reads fine in
             --t1 and stops competing with the page's real accent. */
          className="h-full rounded-full bg-text-primary transition-[width] duration-swap"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 whitespace-nowrap text-[13px] text-text-tertiary">
        {`${percent}% · ${formatSize(row.size)}`}
      </span>
      <button
        type="button"
        onClick={() => onCancel(row.id)}
        aria-label={localize('com_ui_cancel_upload')}
        className="flex size-6 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-heavy"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Full-page Files/Library experience. Owns the single page header (title, subtitle and
 * the "+ New" upload button), the search + view controls, the All / Images / Files filter
 * chips, the in-flight upload rows and the file table (selection, sorting, bulk delete and
 * pagination all client-side via TanStack).
 */
export function FilesContent({
  initialTab = 'all',
  controlledTab,
  showTabs = true,
  title,
  subtitle,
  regionLabel,
  onTabChange,
  rail,
}: FilesContentProps = {}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<FileTab>(
    controlledTab ??
      (tabParam === 'images' || tabParam === 'files' || tabParam === 'all'
        ? tabParam
        : initialTab),
  );

  useEffect(() => {
    if (controlledTab != null) {
      setActiveTab(controlledTab);
      return;
    }
    if (tabParam === 'images' || tabParam === 'files' || tabParam === 'all') {
      setActiveTab(tabParam);
    }
  }, [controlledTab, initialTab, tabParam]);

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'updatedAt', desc: true }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [{ pageIndex, pageSize }, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<TFile | null>(null);
  const [renameTarget, setRenameTarget] = useState<TFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  useEffect(() => {
    if (renameTarget != null) {
      setRenameValue(renameTarget.filename ?? '');
    }
  }, [renameTarget]);

  /* PATCH /api/files/:id, then refetch the list. Only `filename` is writable —
     the bytes, the Backboard document and the stored path are all keyed off
     file_id, so a rename moves nothing. */
  const submitRename = useCallback(async () => {
    const target = renameTarget;
    const next = renameValue.trim();
    if (target == null || next === '' || next === target.filename) {
      setRenameTarget(null);
      return;
    }
    setIsRenaming(true);
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(target.file_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ filename: next }),
      });
      if (!res.ok) {
        throw new Error(`rename failed: ${res.status}`);
      }
      await queryClient.invalidateQueries([QueryKeys.files]);
    } catch (error) {
      console.error('[Nash library] rename failed:', target.file_id, error);
    } finally {
      setIsRenaming(false);
      setRenameTarget(null);
    }
  }, [renameTarget, renameValue, queryClient]);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const { handleFileChange, abortUpload } = useFileHandling();
  const { files: pendingFileMap, setFiles: setPendingFiles } = useChatContext();

  const setFiles = useSetRecoilState(store.filesByIndex(0));
  const { deleteFiles } = useDeleteFilesFromTable(() => setIsDeleting(false));

  useEffect(() => {
    setRowSelection({});
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [activeTab]);

  const { data: files = [] } = useGetFiles<TFile[]>({
    select: (data) =>
      data.map((file) => {
        file.context = file.context ?? FileContext.unknown;
        file.filterSource = file.source === FileSources.firebase ? FileSources.local : file.source;
        return file;
      }),
  });

  const tabFiltered = useMemo(() => {
    if (activeTab === 'images') {
      return files.filter((file) => isImageFile(file));
    }
    if (activeTab === 'files') {
      return files.filter((file) => !isImageFile(file));
    }
    return files;
  }, [files, activeTab]);

  /**
   * In-flight uploads, read from the same shared file map `useFileHandling` writes to.
   * `progress` reaches 1 when the upload finishes, so anything below 1 is still running.
   */
  const uploadingRows = useMemo<UploadingRow[]>(() => {
    if (!pendingFileMap) {
      return [];
    }
    return Array.from(pendingFileMap.values())
      .filter((entry) => (entry.progress ?? 1) < 1)
      .map((entry) => ({
        id: entry.file_id,
        filename: entry.filename ?? entry.file?.name ?? '',
        size: entry.size ?? entry.file?.size,
        progress: entry.progress ?? 0,
      }));
  }, [pendingFileMap]);

  /**
   * Aborts the in-flight request, not just the row. `useFileHandling` owns one `AbortController`
   * per `handleFiles` batch, so this cancels every upload started in the same batch — the upload
   * mutation's `onError` then drops those entries from the shared map itself.
   */
  const cancelUpload = useCallback(
    (fileId: string) => {
      abortUpload();
      setPendingFiles((current) => {
        const next = new Map(current);
        next.delete(fileId);
        return next;
      });
    },
    [abortUpload, setPendingFiles],
  );

  const handleDelete = useCallback(
    (filesToDelete: TFile[]) => {
      if (!filesToDelete.length || isDeleting) {
        return;
      }
      setIsDeleting(true);
      deleteFiles({ files: filesToDelete, setFiles });
      setRowSelection({});
    },
    [deleteFiles, setFiles, isDeleting],
  );

  const openPreview = useCallback((file: TFile) => {
    if (getFileSource(file)) {
      setPreviewTarget(file);
    }
  }, []);

  const openUploadPicker = useCallback(() => {
    if (!uploadInputRef.current) {
      return;
    }
    uploadInputRef.current.value = '';
    uploadInputRef.current.click();
  }, []);

  const sortHeader = useCallback(
    (label: string, column: Column<TFile, unknown>, align: 'left' | 'right' = 'left') => {
      const sorted = column.getIsSorted();
      const Chevron = sorted === 'asc' ? ChevronUp : sorted === 'desc' ? ChevronDown : ChevronsUpDown;
      return (
        <button
          type="button"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          aria-label={label}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-text-secondary-alt transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-heavy',
            align === 'right' && 'flex-row-reverse',
          )}
        >
          {label}
          <Chevron
            size={14}
            aria-hidden="true"
            className={cn(sorted === false && 'opacity-50')}
          />
        </button>
      );
    },
    [],
  );

  const columns = useMemo<ColumnDef<TFile>[]>(
    () => [
      {
        id: 'select',
        size: 44,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={localize('com_ui_select_all')}
            className="flex size-[18px] rounded-lg"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={localize('com_ui_select_row')}
            className="flex size-[18px] rounded-lg"
          />
        ),
      },
      {
        accessorKey: 'filename',
        header: ({ column }) => sortHeader(localize('com_ui_name'), column),
        cell: ({ row }) => {
          const file = row.original;
          const canOpenFile = getFileSource(file) !== '';
          return (
            <div className="flex min-w-0 items-center gap-[9px]">
              <FileTypeTile file={file} />
              <button
                type="button"
                onClick={() => openPreview(file)}
                disabled={!canOpenFile}
                className="min-w-0 truncate text-left text-sm font-medium text-text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-heavy disabled:cursor-default disabled:hover:no-underline"
              >
                {file.filename}
              </button>
            </div>
          );
        },
      },
      {
        accessorKey: 'updatedAt',
        size: 140,
        header: ({ column }) => sortHeader(localize('com_ui_modified'), column),
        cell: ({ row }) => {
          // Fall back to the created time: rows written before timestamps were
          // stamped carry no updatedAt, and showing a dash for every one of them
          // reads as broken when the file plainly has a date.
          const raw =
            row.original.updatedAt?.toString() || row.original.createdAt?.toString() || '';
          const parsed = raw ? new Date(raw).getTime() : NaN;
          return (
            <span className="whitespace-nowrap text-sm text-text-secondary-alt">
              {Number.isFinite(parsed) ? formatDate(raw, isSmallScreen) : '—'}
            </span>
          );
        },
      },
      {
        accessorKey: 'bytes',
        size: 110,
        header: ({ column }) => (
          <span className="flex justify-end">
            {sortHeader(localize('com_ui_size'), column, 'right')}
          </span>
        ),
        cell: ({ row }) => (
          <span className="block whitespace-nowrap text-right text-sm text-text-secondary-alt">
            {formatSize(row.original.bytes)}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 56,
        enableSorting: false,
        header: () => <span className="sr-only">{localize('com_ui_actions')}</span>,
        cell: ({ row }) => {
          const file = row.original;
          const canOpenFile = getFileSource(file) !== '';
          return (
            <FileRowMenu
              disabled={isDeleting}
              onRename={() => setRenameTarget(file)}
              onDownload={canOpenFile ? () => void downloadFile(file) : undefined}
              onDelete={() => handleDelete([file])}
            />          );
        },
      },
    ],
    [localize, isSmallScreen, isDeleting, handleDelete, sortHeader],
  );

  const table = useReactTable({
    data: tabFiltered,
    columns,
    state: { sorting, rowSelection, globalFilter: search, pagination: { pageIndex, pageSize } },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _columnId, filterValue) =>
      (row.original.filename ?? '').toLowerCase().includes(String(filterValue).toLowerCase()),
    defaultColumn: { size: Number.MAX_SAFE_INTEGER },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const selectedCount = table.getFilteredSelectedRowModel().rows.length;
  const pageRows = table.getRowModel().rows;

  /* Counted from the full list, not the filtered one — a tab has to say how
     much is behind it, which it cannot do from the slice it is already in. */
  const imageCount = useMemo(() => files.filter((file) => isImageFile(file)).length, [files]);
  const tabs: { value: FileTab; label: string; count: number }[] = [
    { value: 'all', label: localize('com_ui_all_proper'), count: files.length },
    { value: 'images', label: localize('com_ui_images'), count: imageCount },
    { value: 'files', label: localize('com_ui_files'), count: files.length - imageCount },
  ];

  const contentTitle = title ?? localize('com_ui_files');
  const contentSubtitle = subtitle ?? localize('com_ui_files_subtitle');
  const contentRegionLabel = regionLabel ?? contentTitle;

  const uploadSection =
    uploadingRows.length > 0 ? (
      <div className="space-y-0.5">
        {uploadingRows.map((row) => (
          <UploadProgressRow key={row.id} row={row} onCancel={cancelUpload} />
        ))}
      </div>
    ) : null;

  return (
    /* No `pt-2` and no blanket `space-y-4`: the page shell owns the top
       padding now, and each block below carries the same spacing Bookmarks
       gives it (20 above the search row, 16 above the filter strip). A
       container-level space-y on top of those was adding a second opinion. */
    <div role="region" aria-label={contentRegionLabel}>
      {/* Single page header: title + subtitle + primary "New" action */}
      <header className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          {/* The Bookmarks page header, to the character — 30/38 at -0.5
              tracking over a 13.5 subtitle. This was 28/tight over 14. */}
          <h1 className="text-[30px] font-semibold leading-[38px] tracking-[-0.5px] text-text-primary">
            {contentTitle}
          </h1>
          <p className="mt-[7px] max-w-2xl text-[13.5px] leading-[20px] text-text-secondary-alt">
            {contentSubtitle}
          </p>
        </div>
        <FileUpload ref={uploadInputRef} handleFileChange={handleFileChange}>
          <button
            type="button"
            data-testid="files-new-button"
            onClick={openUploadPicker}
            aria-label={localize('com_ui_new')}
            title={localize('com_ui_new')}
            /* §4 `.primary.sm` as an icon button: --t1 fill, --app glyph. §1 is
               explicit that accent is not the colour of buttons — this was the
               one purple thing on the page. */
            className="grid size-[39px] shrink-0 place-items-center rounded-[10px] bg-text-primary text-surface-primary transition-opacity hover:opacity-90 focus:outline-none"
          >
            <Plus size={17} aria-hidden="true" />
          </button>
        </FileUpload>
      </header>

      {/* Search · view — §6's standard row, 20 below the header, 10 between
          the controls, the field taking the slack. The upload icon button that
          used to sit in here has gone: it called `openUploadPicker`, which is
          exactly what "+ New" above it does, so the page offered the same
          action twice within 40px of itself. */}
      <div className="flex items-center gap-[10px] pt-[20px]">
        <SearchField
          value={search}
          onChange={(next) => {
            setSearch(next);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
          onClear={() => {
            setSearch('');
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
          placeholder={localize('com_ui_search_files')}
          inputProps={{ 'data-testid': 'files-search' } as React.InputHTMLAttributes<HTMLInputElement>}
        />
        <ViewToggle view={viewMode} onChange={setViewMode} />
      </div>

      {/* Filter chips */}
      {showTabs && (
        <div
          role="tablist"
          aria-label={contentRegionLabel}
          className="flex items-center gap-2 overflow-x-auto pb-1 pt-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {/* §5: a strip is tabs, not pills — only the selected one wears a
              chip. These were outlined boxes, which put a border around every
              unselected option and made the strip the loudest thing on the
              page. Same component as the bookmark kinds and the persona
              segments, and it says what it is. */}
          <span className="shrink-0 text-[12.5px] leading-[19px] text-text-secondary-alt">
            {localize('com_ui_filter')}
          </span>
          {tabs.map((tab) => (
            <FilterPill
              key={tab.value}
              role="tab"
              aria-selected={tab.value === activeTab}
              data-testid={`files-tab-${tab.value}`}
              selected={tab.value === activeTab}
              count={tab.count > 0 ? tab.count : undefined}
              onClick={() => (onTabChange ? onTabChange(tab.value) : setActiveTab(tab.value))}
            >
              {tab.label}
            </FilterPill>
          ))}
        </div>
      )}

      {/* Below the controls the page becomes two columns: the table takes the
          slack and the rail sits beside it. Above this line the page is full
          width, so the search field is too. */}
      <div className="flex items-start gap-6 pt-[22px]">
        <div className="min-w-0 flex-1">
          {selectedCount > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-hover px-3 py-2">
              <span className="text-sm text-text-secondary-alt">
                {`${selectedCount} / ${table.getFilteredRowModel().rows.length}`}
              </span>
              <Button
                variant="outline"
                size="sm"
                data-testid="files-bulk-delete"
                disabled={isDeleting}
                onClick={() =>
                  handleDelete(table.getFilteredSelectedRowModel().rows.map((row) => row.original))
                }
                className="shrink-0"
              >
                {isDeleting ? (
                  <Spinner className="size-4" />
                ) : (
                  <TrashIcon className="size-4 text-text-destructive" />
                )}
                <span className="ml-2">
                  {localize('com_ui_delete')} ({selectedCount})
                </span>
              </Button>
            </div>
          )}

          {viewMode === 'list' ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow
                      key={headerGroup.id}
                      className="border-b border-border-light hover:bg-transparent"
                    >
                      {headerGroup.headers.map((header) => {
                        const size = header.getSize();
                        return (
                          <TableHead
                            key={header.id}
                            style={{ width: size === Number.MAX_SAFE_INTEGER ? 'auto' : size }}
                            className="h-9 bg-transparent px-3 text-left align-middle text-xs font-medium text-text-secondary-alt"
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {uploadSection && (
                    <TableRow className="border-b-0 hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="p-0 pb-1 pt-2">
                        {uploadSection}
                      </TableCell>
                    </TableRow>
                  )}
                  {pageRows.length ? (
                    pageRows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && 'selected'}
                        className="group/row h-12 border-b-0 transition-colors hover:bg-surface-hover/60"
                      >
                        {row.getVisibleCells().map((cell) => {
                          const size = cell.column.getSize();
                          return (
                            <TableCell
                              key={cell.id}
                              style={{ width: size === Number.MAX_SAFE_INTEGER ? 'auto' : size }}
                              /* `overflow-hidden` was on every cell to stop long
                                 filenames stretching the table — but the name
                                 cell already truncates its own text, and the
                                 clip was what hid the row menu. The actions
                                 cell keeps its content visible; the rest still
                                 clip. */
                              className={cn(
                                'h-12 px-3 py-0 align-middle',
                                cell.column.id === 'actions' ? 'overflow-visible' : 'overflow-hidden',
                              )}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className="border-b-0 hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="p-0">
                        {/* The page's empty state, not a grey line in a table
                            row — this is what you see when a filter matches
                            nothing, which is most of the time you see it. */}
                        <EmptyState
                          icon={<Search size={24} aria-hidden="true" />}
                          title={localize('com_files_no_results')}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="space-y-2">
              {uploadSection}
              {pageRows.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {pageRows.map((row) => {
                    const file = row.original;
                    const canOpenFile = getFileSource(file) !== '';
                    return (
                      <div
                        key={row.id}
                        data-state={row.getIsSelected() && 'selected'}
                        className="flex flex-col gap-2 rounded-[10px] border border-border-light bg-surface-chat p-3 transition-colors hover:border-border-medium"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Checkbox
                            checked={row.getIsSelected()}
                            onCheckedChange={(value) => row.toggleSelected(!!value)}
                            aria-label={localize('com_ui_select_row')}
                            className="flex size-[18px] rounded-lg"
                          />
                          <FileTypeTile file={file} />
                        </div>
                        <button
                          type="button"
                          onClick={() => openPreview(file)}
                          disabled={!canOpenFile}
                          aria-label={localize('com_ui_preview')}
                          className="flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-surface-hover text-text-secondary-alt focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-heavy disabled:cursor-default"
                        >
                          {isImageFile(file) && canOpenFile ? (
                            <AuthenticatedImagePreview
                              file={file}
                              className="h-24 w-full overflow-hidden rounded-lg"
                            />
                          ) : (
                            <FileTypeIcon file={file} size={24} />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-text-primary">
                            {file.filename}
                          </div>
                          <div className="mt-0.5 text-xs text-text-secondary-alt">
                            {formatSize(file.bytes)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={<Search size={24} aria-hidden="true" />}
                  title={localize('com_files_no_results')}
                />
              )}
            </div>
          )}

          {/* Pagination, only when there is somewhere to page to. One page of
              results showed "Prev 1 / 1 Next" with both buttons dead — three
              controls reporting that they do nothing. */}
          {table.getPageCount() > 1 && (
          <div className="flex items-center justify-between gap-3 pt-2">
            <div
              className="flex items-center gap-2.5"
              role="navigation"
              aria-label={localize('com_ui_pagination')}
            >
              <button
                type="button"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label={localize('com_ui_prev')}
                /* §3: a pager button is radius 9, and both of them are the same
                   button — Prev was a bare text link beside a filled Next, which
                   made one direction look disabled and the other primary. §4
                   disabled: opacity .42. */
                className="inline-flex h-8 items-center justify-center rounded-[9px] px-3.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none disabled:cursor-default disabled:opacity-[.42] disabled:hover:bg-transparent disabled:hover:text-text-secondary"
              >
                {localize('com_ui_prev')}
              </button>
              <div aria-live="polite" className="text-[13px] text-text-secondary-alt">
                {`${pageIndex + 1} / ${Math.max(table.getPageCount(), 1)}`}
              </div>
              <button
                type="button"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label={localize('com_ui_next')}
                className="inline-flex h-8 items-center justify-center rounded-[9px] px-3.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none disabled:cursor-default disabled:opacity-[.42] disabled:hover:bg-transparent disabled:hover:text-text-secondary"
              >
                {localize('com_ui_next')}
              </button>
            </div>
          </div>
          )}
        </div>
        {rail}
      </div>

      {/* Rename. §7's dialog anatomy — title, body, controls — with the field
          seeded from the current name, so the common case is type over it and
          press Enter. */}
      <OGDialog
        open={renameTarget != null}
        onOpenChange={(next) => {
          if (!next) {
            setRenameTarget(null);
          }
        }}
      >
        <OGDialogTemplate
          title={localize('com_ui_rename')}
          className="w-11/12 max-w-[420px]"
          main={
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitRename();
                }
              }}
              aria-label={localize('com_ui_rename')}
              className="h-10 w-full rounded-[10px] bg-surface-secondary px-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
          }
          selection={{
            selectHandler: () => void submitRename(),
            selectClasses: 'bg-text-primary text-surface-primary hover:opacity-90',
            selectText: isRenaming ? localize('com_ui_saving') : localize('com_ui_save'),
          }}
        />
      </OGDialog>

      <FilePreviewDialog
        file={previewTarget}
        open={previewTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewTarget(null);
          }
        }}
      />
    </div>
  );
}
