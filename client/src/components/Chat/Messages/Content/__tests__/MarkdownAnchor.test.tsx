import React from 'react';
import { render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { useLocalize } from '~/hooks';

// The card uses useLocalize; the anchor's download wiring lives in LogLink.
// Mock both so we can render the anchor in isolation.
jest.mock('~/hooks');
jest.mock('../Parts/LogLink', () => ({
  useAttachmentLink: () => ({ handleDownload: jest.fn() }),
}));

// Imported after the mocks above are registered.
import { a as Anchor } from '../MarkdownComponents';

const renderAnchor = (href: string, children: React.ReactNode) =>
  render(
    <RecoilRoot>
      <Anchor href={href} children={children} />
    </RecoilRoot>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalize as jest.Mock).mockReturnValue((key: string) => key);
});

describe('markdown <a> rendering', () => {
  it('renders a download card (not a bare link) for a model-offered file link', () => {
    renderAnchor('sample.html', 'sample.html');
    // The card surfaces the filename and a Download button (aria-label = filename).
    expect(screen.getByRole('button', { name: 'sample.html' })).toBeInTheDocument();
    expect(screen.getByText('sample.html')).toBeInTheDocument();
    // It must NOT fall through to the plain blue link.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a download card for an external file URL', () => {
    renderAnchor('https://example.com/reports/q3.pdf', 'q3.pdf');
    expect(screen.getByRole('button', { name: 'q3.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps an ordinary web link as a link', () => {
    renderAnchor('https://example.com', 'example.com');
    expect(screen.getByRole('link', { name: 'example.com' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps an external .html page as a link, not a download', () => {
    renderAnchor('https://example.com/docs.html', 'docs.html');
    expect(screen.getByRole('link')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
