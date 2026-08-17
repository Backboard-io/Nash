import React from 'react';
import { render } from '@testing-library/react';
import MarkdownLite from '../MarkdownLite';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/hooks/Roles/useHasAccess', () => ({
  __esModule: true,
  default: () => false,
}));

describe('MarkdownLite code overflow', () => {
  it('keeps long pasted code blocks constrained to the message width', () => {
    const longLine = `const pasted = "${'x'.repeat(3000)}";`;
    const { container } = render(<MarkdownLite content={`\`\`\`js\n${longLine}\n\`\`\``} />);

    const pre = container.querySelector('pre');
    expect(pre).toHaveClass('min-w-0');
    expect(pre).toHaveClass('max-w-full');
    expect(pre).toHaveClass('overflow-hidden');

    const scroller = container.querySelector('.overflow-x-auto');
    expect(scroller).toBeInTheDocument();
    expect(scroller).toHaveClass('max-w-full');

    const code = container.querySelector('code');
    expect(code).toHaveClass('block');
    expect(code).toHaveTextContent(longLine);
  });
});
