import { memo, useState, useEffect } from 'react';
import { imageExtRegex, Tools } from 'librechat-data-provider';
import type { TAttachment, TFile, TAttachmentMetadata } from 'librechat-data-provider';
import Image from '~/components/Chat/Messages/Content/Image';
import DownloadableFileCard from '~/components/Chat/Messages/Content/DownloadableFileCard';
import { useAttachmentLink } from './LogLink';
import { cn, getFileType } from '~/utils';

export const FileAttachment = memo(({ attachment }: { attachment: Partial<TAttachment> }) => {
  const [isVisible, setIsVisible] = useState(false);
  const file = attachment as TFile & TAttachmentMetadata;
  const { handleDownload } = useAttachmentLink({
    href: attachment.filepath ?? '',
    filename: attachment.filename ?? '',
    file_id: file.file_id,
    user: file.user,
    source: file.source,
  });
  const extension = attachment.filename?.split('.').pop();
  const fileType = getFileType(extension ?? attachment.type);
  const meta = [fileType.title, extension?.toUpperCase()].filter(Boolean).join(' · ');

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  if (!attachment.filepath) {
    return null;
  }

  return (
    <div
      className={cn(
        'file-attachment-container',
        'transition-all duration-swap ease-nash',
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
      style={{
        transformOrigin: 'center top',
        willChange: 'opacity, transform',
        WebkitFontSmoothing: 'subpixel-antialiased',
      }}
    >
      <DownloadableFileCard
        filename={file.filename}
        meta={meta}
        fileType={fileType}
        file={attachment}
        onDownload={handleDownload}
      />
    </div>
  );
});

const ImageAttachment = memo(({ attachment }: { attachment: TAttachment }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const { width, height, filepath = null } = attachment as TFile & TAttachmentMetadata;

  useEffect(() => {
    setIsLoaded(false);
    const timer = setTimeout(() => setIsLoaded(true), 100);
    return () => clearTimeout(timer);
  }, [attachment]);

  return (
    <div
      className={cn(
        'image-attachment-container',
        'transition-all duration-page ease-nash',
        isLoaded ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0',
      )}
      style={{
        transformOrigin: 'center top',
        willChange: 'opacity, transform',
        WebkitFontSmoothing: 'subpixel-antialiased',
      }}
    >
      <Image
        altText={attachment.filename || 'attachment image'}
        imagePath={filepath ?? ''}
        height={height ?? 0}
        width={width ?? 0}
        className="mb-4"
      />
    </div>
  );
});

export default function Attachment({ attachment }: { attachment?: TAttachment }) {
  if (!attachment) {
    return null;
  }
  if (attachment.type === Tools.web_search) {
    return null;
  }

  const { width, height, filepath = null } = attachment as TFile & TAttachmentMetadata;
  const isImage = attachment.filename
    ? imageExtRegex.test(attachment.filename) && width != null && height != null && filepath != null
    : false;

  if (isImage) {
    return <ImageAttachment attachment={attachment} />;
  } else if (!attachment.filepath) {
    return null;
  }
  return <FileAttachment attachment={attachment} />;
}

export function AttachmentGroup({ attachments }: { attachments?: TAttachment[] }) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const fileAttachments: TAttachment[] = [];
  const imageAttachments: TAttachment[] = [];

  attachments.forEach((attachment) => {
    const { width, height, filepath = null } = attachment as TFile & TAttachmentMetadata;
    const isImage = attachment.filename
      ? imageExtRegex.test(attachment.filename) &&
        width != null &&
        height != null &&
        filepath != null
      : false;

    if (isImage) {
      imageAttachments.push(attachment);
    } else if (attachment.type !== Tools.web_search) {
      fileAttachments.push(attachment);
    }
  });

  return (
    <>
      {fileAttachments.length > 0 && (
        <div className="my-2 flex flex-wrap items-center gap-2.5">
          {fileAttachments.map((attachment, index) =>
            attachment.filepath ? (
              <FileAttachment attachment={attachment} key={`file-${index}`} />
            ) : null,
          )}
        </div>
      )}
      {imageAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center">
          {imageAttachments.map((attachment, index) => (
            <ImageAttachment attachment={attachment} key={`image-${index}`} />
          ))}
        </div>
      )}
    </>
  );
}
