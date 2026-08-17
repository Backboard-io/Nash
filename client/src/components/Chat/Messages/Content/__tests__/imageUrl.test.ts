import { resolveImageSource } from '../imageUrl';

describe('resolveImageSource', () => {
  it('leaves Nash-managed generated image paths same-origin', () => {
    expect(resolveImageSource('/images/generated.png', '/nash')).toBe('/images/generated.png');
  });

  it('leaves persisted upload download paths same-origin', () => {
    expect(resolveImageSource('/api/files/download/user-dir/file-1', 'http://localhost:3080')).toBe(
      '/api/files/download/user-dir/file-1',
    );
  });

  it('normalizes Nash-managed download paths to same-origin paths', () => {
    expect(resolveImageSource('api/files/download/user-dir/file-1')).toBe(
      '/api/files/download/user-dir/file-1',
    );
    expect(resolveImageSource('http://localhost:3080/api/files/download/user-dir/file-1')).toBe(
      '/api/files/download/user-dir/file-1',
    );
  });

  it('normalizes raw local upload paths to authenticated download paths', () => {
    expect(
      resolveImageSource(
        '/tmp/nash/uploads/fixture-user@example.com/7e68fc44-cfe2-4855-8931-74c5f84469c7_clipboard_1784054067841_image.png',
      ),
    ).toBe(
      '/api/files/download/fixture-user@example.com/7e68fc44-cfe2-4855-8931-74c5f84469c7',
    );
  });

  it('does not rewrite external lookalike Nash paths', () => {
    expect(resolveImageSource('https://example.com/api/files/download/user-dir/file-1')).toBe(
      'https://example.com/api/files/download/user-dir/file-1',
    );
  });

  it('leaves non-Nash and already absolute image sources unchanged', () => {
    expect(resolveImageSource('/assets/logo.png', '/nash')).toBe('/assets/logo.png');
    expect(resolveImageSource('https://example.com/image.png', '/nash')).toBe(
      'https://example.com/image.png',
    );
    expect(resolveImageSource('data:image/png;base64,abc', '/nash')).toBe(
      'data:image/png;base64,abc',
    );
  });
});
