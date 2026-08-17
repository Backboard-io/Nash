import type { Row } from '@tanstack/react-table';
import type { TFile } from 'librechat-data-provider';
import ImagePreview from '~/components/Chat/Input/Files/ImagePreview';
import FilePreview from '~/components/Chat/Input/Files/FilePreview';
import { getFileType } from '~/utils';

export default function PanelFileCell({ row }: { row: Row<TFile | undefined> }) {
  const file = row.original;
  // Generated images keep the viewable bitmap in `preview`; `filepath` may be a
  // non-image download URL (or empty), which left the cell blank. Mirror the
  // chat renderer (Files.tsx) by preferring `preview`, and fall back to the
  // file-type icon when no usable image URL exists so the cell is never blank.
  const isImage = file?.type?.startsWith('image') === true;
  const imageUrl = file?.preview || file?.filepath;
  return (
    <div className="flex w-full items-center gap-2">
      {isImage && imageUrl ? (
        <ImagePreview
          url={imageUrl}
          className="h-10 w-10 flex-shrink-0"
          source={file?.source}
          alt={file?.filename}
        />
      ) : (
        <FilePreview fileType={getFileType(file?.type)} file={file} />
      )}
      <div className="min-w-0 flex-1 overflow-hidden">
        <span className="block w-full overflow-hidden truncate text-ellipsis whitespace-nowrap text-xs text-text-primary">
          {file?.filename}
        </span>
      </div>
    </div>
  );
}
