import React, { useCallback, useMemo, useState } from 'react';
import {
  ChevronRight,
  Database,
  FileText,
  Code as CodeIcon,
  Image as ImageIcon,
  PanelRight,
  PanelRightOpen,
} from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { FileContext, FileSources } from 'librechat-data-provider';
import type { TFile } from 'librechat-data-provider';
import { downloadFile, getFileSource } from '~/components/Files/FilesView';
import { useGetFiles, useGetFilesUsage } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { formatDate, cn } from '~/utils';

/**
 * Nash has **no** account-level storage quota: no endpoint reports used-vs-allowed bytes and
 * `api/routes/misc.py` states outright that no billing or quota is enforced. The footer therefore
 * reports only the real total (the summed `bytes` of `GET /api/files`) — no ceiling, no percentage
 * and no meter, since any denominator would be invented. Add them back the day a quota endpoint
 * exists, driven by that endpoint's value.
 */
const RECENT_LIMIT = 5;

type RailCategory = 'documents' | 'images' | 'other';

/** MIME prefixes counted as "Documents". `type` is the only classification signal the API sends. */
const DOCUMENT_MIME_PREFIXES = [
  'text/',
  'application/pdf',
  'application/json',
  'application/xml',
  'application/rtf',
  'application/epub',
  'application/msword',
  'application/vnd.ms-',
  'application/vnd.oasis.opendocument',
  'application/vnd.openxmlformats-officedocument',
];

function mimeOf(file: TFile): string {
  return (file.type ?? '').split(';')[0].trim().toLowerCase();
}

function categorize(file: TFile): RailCategory {
  const mime = mimeOf(file);
  if (mime.startsWith('image/')) {
    return 'images';
  }
  if (DOCUMENT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return 'documents';
  }
  return 'other';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Timestamps are optional on `GET /api/files` — returns NaN when the row carries none. */
function timestampOf(file: TFile): number {
  const raw = file.updatedAt ?? file.createdAt;
  if (raw == null) {
    return Number.NaN;
  }
  return new Date(raw as unknown as string).getTime();
}

function dateLabelOf(file: TFile): string {
  const raw = file.updatedAt ?? file.createdAt;
  if (raw == null) {
    return '';
  }
  // formatDate builds its output from getDate()/getMonth() and never returns
  // the string 'Invalid Date', so an unparseable timestamp would render as
  // "NaN undefined NaN". Validate the date itself instead.
  if (!Number.isFinite(new Date(String(raw)).getTime())) {
    return '';
  }
  return formatDate(String(raw));
}

const CATEGORY_ICON: Record<RailCategory, typeof FileText> = {
  documents: FileText,
  images: ImageIcon,
  other: CodeIcon,
};

type CategoryTotals = Record<RailCategory, { count: number; bytes: number }>;

function CategoryRow({
  category,
  label,
  countLabel,
  sizeLabel,
}: {
  category: RailCategory;
  label: string;
  countLabel: string;
  sizeLabel: string;
}) {
  const Icon = CATEGORY_ICON[category];
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
        <Icon size={16} className="text-text-secondary-alt" aria-hidden={true} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-text-primary">{label}</div>
        <div className="truncate text-[11px] text-text-secondary-alt">{countLabel}</div>
      </div>
      <div className="shrink-0 text-[11px] font-medium text-text-secondary">{sizeLabel}</div>
    </div>
  );
}

