import React, { useCallback, useMemo } from 'react';
import {
  ChevronRight,
  Database,
  FileText,
  Code as CodeIcon,
  Image as ImageIcon,
} from 'lucide-react';
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
    /* A row on a --surface card, so its tile steps up to --elevated (§1 rule 2)
       rather than matching the card it sits on. Type follows §2 rather than the
       three different small sizes this rail had. */
    <div className="flex items-center gap-2.5 rounded-[8px] px-1 py-1.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-hover">
        <Icon size={15} className="text-text-secondary" aria-hidden={true} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium leading-[18px] text-text-primary">
          {label}
        </div>
        <div className="truncate text-[12px] leading-[17px] text-text-tertiary">{countLabel}</div>
      </div>
      <div className="shrink-0 text-[12px] font-medium text-text-secondary-alt">{sizeLabel}</div>
    </div>
  );
}

export default function LibraryRail() {
  const localize = useLocalize();

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

  const onUpgrade = useCallback(() => {
    window.open('https://app.backboard.io/settings/billing', '_blank', 'noopener,noreferrer');
  }, []);

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

  const categoryRows: Array<{ key: RailCategory; label: string }> = [
    { key: 'documents', label: localize('com_ui_documents') },
    { key: 'images', label: localize('com_ui_images') },
    { key: 'other', label: localize('com_ui_other') },
  ];

  return (
    /* The rail is a column of §3 cards that ends where its content ends.
       It used to be a full-height flex column: a header rule, a `flex-1`
       scroller, and Storage pinned with `mt-auto` — so five files left ~800px
       of ruled emptiness with a meter stranded at the bottom of it. Nothing
       stretches now; the panel simply runs out. */
    <aside
      aria-label={localize('com_ui_library')}
      /* No top offset any more: the rail is rendered inside the content row,
         so it already starts level with the table beside it. It used to be a
         sibling of the whole scroll container and needed 90px of padding to
         push its title down past the page header. */
      className="hidden w-[300px] shrink-0 flex-col gap-3 lg:flex"
    >
      <div>
        {/* Card one: what is in the library, by kind. Hairlines between the
            rows are gone — §14.9, space does this job — and the card edge is
            the only boundary. */}
        <div className="flex flex-col gap-1 nash-card rounded-[13px] p-3">
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
      </div>

      {/* Card two: recently added. */}
      <div className="nash-card rounded-[13px] p-3">
          <h3 className="px-1 pb-2 text-[11px] font-medium uppercase leading-[16.5px] tracking-[0.06em] text-text-secondary-alt">
            {localize('com_ui_library_recently_added')}
          </h3>
          {recent.length === 0 ? (
            <p className="px-1 pb-1 text-[12px] text-text-tertiary">
              {localize('com_files_no_results')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
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
                        'group flex w-full items-center gap-2.5 rounded-[8px] px-1 py-1.5 text-left',
                        'transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-heavy',
                        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
                      )}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-hover text-text-secondary group-hover:bg-surface-active">
                        <Icon size={15} aria-hidden={true} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium leading-[18px] text-text-primary">
                          {file.filename}
                        </span>
                        <span className="block truncate text-[12px] leading-[17px] text-text-tertiary">
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

      {/* Storage. Every number here comes from GET /api/files/usage; the ceiling
          is the server's STORAGE_LIMIT_BYTES, not a client-side literal. The
          block is omitted entirely rather than guessed if usage is unavailable. */}
      {usage != null && usage.limitBytes > 0 && (
        /* Card three, in the flow — not `mt-auto` against the viewport floor.
           A meter pinned to the bottom of an empty column reads as a status bar
           belonging to the app rather than a fact about this library. */
        <div className="nash-card rounded-[13px] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database size={15} className="shrink-0 text-text-secondary" aria-hidden={true} />
              <span className="text-[12.5px] font-medium leading-[18px] text-text-primary">
                {localize('com_ui_storage')}
              </span>
            </div>
            <span className="text-[12px] text-text-tertiary">{usedPercent}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usedPercent}
            aria-label={localize('com_ui_storage')}
            className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
          >
            <div
              /* --t1, not accent. A storage meter is always on screen, so an
                 accent bar here spends §1's one-accent-per-screen on a number
                 nobody came to the page for — and left the real accent, the
                 Upgrade link right beneath it, competing with a bar. */
              className="h-full rounded-full bg-text-primary transition-[width] duration-swap"
              style={{ width: `${usedPercent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[12px] leading-[17px] text-text-tertiary">
              {localize('com_ui_library_storage_used', {
                used: formatBytes(usage.usedBytes),
                total: formatBytes(usage.limitBytes),
              })}
            </p>
            <button
              type="button"
              onClick={onUpgrade}
              /* §1 keeps accent for link-styled actions, which this is — and
                 now it is the only accent on the page. */
              className="text-[12px] font-medium text-brand-purple transition-opacity hover:opacity-80 focus:outline-none"
            >
              {localize('com_ui_upgrade')}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
