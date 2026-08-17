import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSessionKey } from 'librechat-data-provider';

jest.mock('librechat-data-provider', () => ({
  getSessionKey: jest.fn(),
}));

jest.mock('../DialogImage', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' '),
}));

import DownloadableImage from '../DownloadableImage';

describe('DownloadableImage', () => {
  const originalCreateObjectURL = window.URL.createObjectURL;
  const originalRevokeObjectURL = window.URL.revokeObjectURL;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    (getSessionKey as jest.Mock).mockReturnValue('nash_sk_test');
    window.URL.createObjectURL = jest.fn(() => 'blob:nash-image');
    window.URL.revokeObjectURL = jest.fn();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: jest.fn().mockResolvedValue(new Blob(['image'], { type: 'image/png' })),
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  afterAll(() => {
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('fetches Nash download images with the X-Session-Key header and renders the blob URL', async () => {
    render(
      <DownloadableImage
        src="/api/files/download/user-dir/file-1"
        alt="Uploaded evidence"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/files/download/user-dir/file-1',
        expect.objectContaining({
          credentials: 'same-origin',
          headers: { 'X-Session-Key': 'nash_sk_test' },
        }),
      );
    });

    const image = await screen.findByRole('img', { name: 'Uploaded evidence' });
    expect(image).toHaveAttribute('src', 'blob:nash-image');
    expect(image).not.toHaveAttribute('src', '/api/files/download/user-dir/file-1');
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('normalizes absolute Nash download URLs before fetching with auth', async () => {
    render(
      <DownloadableImage
        src="http://localhost:3080/api/files/download/user-dir/file-1"
        alt="Persisted upload"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/files/download/user-dir/file-1',
        expect.objectContaining({
          credentials: 'same-origin',
          headers: { 'X-Session-Key': 'nash_sk_test' },
        }),
      );
    });

    const image = await screen.findByRole('img', { name: 'Persisted upload' });
    expect(image).toHaveAttribute('src', 'blob:nash-image');
    expect(image).not.toHaveAttribute(
      'src',
      'http://localhost:3080/api/files/download/user-dir/file-1',
    );
  });

  it('shows the fallback without logging diagnostics when the rendered image errors', async () => {
    render(
      <DownloadableImage
        src="/api/files/download/user-dir/file-1"
        alt="Unavailable evidence"
      />,
    );

    const image = await screen.findByRole('img', { name: 'Unavailable evidence' });
    fireEvent.error(image);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this image.");
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
