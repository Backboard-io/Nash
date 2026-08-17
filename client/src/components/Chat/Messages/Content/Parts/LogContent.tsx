import { isAfter } from 'date-fns';
import React, { useMemo } from 'react';
import { imageExtRegex } from 'librechat-data-provider';
import type { TFile, TAttachment, TAttachmentMetadata } from 'librechat-data-provider';
import Image from '~/components/Chat/Messages/Content/Image';
import { useLocalize } from '~/hooks';
import { FileAttachment } from './Attachment';

interface LogContentProps {
  output?: string;
  renderImages?: boolean;
  attachments?: TAttachment[];
}

type ImageAttachment = TFile &
  TAttachmentMetadata & {
    height: number;
    width: number;
  };

const LogContent: React.FC<LogContentProps> = ({ output = '', renderImages, attachments }) => {
  const localize = useLocalize();

  const processedContent = useMemo(() => {
    if (!output) {
      return '';
    }

    const parts = output.split('Generated files:');
    return parts[0].trim();
  }, [output]);

  const { imageAttachments, nonImageAttachments } = useMemo(() => {
    const imageAtts: ImageAttachment[] = [];
    const nonImageAtts: TAttachment[] = [];

    attachments?.forEach((attachment) => {
      const { width, height, filepath = null } = attachment as TFile & TAttachmentMetadata;
      const isImage =
        imageExtRegex.test(attachment.filename ?? '') &&
        width != null &&
        height != null &&
        filepath != null;
      if (isImage) {
        imageAtts.push(attachment as ImageAttachment);
      } else {
        nonImageAtts.push(attachment);
      }
    });

    return {
      imageAttachments: renderImages === true ? imageAtts : null,
      nonImageAttachments: nonImageAtts,
    };
  }, [attachments, renderImages]);

  const renderAttachment = (file: TAttachment) => {
    const now = new Date();
    const expiresAt =
      'expiresAt' in file && typeof file.expiresAt === 'number' ? new Date(file.expiresAt) : null;
    const isExpired = expiresAt ? isAfter(now, expiresAt) : false;
    const filename = file.filename || '';

    if (isExpired) {
      return (
        <span key={file.filepath} className="text-sm text-text-secondary">
          {filename} {localize('com_download_expired')}
        </span>
      );
    }

    return <FileAttachment key={file.filepath} attachment={file} />;
  };

  return (
    <>
      {processedContent && <div>{processedContent}</div>}
      {nonImageAttachments.length > 0 && (
        <div>
          <p>{localize('com_generated_files')}</p>
          <div className="my-2 flex flex-wrap items-center gap-2.5">
            {nonImageAttachments.map((file) => renderAttachment(file))}
          </div>
        </div>
      )}
      {imageAttachments?.map((attachment, index) => {
        const { width, height, filepath } = attachment;
        return (
          <Image
            key={index}
            altText={attachment.filename}
            imagePath={filepath}
            height={height}
            width={width}
          />
        );
      })}
    </>
  );
};

export default LogContent;
