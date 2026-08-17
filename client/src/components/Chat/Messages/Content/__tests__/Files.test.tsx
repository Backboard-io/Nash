import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
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
});
