import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
jest.mock('../DownloadableImage', () => ({
  __esModule: true,
  default: ({ src }: { src: string }) => <img data-testid="downloadable" src={src} alt="" />,
}));

import Files from '../Files';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  getSessionKey: jest.fn(() => 'session-key'),
}));

const clipboardWriteText = jest.fn();

describe('message file rendering', () => {
  beforeEach(() => {
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
    global.URL.createObjectURL = jest.fn(() => 'blob:download-url');
    global.URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens pasted text files in a document viewer with copy and download actions', async () => {
    const message = {
      messageId: 'm1',
      conversationId: 'c1',
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: '',
      isCreatedByUser: true,
      files: [
        {
          file_id: 'pasted-1',
          filename: 'Pasted text.txt',
          filepath: '',
          type: 'text/plain',
          bytes: 42,
          metadata: {
            isPastedBlock: true,
            displayLanguage: 'Text',
            displayText: 'Wikipedia\\nThe Free Encyclopedia',
            lineCount: 2,
          },
        },
      ],
    } as TMessage;

    render(<Files message={message} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pasted text.txt' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Wikipedia\\nThe Free Encyclopedia')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy document text' }));
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith('Wikipedia\\nThe Free Encyclopedia');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Download document text' }));
    expect(global.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:download-url');
  });

  it('renders an attached image from the server path, not the revoked blob preview', () => {
    // `useFileHandling` revokes the object URL once the upload fires, but the
    // dead string is still carried onto the optimistic user message.
    const message = {
      messageId: 'm2',
      conversationId: 'c1',
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: 'look at this',
      isCreatedByUser: true,
      files: [
        {
          file_id: 'img-1',
          filename: 'cat.png',
          filepath: '/uploads/user@example.com/img-1_cat.png',
          preview: 'blob:revoked-preview',
          type: 'image/png',
        },
      ],
    } as TMessage;

    render(<Files message={message} />);

    // `resolveImageSource` maps the upload path onto the Nash download route.
    expect(screen.getByTestId('downloadable')).toHaveAttribute(
      'src',
      '/api/files/download/user@example.com/img-1',
    );
  });

  it('falls back to the local preview while the upload has no server path yet', () => {
    const message = {
      messageId: 'm3',
      conversationId: 'c1',
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: '',
      isCreatedByUser: true,
      files: [
        {
          file_id: 'img-2',
          filename: 'dog.png',
          preview: 'blob:still-live',
          type: 'image/png',
        },
      ],
    } as TMessage;

    render(<Files message={message} />);

    expect(screen.getByTestId('downloadable')).toHaveAttribute('src', 'blob:still-live');
  });
});