export default function LibraryRail() {
  const localize = useLocalize();
  const [collapsed, setCollapsed] = useState(false);

  const { data: files = [] } = useGetFiles<TFile[]>({
    select: (data) =>
      data.map((file) => {
        file.context = file.context ?? FileContext.unknown;
        file.filterSource = file.source === FileSources.firebase ? FileSources.local : file.source;
        return file;
      }),
  });

  const { data: usage } = useGetFilesUsage();

  // Whole percent — the design shows "7%", not "7.4%".
  const usedPercent = useMemo(() => {
    if (usage == null || usage.limitBytes <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((usage.usedBytes / usage.limitBytes) * 100));
  }, [usage]);

  const { totalBytes, totals } = useMemo(() => {
    const seed: CategoryTotals = {
      documents: { count: 0, bytes: 0 },
      images: { count: 0, bytes: 0 },
      other: { count: 0, bytes: 0 },
    };
    let sum = 0;
    for (const file of files) {
      const bytes = Number(file.bytes);
      const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
      sum += safeBytes;
      const bucket = seed[categorize(file)];
      bucket.count += 1;
      bucket.bytes += safeBytes;
    }
    return { totalBytes: sum, totals: seed };
  }, [files]);

  // Prefer the server aggregate so the cards, the caption and the meter are all
  // the same numbers; the local sum is only a fallback while usage is in flight.
  const cardTotals = usage?.byCategory ?? totals;
  const captionBytes = usage?.usedBytes ?? totalBytes;
  const captionCount = usage?.fileCount ?? files.length;

  const recent = useMemo(() => {
    return [...files]
      .map((file, index) => ({ file, index }))
      .sort((a, b) => {
        const aTime = timestampOf(a.file);
        const bTime = timestampOf(b.file);
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
          return a.index - b.index;
        }
        if (Number.isNaN(aTime)) {
          return 1;
        }
        if (Number.isNaN(bTime)) {
          return -1;
        }
        return bTime - aTime;
      })
      .slice(0, RECENT_LIMIT)
      .map((entry) => entry.file);
  }, [files]);

  const fileCountLabel =
    captionCount === 1
      ? localize('com_ui_library_file_count_single')
      : localize('com_ui_library_file_count', { n: captionCount });

  const toggleLabel = collapsed
    ? localize('com_ui_library_expand_panel')
    : localize('com_ui_library_collapse_panel');

  const toggleButton = (
    <TooltipAnchor
      description={toggleLabel}
      render={
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          data-testid="library-rail-toggle"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-secondary-alt transition-colors hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
        >
          {collapsed ? <PanelRightOpen size={16} /> : <PanelRight size={16} />}
        </button>
      }
    />
  );

  if (collapsed) {
    return (
      <aside
        aria-label={localize('com_ui_library')}
        className="hidden shrink-0 flex-col items-center border-l border-border-light bg-surface-primary-alt px-3 pt-6 lg:flex"
      >
        {toggleButton}
      </aside>
    );
  }

  const categoryRows: Array<{ key: RailCategory; label: string }> = [
    { key: 'documents', label: localize('com_ui_documents') },
    { key: 'images', label: localize('com_ui_images') },
    { key: 'other', label: localize('com_ui_other') },
  ];

  return (
    <aside
      aria-label={localize('com_ui_library')}
      className="hidden w-80 shrink-0 flex-col overflow-hidden border-l border-border-light bg-surface-primary-alt px-5 lg:flex"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border-light pb-5 pt-6">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text-primary">
            {localize('com_ui_library')}
          </h2>
          <p className="mt-1.5 text-[11px] text-text-secondary-alt">
            {localize('com_ui_library_rail_summary', {
              files: fileCountLabel,
              size: formatBytes(captionBytes),
            })}
          </p>
        </div>
        {toggleButton}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-[18px] pt-5">
          {categoryRows.map(({ key, label }) => (
            <CategoryRow
              key={key}
              category={key}
              label={label}
              countLabel={
                cardTotals[key].count === 1
                  ? localize('com_ui_library_file_count_single')
                  : localize('com_ui_library_file_count', { n: cardTotals[key].count })
              }
              sizeLabel={formatBytes(cardTotals[key].bytes)}
            />
          ))}
        </div>

        <div className="mt-[22px] border-t border-border-light pt-[22px]">
          <h3 className="text-[11px] font-medium text-text-secondary-alt">
            {localize('com_ui_library_recently_added')}
          </h3>
          {recent.length === 0 ? (
            <p className="mt-4 text-[11px] text-text-tertiary">
              {localize('com_files_no_results')}
            </p>
          ) : (
            <ul className="mt-4 space-y-[18px]">
              {recent.map((file) => {
                const dateLabel = dateLabelOf(file);
                const sizeLabel = formatBytes(Number(file.bytes) || 0);
                const Icon = CATEGORY_ICON[categorize(file)];
                /** `''` when the row has no servable URL — the same guard the file table uses. */
                const canOpenFile = getFileSource(file) !== '';
                return (
                  <li key={file.file_id}>
                    <button
                      type="button"
                      onClick={() => void downloadFile(file)}
                      disabled={!canOpenFile}
                      aria-label={localize('com_ui_download_var', { 0: file.filename })}
                      className={cn(
                        'group -mx-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left',
                        'transition-colors hover:bg-surface-active focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary',
                        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
                      )}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
                        <Icon size={14} className="text-text-secondary-alt" aria-hidden={true} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-text-primary">
                          {file.filename}
                        </span>
                        <span className="block truncate text-[11px] text-text-secondary-alt">
                          {dateLabel ? `${dateLabel} · ${sizeLabel}` : sizeLabel}
                        </span>
                      </span>
                      <ChevronRight
                        size={14}
                        className="shrink-0 text-text-tertiary"
                        aria-hidden={true}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Storage. Every number here comes from GET /api/files/usage; the ceiling
          is the server's STORAGE_LIMIT_BYTES, not a client-side literal. The
          block is omitted entirely rather than guessed if usage is unavailable. */}
      {usage != null && usage.limitBytes > 0 && (
        <div className="mt-auto border-t border-border-light pb-5 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database size={16} className="shrink-0 text-text-secondary" aria-hidden={true} />
              <span className="text-xs font-medium text-text-secondary">
                {localize('com_ui_storage')}
              </span>
            </div>
            <span className="text-[11px] text-text-secondary-alt">{usedPercent}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usedPercent}
            aria-label={localize('com_ui_storage')}
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
          >
            <div
              className="h-full rounded-full bg-brand-purple transition-[width] duration-300"
              style={{ width: `${usedPercent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-text-secondary-alt">
              {localize('com_ui_library_storage_used', {
                used: formatBytes(usage.usedBytes),
                total: formatBytes(usage.limitBytes),
              })}
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
