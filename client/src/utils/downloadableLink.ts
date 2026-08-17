/**
 * Detects when a markdown link points at a downloadable file rather than a web
 * page, so the renderer can show a download card instead of a bare blue link.
 *
 * The assistant offers files by hand-writing markdown like
 * `[sample.html](sample.html)` — the visible text is the filename and the href
 * is relative / file-ish (it is not a real Nash file URL, which is handled
 * separately). We treat such links as files; genuine web links stay links.
 */

/**
 * Extensions that, on an external http(s) URL, clearly denote a download rather
 * than a page. `html`/`htm` are intentionally excluded — externally those are
 * almost always pages, not downloads. For relative/file-ish hrefs any extension
 * is accepted (those come from the assistant offering a generated file).
 */
const EXTERNAL_DOWNLOAD_EXT = new Set([
  'pdf', 'csv', 'tsv', 'txt', 'md', 'json', 'xml', 'yaml', 'yml', 'log',
  'zip', 'tar', 'gz', 'tgz', 'rar', '7z',
  'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'rtf', 'odt', 'ods',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico',
  'mp3', 'wav', 'm4a', 'ogg', 'flac', 'mp4', 'mov', 'webm', 'mkv', 'avi',
]);

/** A bare filename with an extension: "sample.html", "Q3 report (final).pdf". */
const FILENAME_RE = /^[\w .()\-[\]&,+]+\.[A-Za-z0-9]{1,8}$/;

function getScheme(href: string): string {
  const m = href.match(/^([a-z][a-z0-9+.-]*):/i);
  return m ? m[1].toLowerCase() : '';
}

export function shouldGenerateFileExport(href: string): boolean {
  if (href.startsWith('/api/files/download/') || href.includes('/api/files/download/')) {
    return false;
  }
  const scheme = getScheme(href);
  return scheme !== 'http' && scheme !== 'https';
}

function looksLikeFilename(value: string): boolean {
  const trimmed = value.trim();
  return FILENAME_RE.test(trimmed) && !trimmed.includes('/');
}

function filenameFromLabel(text: string): string | null {
  const stripped = text.trim().replace(/^download\s+/i, '');
  return looksLikeFilename(stripped) ? stripped : null;
}

/** Last path segment of an href, if it looks like a filename. */
function filenameFromHref(href: string): string | null {
  if (!href) {
    return null;
  }
  const scheme = getScheme(href);
  // data:/blob:/mailto:/tel:/javascript: carry no usable filename.
  if (scheme && scheme !== 'http' && scheme !== 'https' && scheme !== 'sandbox' && scheme !== 'attachment') {
    return null;
  }
  const path = href.split('#')[0].split('?')[0].replace(/\/+$/, '');
  const segment = path.split('/').pop() ?? '';
  return looksLikeFilename(segment) ? segment : null;
}

export interface DownloadableLink {
  filename: string;
  ext: string;
}

/**
 * Resolve a downloadable file from a markdown anchor's href + visible text.
 * Returns null for ordinary web links so they keep rendering as links.
 */
export function getDownloadableFile(href: string, text: string): DownloadableLink | null {
  // Prefer the href's filename (it is what actually downloads, and link text is
  // often a verb-prefixed label like "Download hello.html"); fall back to the
  // visible text when the href carries no usable name (relative/stripped hrefs).
  const candidate = filenameFromHref(href) ?? filenameFromLabel(text);
  if (!candidate) {
    return null;
  }
  const ext = (candidate.split('.').pop() ?? '').toLowerCase();
  if (!ext) {
    return null;
  }

  const scheme = getScheme(href);
  const isWeb = scheme === 'http' || scheme === 'https';
  if (!isWeb) {
    // Relative, sandbox:, attachment:, or empty href: an assistant-offered file.
    return { filename: candidate, ext };
  }
  // External web URL: only a file when the extension is an unambiguous download.
  return EXTERNAL_DOWNLOAD_EXT.has(ext) ? { filename: candidate, ext } : null;
}
