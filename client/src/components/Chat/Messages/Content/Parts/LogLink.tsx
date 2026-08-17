import React from 'react';
import { dataService, FileSources } from 'librechat-data-provider';
import { useToastContext } from '@librechat/client';
import { useCodeOutputDownload, useFileDownload } from '~/data-provider';

interface AttachmentLinkOptions {
  href: string;
  filename: string;
  file_id?: string;
  user?: string;
  source?: string;
  exportContent?: string;
}

/**
 * Determines if a file is stored locally (not an external API URL).
 * Files with these sources are stored on the LibreChat server and should
 * use the /api/files/download endpoint instead of direct URL access.
 */
const isLocallyStoredSource = (source?: string): boolean => {
  if (!source) {
    return false;
  }
  return [FileSources.local, FileSources.firebase, FileSources.s3, FileSources.azure_blob].includes(
    source as FileSources,
  );
};

export const useAttachmentLink = ({
  href,
  filename,
  file_id,
  user,
  source,
  exportContent,
}: AttachmentLinkOptions) => {
  const { showToast } = useToastContext();

  const useLocalDownload = isLocallyStoredSource(source) && !!file_id && !!user;
  const { refetch: downloadFromApi } = useFileDownload(user, file_id);
  const { refetch: downloadFromUrl } = useCodeOutputDownload(href);

  const handleDownload = async (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
  ): Promise<boolean> => {
    event.preventDefault();
    try {
      const downloadURL = exportContent
        ? window.URL.createObjectURL(
            await dataService.exportFile({ filename, content: exportContent }),
          )
        : (useLocalDownload ? await downloadFromApi() : await downloadFromUrl()).data;

      if (downloadURL == null || downloadURL === '') {
        console.error('Error downloading file: No data found');
        showToast({
          status: 'error',
          message: 'Error downloading file',
        });
        return false;
      }
      const link = document.createElement('a');
      link.href = downloadURL;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (downloadURL.startsWith('blob:')) {
        window.URL.revokeObjectURL(downloadURL);
      }
      return true;
    } catch (error) {
      console.error('Error downloading file:', error);
      return false;
    }
  };

  return { handleDownload };
};
