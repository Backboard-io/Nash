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

  return (
    <div
      className="mt-2 flex flex-wrap gap-2"
      data-testid="generated-media"
      aria-label="Generated images"
    >
      {media.map((m) => {
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
