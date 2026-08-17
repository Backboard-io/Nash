import { defaultUrlTransform } from 'react-markdown';

/**
 * react-markdown's default urlTransform sanitises hrefs and strips any scheme it
 * doesn't recognise (including `sandbox:` and `attachment:`) down to `''`. The
 * assistant offers generated files with exactly those schemes, e.g.
 * `[Download hello.html](sandbox:/mnt/data/hello.html)`. When the href is
 * stripped, the download card can only fall back to the visible link text, so it
 * mislabels itself "Download hello.html" instead of "hello.html".
 *
 * We preserve `sandbox:`/`attachment:` so the renderer can derive the real
 * filename from the href, and delegate everything else to the default transform
 * — `javascript:`, `vbscript:`, and other unsafe schemes stay blocked.
 */
export function downloadableUrlTransform(url: string): string {
  if (/^(?:sandbox|attachment):/i.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}
