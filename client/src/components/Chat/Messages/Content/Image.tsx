import React, { useMemo } from 'react';
import DownloadableImage from './DownloadableImage';
import { resolveImageSource } from './imageUrl';
import { cn } from '~/utils';

/**
 * Adapter that preserves the legacy `<Image imagePath=… altText=…>` interface
 * used across the chat content renderers (Part.tsx, Files.tsx, LogContent.tsx,
 * Attachment.tsx, OpenAIImageGen.tsx) while routing every image through the
 * Nash-owned DownloadableImage — same lightbox, same always-visible download
 * button, same fallback. This guarantees that no matter how an image arrives
 * in the assistant message (markdown, image_file content part, attachment),
 * the user gets the same UI affordance.
 */
const Image = ({
  imagePath,
  altText,
  className,
  args,
}: {
  imagePath: string;
  altText: string;
  height?: number;
  width?: number;
  placeholderDimensions?: {
    height?: string;
    width?: string;
  };
  className?: string;
  args?: {
    prompt?: string;
    quality?: 'low' | 'medium' | 'high';
    size?: string;
    style?: string;
    [key: string]: unknown;
  };
}) => {
  const absoluteImageUrl = useMemo(() => {
    return resolveImageSource(imagePath);
  }, [imagePath]);

  if (!absoluteImageUrl) {
    return null;
  }

  // `args.prompt` is the original generation prompt for OpenAI image-gen
  // outputs; use it for the saved-file name when available.
  const fileBase = (args?.prompt || altText || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'image';
  const filename = `nash-${fileBase}.png`;

  return (
    <DownloadableImage
      src={absoluteImageUrl}
      alt={altText}
      className={cn('max-w-lg', className)}
      filename={filename}
      variant="inline"
    />
  );
};

export default Image;
