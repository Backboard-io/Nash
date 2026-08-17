// Mock react-markdown's default transform with a faithful stand-in: it allows a
// small safe-scheme list and strips everything else to '' (matching the real
// library's behaviour, which is the whole reason sandbox:/attachment: hrefs were
// being lost). Mocking also keeps Jest away from react-markdown's ESM-only build.
// The factory is fully self-contained — jest.mock is hoisted above the file, so
// it must not reference any outer-scope variable.
jest.mock('react-markdown', () => {
  const safe = new Set(['http', 'https', 'mailto', 'tel', 'irc', 'ircs', 'xmpp']);
  return {
    defaultUrlTransform: jest.fn((url: string): string => {
      const colon = url.indexOf(':');
      const slash = url.indexOf('/');
      const hasScheme = colon !== -1 && (slash === -1 || colon < slash);
      if (!hasScheme) {
        return url; // relative href — always allowed
      }
      const scheme = url.slice(0, colon).toLowerCase();
      return safe.has(scheme) ? url : '';
    }),
  };
});

import { defaultUrlTransform } from 'react-markdown';
import { downloadableUrlTransform } from './markdownUrlTransform';

const mockDefaultUrlTransform = defaultUrlTransform as jest.Mock;

describe('downloadableUrlTransform', () => {
  beforeEach(() => mockDefaultUrlTransform.mockClear());

  describe('assistant file schemes are preserved (not stripped)', () => {
    it('keeps a sandbox: href intact', () => {
      expect(downloadableUrlTransform('sandbox:/mnt/data/hello.html')).toBe(
        'sandbox:/mnt/data/hello.html',
      );
      expect(mockDefaultUrlTransform).not.toHaveBeenCalled();
    });

    it('keeps an attachment: href intact', () => {
      expect(downloadableUrlTransform('attachment:/out.csv')).toBe('attachment:/out.csv');
      expect(mockDefaultUrlTransform).not.toHaveBeenCalled();
    });

    it('matches the scheme case-insensitively', () => {
      expect(downloadableUrlTransform('SANDBOX:/mnt/data/x.pdf')).toBe('SANDBOX:/mnt/data/x.pdf');
    });
  });

  describe('everything else is delegated to the default transform', () => {
    it('passes http(s) URLs through unchanged', () => {
      expect(downloadableUrlTransform('https://example.com/report.pdf')).toBe(
        'https://example.com/report.pdf',
      );
      expect(mockDefaultUrlTransform).toHaveBeenCalledWith('https://example.com/report.pdf');
    });

    it('still blocks javascript: (default strips it to empty)', () => {
      expect(downloadableUrlTransform('javascript:alert(1)')).toBe('');
      expect(mockDefaultUrlTransform).toHaveBeenCalledWith('javascript:alert(1)');
    });

    it('still blocks data: (default strips it to empty)', () => {
      expect(downloadableUrlTransform('data:text/html,<script>')).toBe('');
    });

    it('passes relative hrefs through unchanged', () => {
      expect(downloadableUrlTransform('sample.html')).toBe('sample.html');
      expect(mockDefaultUrlTransform).toHaveBeenCalledWith('sample.html');
    });
  });
});
