const nashImagePathPrefixes = ['/images/', '/api/files/download/'];
const uploadPathMarker = '/uploads/';

function withLeadingSlash(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

function isNashManagedPath(pathname: string) {
  const normalizedPath = withLeadingSlash(pathname);
  return nashImagePathPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
}

function hasProtocol(src: string) {
  return /^[a-z][a-z\d+\-.]*:/i.test(src);
}

function isLocalNashUrl(url: URL) {
  if (!isNashManagedPath(url.pathname)) {
    return false;
  }

  return (
    url.origin === window.location.origin ||
    url.hostname === window.location.hostname ||
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '0.0.0.0'
  );
}

function downloadPathFromUploadPath(pathname: string) {
  const markerIndex = pathname.indexOf(uploadPathMarker);
  if (markerIndex < 0) {
    return null;
  }

  const uploadTail = pathname.slice(markerIndex + uploadPathMarker.length);
  const [dirKey, filename] = uploadTail.split('/');
  if (!dirKey || !filename) {
    return null;
  }

  const fileId = filename.split('_')[0];
  if (!fileId) {
    return null;
  }

  return `/api/files/download/${dirKey}/${fileId}`;
}

export function normalizeNashImageSource(src?: string) {
  if (!src) {
    return src;
  }

  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return src;
  }

  if (!hasProtocol(src)) {
    const relativeSrc = withLeadingSlash(src);
    if (isNashManagedPath(relativeSrc)) {
      return relativeSrc;
    }
    const uploadDownloadPath = downloadPathFromUploadPath(relativeSrc);
    if (uploadDownloadPath) {
      return uploadDownloadPath;
    }
  }

  try {
    const url = new URL(src, window.location.origin);
    if (isLocalNashUrl(url)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    const uploadDownloadPath = downloadPathFromUploadPath(url.pathname);
    if (
      uploadDownloadPath &&
      (url.origin === window.location.origin || url.hostname === window.location.hostname)
    ) {
      return uploadDownloadPath;
    }
  } catch {
    /* Leave malformed/non-URL image sources unchanged below. */
  }

  return src;
}

export function isNashManagedImageSource(src?: string) {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) {
    return false;
  }

  try {
    if (!hasProtocol(src)) {
      const relativeSrc = withLeadingSlash(src);
      return isNashManagedPath(relativeSrc) || downloadPathFromUploadPath(relativeSrc) != null;
    }
    const url = new URL(src, window.location.origin);
    return (
      isLocalNashUrl(url) ||
      (downloadPathFromUploadPath(url.pathname) != null &&
        (url.origin === window.location.origin || url.hostname === window.location.hostname))
    );
  } catch {
    return isNashManagedPath(src);
  }
}

export function resolveImageSource(src?: string, _baseURL?: string) {
  if (!src) {
    return src;
  }

  return normalizeNashImageSource(src);
}
