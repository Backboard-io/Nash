// 'heic-to' is a ~2.6MB (raw) wasm-backed bundle only needed when a user
// actually uploads a HEIC image. A static import would keep it in the
// blocking entry graph for every page load — load it on first use instead,
// memoizing the promise so repeat calls share one module instance.
// The memo is RESET on rejection: caching a rejected promise would leave
// HEIC conversion broken for the whole session after one transient chunk
// failure (e.g. a deploy rotating the hashed chunk while a tab is open).
let heicModulePromise: Promise<typeof import('heic-to')> | null = null;
const loadHeic = () => {
  if (!heicModulePromise) {
    heicModulePromise = import('heic-to').catch((error) => {
      heicModulePromise = null;
      throw error;
    });
  }
  return heicModulePromise;
};

/**
 * Check if a file is in HEIC format
 * @param file - The file to check
 * @returns Promise<boolean> - True if the file is HEIC
 */
export const isHEICFile = async (file: File): Promise<boolean> => {
  try {
    const { isHeic } = await loadHeic();
    return await isHeic(file);
  } catch (error) {
    console.warn('Error checking if file is HEIC:', error);
    // Fallback to mime type check
    return file.type === 'image/heic' || file.type === 'image/heif';
  }
};

/**
 * Convert HEIC file to JPEG
 * @param file - The HEIC file to convert
 * @param quality - JPEG quality (0-1), default is 0.9
 * @param onProgress - Optional callback to track conversion progress
 * @returns Promise<File> - The converted JPEG file
 */
export const convertHEICToJPEG = async (
  file: File,
  quality: number = 0.9,
  onProgress?: (progress: number) => void,
): Promise<File> => {
  try {
    // Report conversion start
    onProgress?.(0.3);

    const { heicTo } = await loadHeic();
    const convertedBlob = await heicTo({
      blob: file,
      type: 'image/jpeg',
      quality,
    });

    // Report conversion completion
    onProgress?.(0.8);

    // Create a new File object with the converted blob
    const convertedFile = new File([convertedBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });

    // Report file creation completion
    onProgress?.(1.0);

    return convertedFile;
  } catch (error) {
    console.error('Error converting HEIC to JPEG:', error);
    throw new Error('Failed to convert HEIC image to JPEG');
  }
};

/**
 * Process a file, converting it from HEIC to JPEG if necessary
 * @param file - The file to process
 * @param quality - JPEG quality for conversion (0-1), default is 0.9
 * @param onProgress - Optional callback to track conversion progress
 * @returns Promise<File> - The processed file (converted if it was HEIC, original otherwise)
 */
export const processFileForUpload = async (
  file: File,
  quality: number = 0.9,
  onProgress?: (progress: number) => void,
): Promise<File> => {
  const isHEIC = await isHEICFile(file);

  if (isHEIC) {
    console.log('HEIC file detected, converting to JPEG...');
    return convertHEICToJPEG(file, quality, onProgress);
  }

  return file;
};
