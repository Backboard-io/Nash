import { memo } from 'react';
import type { TMessage } from 'librechat-data-provider';
import DownloadableImage from './DownloadableImage';

type Props = {
  message?: TMessage;
};

type Item = { documentId: string; mimeType: string; url: string; fileSizeBytes?: number };

function GeneratedMedia({ message }: Props) {
  const media = message?.generatedMedia as Item[] | undefined;
  if (!media || media.length === 0) {
    return null;
  }

  /** One generated image can reach us twice: inlined in the assistant's own
   * markdown (which `sanitize_s3_image_urls` rewrites to a Nash URL) and again
   * as a `media_generated` SSE event. Rendering both shows the image twice
   * while the turn streams, and only the markdown copy is persisted — so after
   * a reload the duplicate silently disappears. Drop the event copy whenever
   * the text already carries that image. */
  const text = message?.text ?? '';
  const visible = media.filter(
    (m) =>
      !(m.url && text.includes(m.url)) && !(m.documentId && text.includes(m.documentId)),
  );
  if (visible.length === 0) {
    return null;
  }

  return (
    <div
      className="mt-2 flex flex-wrap gap-2"
      data-testid="generated-media"
      aria-label="Generated images"
    >
      {visible.map((m) => {
        const ext = (m.mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const filename = `nash-image-${m.documentId}.${ext}`;
        return (
          <DownloadableImage
            key={m.documentId || m.url}
            src={m.url}
            alt="Generated image"
            filename={filename}
            variant="card"
          />
        );
      })}
    </div>
  );
}

export default memo(GeneratedMedia);
