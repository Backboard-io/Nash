import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Download, ImageOff } from 'lucide-react';
import { getSessionKey } from 'librechat-data-provider';
import DialogImage from './DialogImage';
import { isNashManagedImageSource, normalizeNashImageSource } from './imageUrl';
import { cn } from '~/utils';

type Props = {
  src: string;
  alt?: string;
  className?: string;
  /** Optional download filename. Falls back to a Nash-prefixed name derived
   *  from the URL when not provided. */
  filename?: string;
  /** Render mode:
   *   - 'inline': natural-size markdown-style image (no max-height cap).
   *   - 'card':   thumb capped at ~420px for use in our generated-image grid. */
  variant?: 'inline' | 'card';
};

function defaultFilename(src: string): string {
  try {
    const url = new URL(src, window.location.origin);
    const last = (url.pathname.split('/').pop() || 'image').split('?')[0];
    return last.includes('.') ? `nash-${last}` : `nash-${last}.jpg`;
  } catch {
    return 'nash-image.jpg';
  }
}

function fetchOptionsFor(src: string): RequestInit {
  if (!isNashManagedImageSource(src)) {
    return { credentials: 'same-origin' };
  }
  const sessionKey = getSessionKey();
  return {
    credentials: 'same-origin',
    headers: sessionKey ? { 'X-Session-Key': sessionKey } : undefined,
  };
}

async function tryFetchAndSave(src: string, filename: string): Promise<boolean> {
  try {
    const response = await fetch(src, fetchOptionsFor(src));
    if (!response.ok) return false;
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
    return true;
  } catch {
    return false;
  }
}

function useFetchedSrc(src: string, retryNonce: number, onError: () => void) {
  const normalizedSrc = normalizeNashImageSource(src) || src;
  const shouldFetch = isNashManagedImageSource(normalizedSrc);
  const [fetchedSrc, setFetchedSrc] = useState<string | null>(shouldFetch ? null : normalizedSrc);

  useEffect(() => {
    if (!shouldFetch) {
      setFetchedSrc(normalizedSrc);
      return undefined;
    }

    let isCancelled = false;
    let objectUrl: string | null = null;

    setFetchedSrc(null);

    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    async function fetchImage(attempt = 0): Promise<void> {
      try {
        const opts = fetchOptionsFor(normalizedSrc);
        const response = await fetch(normalizedSrc, opts);
        if (!response.ok) {
          if (attempt === 0) {
            await wait(500);
            if (!isCancelled) {
              return fetchImage(1);
            }
            return;
          }
          throw new Error(`Image request failed with ${response.status}`);
        }
        const blob = await response.blob();
        objectUrl = window.URL.createObjectURL(blob);
        if (isCancelled) {
          window.URL.revokeObjectURL(objectUrl);
          return;
        }
        setFetchedSrc(objectUrl);
      } catch {
        if (attempt === 0) {
          await wait(500);
          if (!isCancelled) {
            return fetchImage(1);
          }
          return;
        }
        if (!isCancelled) {
          onError();
        }
      }
    }

    fetchImage();

    return () => {
      isCancelled = true;
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [normalizedSrc, shouldFetch, retryNonce, onError]);

  return { renderedSrc: fetchedSrc, isFetching: shouldFetch && !fetchedSrc };
}

function tryAnchorDownload(src: string, filename: string): boolean {
  try {
    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    a.rel = 'noreferrer';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    return false;
  }
}

/**
 * Nash-owned image renderer. Wraps any `<img>` with a click-to-zoom modal and
 * an always-visible download button overlay (top-right). Used for both
 * markdown-inline images and assistant-generated images so the download
 * affordance is consistent and not at the mercy of whatever the LLM emits.
 */
function DownloadableImage({ src, alt, className, filename, variant = 'inline' }: Props) {
  const [errored, setErrored] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const onFetchError = useCallback(() => setErrored(true), []);
  const { renderedSrc, isFetching } = useFetchedSrc(src, retryNonce, onFetchError);
  const downloadName = filename || defaultFilename(src);

  useEffect(() => {
    setErrored(false);
  }, [src]);

  const downloadImage = useCallback(async () => {
    if (!renderedSrc) {
      return;
    }
    const ok = await tryFetchAndSave(renderedSrc, downloadName);
    if (!ok) tryAnchorDownload(src, downloadName);
  }, [src, renderedSrc, downloadName]);

  const retryLoad = useCallback(() => {
    setErrored(false);
    setRetryNonce((n) => n + 1);
  }, []);

  const onDownloadClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      downloadImage();
    },
    [downloadImage],
  );

  if (errored) {
    return (
      <span
        role="alert"
        className="my-2 inline-flex items-center gap-2 rounded-md border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-secondary"
      >
        <ImageOff className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
        <span>Couldn&apos;t load this image.</span>
        <button
          type="button"
          className="text-xs font-medium text-brand-purple hover:underline"
          onClick={retryLoad}
        >
          Retry
        </button>
      </span>
    );
  }

  if (isFetching) {
    return null;
  }

  const imgClassName =
    variant === 'card'
      ? 'block max-h-[420px] max-w-full object-contain'
      : 'block max-w-full h-auto';

  return (
    <>
      <span className="relative my-2 inline-block max-w-full align-top">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsOpen(true)}
          className={cn(
            'block overflow-hidden rounded-[12px] bg-surface-hover transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary',
            className,
          )}
          aria-label="View image"
          aria-haspopup="dialog"
        >
          <img
            src={renderedSrc || src}
            alt={alt || 'Image'}
            className={imgClassName}
            loading="lazy"
            onError={() => setErrored(true)}
          />
        </button>
        <button
          type="button"
          onClick={onDownloadClick}
          aria-label="Download image"
          title="Download"
          className="absolute bottom-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
        </button>
      </span>
      <DialogImage
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        src={renderedSrc || src}
        downloadImage={downloadImage}
        triggerRef={triggerRef}
      />
    </>
  );
}

export default memo(DownloadableImage);
