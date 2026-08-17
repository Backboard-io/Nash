import { useCallback, useEffect, useMemo, useState, memo } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Copy, Download, X } from 'lucide-react';
import { getSessionKey, imageExtRegex } from 'librechat-data-provider';
import type { TFile, TMessage } from 'librechat-data-provider';
import FileContainer from '~/components/Chat/Input/Files/FileContainer';
import Image from './Image';

export function isRenderableImageFile(file: Partial<TFile>) {
  if (file.type?.startsWith('image/')) {
    return true;
  }
  const filename = file.filename || file.filepath || '';
  return imageExtRegex.test(filename);
}

type TextFile = Partial<TFile> & {
  metadata?: TFile['metadata'];
};

const canPreviewTextFile = (file: TextFile) =>
  Boolean(file.metadata?.isPastedBlock && (file.metadata?.displayText || file.filepath));

/** Source for an attached image, preferring the durable server path.
 *
 * `useFileHandling` revokes a file's local object URL as soon as the upload is
 * fired, but the now-dead string stays on the file entry and is copied onto the
 * optimistic user message — so preferring `preview` renders a revoked `blob:`
 * URL that only fixes itself on reload, when the server's copy of the message
 * arrives with `filepath` alone. Fall back to `preview` only while the upload
 * has yet to produce a path. `FileRow` applies the same rule to the composer
 * thumbnail. */
const imageSourceFor = (file: Partial<TFile>) => file.filepath || file.preview || '';

const TextFileDialog = ({
  file,
  open,
  onOpenChange,
}: {
  file: TextFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !file) {
      return;
    }

    const inlineText = file.metadata?.displayText;
    if (inlineText) {
      setContent(inlineText);
      setError('');
      setLoading(false);
      return;
    }

    const filepath = file.filepath;
    if (!filepath) {
      setContent('');
      setError('Unable to load this document.');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const sessionKey = getSessionKey();
    setLoading(true);
    setError('');
    setContent('');

    fetch(filepath, {
      credentials: 'same-origin',
      signal: controller.signal,
      headers: sessionKey ? { 'X-Session-Key': sessionKey } : undefined,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }
        return response.text();
      })
      .then((text) => {
        setContent(text);
        setError('');
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          setError('Unable to load this document.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [file, open]);

  const title = file?.filename || 'Pasted text.txt';
  const hasContent = content.length > 0 && !loading && !error;

  const handleCopy = useCallback(async () => {
    if (!hasContent) {
      return;
    }

    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [content, hasContent]);

  const handleDownload = useCallback(() => {
    if (!hasContent) {
      return;
    }

    const blob = new Blob([content], { type: file?.type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = title;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [content, file?.type, hasContent, title]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[250] bg-black/80" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[251] flex max-h-[80vh] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border-light bg-surface-primary text-text-primary shadow-2xl outline-none">
          <div className="flex items-center justify-between gap-3 border-b border-border-light px-5 py-4">
            <DialogPrimitive.Title className="min-w-0 truncate text-base font-medium">
              {title}
            </DialogPrimitive.Title>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={handleCopy}
                disabled={!hasContent}
                className="rounded-lg p-2 text-text-secondary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Copy document text"
                title="Copy"
              >
                {copied ? (
                  <Check className="size-5" aria-hidden="true" />
                ) : (
                  <Copy className="size-5" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!hasContent}
                className="rounded-lg p-2 text-text-secondary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Download document text"
                title="Download"
              >
                <Download className="size-5" aria-hidden="true" />
              </button>
              <DialogPrimitive.Close className="rounded-lg p-2 text-text-secondary hover:bg-surface-hover">
                <X className="size-5" aria-hidden="true" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
            {loading ? (
              <div className="text-sm text-text-secondary">Loading document...</div>
            ) : error ? (
              <div className="text-sm text-red-500">{error}</div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
                {content}
              </pre>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

const Files = ({ message }: { message?: TMessage }) => {
  const [openFile, setOpenFile] = useState<TextFile | null>(null);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setOpenFile(null);
    }
  }, []);
  const imageFiles = useMemo(() => {
    return message?.files?.filter((file) => isRenderableImageFile(file)) || [];
  }, [message?.files]);

  const otherFiles = useMemo(() => {
    return message?.files?.filter((file) => !isRenderableImageFile(file)) || [];
  }, [message?.files]);

  return (
    <>
      {otherFiles.length > 0 &&
        otherFiles.map((file) => {
          const textFile = file as TextFile;
          const previewable = canPreviewTextFile(textFile);
          return (
            <FileContainer
              key={file.file_id}
              file={file as TFile}
              buttonClassName="rounded-[10px] border-0 bg-surface-active"
              onClick={
                previewable
                  ? (event) => {
                      event.preventDefault();
                      setOpenFile(textFile);
                    }
                  : undefined
              }
            />
          );
        })}
      {imageFiles.length > 0 &&
        imageFiles.map((file) => (
          <Image
            key={file.file_id}
            imagePath={imageSourceFor(file)}
            height={file.height ?? 1920}
            width={file.width ?? 1080}
            altText={file.filename ?? 'Uploaded Image'}
            placeholderDimensions={{
              height: `${file.height ?? 1920}px`,
              width: `${file.height ?? 1080}px`,
            }}
            // n={imageFiles.length}
            // i={i}
          />
        ))}
      <TextFileDialog
        file={openFile}
        open={openFile != null}
        onOpenChange={handleOpenChange}
      />
    </>
  );
};

export default memo(Files);
