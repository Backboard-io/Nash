import { getDownloadableFile, shouldGenerateFileExport } from './downloadableLink';

describe('getDownloadableFile', () => {
  describe('assistant-offered files (relative / file-ish href)', () => {
    it('treats "[sample.html](sample.html)" as a downloadable HTML file', () => {
      expect(getDownloadableFile('sample.html', 'sample.html')).toEqual({
        filename: 'sample.html',
        ext: 'html',
      });
    });

    it('derives the filename from the link text even when the href was stripped', () => {
      // react-markdown sanitises data:/unknown hrefs to '' — text still wins.
      expect(getDownloadableFile('', 'report.pdf')).toEqual({
        filename: 'report.pdf',
        ext: 'pdf',
      });
    });

    it('accepts sandbox: and attachment: schemes', () => {
      expect(getDownloadableFile('sandbox:/mnt/data/out.csv', 'out.csv')).toEqual({
        filename: 'out.csv',
        ext: 'csv',
      });
    });

    it('accepts filenames with spaces and parentheses', () => {
      expect(getDownloadableFile('Q3 report (final).pdf', 'Q3 report (final).pdf')).toEqual({
        filename: 'Q3 report (final).pdf',
        ext: 'pdf',
      });
    });

    it('falls back to the href segment when the text is a label', () => {
      expect(getDownloadableFile('files/data/output.json', 'click to download')).toEqual({
        filename: 'output.json',
        ext: 'json',
      });
    });

    it('uses the href filename, not the verb-prefixed link text', () => {
      // Model writes "[Download hello.html](hello.html)" — the card should be
      // labelled "hello.html", not "Download hello.html".
      expect(getDownloadableFile('hello.html', 'Download hello.html')).toEqual({
        filename: 'hello.html',
        ext: 'html',
      });
      expect(getDownloadableFile('sandbox:/mnt/data/hello.html', 'Download hello.html')).toEqual({
        filename: 'hello.html',
        ext: 'html',
      });
    });

    it('still cardifies a labelled link when the href was stripped to empty', () => {
      // Degraded path: no href to derive from, so the label is all we have.
      expect(getDownloadableFile('', 'Download hello.html')).toEqual({
        filename: 'hello.html',
        ext: 'html',
      });
    });

    it('uses the label filename for app download URLs', () => {
      expect(getDownloadableFile('/api/files/download/user/export_123', 'Download hello.pdf')).toEqual({
        filename: 'hello.pdf',
        ext: 'pdf',
      });
    });
  });

  describe('external web URLs', () => {
    it('cardifies an external URL ending in a clear download extension', () => {
      expect(getDownloadableFile('https://example.com/files/report.pdf', 'report.pdf')).toEqual({
        filename: 'report.pdf',
        ext: 'pdf',
      });
    });

    it('keeps an external .html URL as a link (it is a page, not a download)', () => {
      expect(getDownloadableFile('https://example.com/docs.html', 'docs.html')).toBeNull();
    });

    it('keeps a plain web link as a link', () => {
      expect(getDownloadableFile('https://example.com', 'example.com')).toBeNull();
    });

    it('keeps a normal labelled link as a link', () => {
      expect(getDownloadableFile('https://anthropic.com/news', 'read the news')).toBeNull();
    });
  });

  describe('non-files', () => {
    it('returns null for in-page anchors', () => {
      expect(getDownloadableFile('#section', 'Section')).toBeNull();
    });

    it('returns null for relative routes without an extension', () => {
      expect(getDownloadableFile('/dashboard', 'home')).toBeNull();
    });

    it('returns null when there is no filename anywhere', () => {
      expect(getDownloadableFile('', 'just some text')).toBeNull();
    });
  });

  describe('shouldGenerateFileExport', () => {
    it('generates app exports for bare, sandbox, and attachment hrefs', () => {
      expect(shouldGenerateFileExport('report.pdf')).toBe(true);
      expect(shouldGenerateFileExport('sandbox:/mnt/data/report.docx')).toBe(true);
      expect(shouldGenerateFileExport('attachment:/report.xlsx')).toBe(true);
    });

    it('does not generate app exports for existing Nash download URLs', () => {
      expect(shouldGenerateFileExport('/api/files/download/user/export_123')).toBe(false);
    });

    it('does not generate app exports for external http links', () => {
      expect(shouldGenerateFileExport('https://example.com/report.pdf')).toBe(false);
      expect(shouldGenerateFileExport('http://example.com/report.pdf')).toBe(false);
    });
  });
});
