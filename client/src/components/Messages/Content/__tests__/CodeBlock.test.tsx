import React from 'react';
import { render } from '@testing-library/react';
import CodeBlock from '~/components/Messages/Content/CodeBlock';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('CodeBlock', () => {
  it('contains long pasted lines inside a horizontally scrollable code area', () => {
    const longLine = `const pasted = "${'x'.repeat(3000)}";`;
    const { container } = render(
      <CodeBlock lang="js" codeChildren={longLine} allowExecution={false} />,
    );

    const block = container.firstElementChild as HTMLElement;
    expect(block).toHaveClass('min-w-0');
    expect(block).toHaveClass('max-w-full');
    expect(block).toHaveClass('overflow-hidden');

    const scroller = block.querySelector('.overflow-x-auto');
    expect(scroller).toBeInTheDocument();
    expect(scroller).toHaveClass('max-w-full');

    const code = block.querySelector('code');
    expect(code).toHaveClass('block');
    expect(code).toHaveTextContent(longLine);
  });
});
