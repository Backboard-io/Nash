import { memo, useState } from 'react';
import { Check } from 'lucide-react';
import { FileIcon } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type FileType = { paths: React.FC; fill: string; title: string };

type DownloadStatus = 'idle' | 'downloaded' | 'error';

/**
 * NASH17 "Downloadable File Output" card: icon chip + filename + type metadata
 * + a Download button. Built from inline phrasing elements (span/button/svg) so
 * it is valid inside a markdown <p>, letting recognized file links render as a
 * card without breaking paragraph nesting.
 */
const DownloadableFileCard = memo(
  ({
    filename,
    meta,
    fileType,
    onDownload,
    file,
    className,
  }: {
    filename?: string;
    meta: string;
    fileType: FileType;
    onDownload: (event: React.MouseEvent<HTMLButtonElement>) => Promise<boolean> | boolean;
    file?: Partial<ExtendedFile | TFile>;
    className?: string;
  }) => {
    const localize = useLocalize();
    const [status, setStatus] = useState<DownloadStatus>('idle');
    const [busy, setBusy] = useState(false);

    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
      if (busy) {
        return;
      }
      setBusy(true);
      const ok = await onDownload(event);
      setBusy(false);
      setStatus(ok ? 'downloaded' : 'error');
    };

    const label =
      status === 'error'
        ? localize('com_ui_error')
        : status === 'downloaded'
          ? localize('com_ui_downloaded')
          : localize('com_ui_download');

    return (
      <span
        className={cn(
          'my-1 inline-flex w-full max-w-full items-center gap-2.5 rounded-[10px] border bg-surface-chat px-3.5 py-3 align-middle text-sm text-text-primary',
          status === 'error' ? 'border-border-destructive' : 'border-border-light',
          className,
        )}
      >
        <FileIcon file={file} fileType={fileType} />
        <span className="flex min-w-0 flex-col gap-px overflow-hidden text-left">
          <span
            className="truncate text-[13px] font-medium leading-[19.5px]"
            title={filename}
          >
            {filename}
          </span>
          <span className="truncate text-[11px] leading-[16.5px] text-text-secondary-alt">
            {meta}
          </span>
        </span>
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          aria-label={filename}
          className={cn(
            'ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-[12px] font-medium leading-[18px] transition-colors',
            'bg-surface-hover text-text-primary hover:bg-surface-active',
            busy && 'opacity-60',
          )}
        >
          {status === 'downloaded' && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
          {label}
        </button>
      </span>
    );
  },
);

DownloadableFileCard.displayName = 'DownloadableFileCard';

export default DownloadableFileCard;
