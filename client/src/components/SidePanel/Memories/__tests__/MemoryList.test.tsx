import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TUserMemory } from 'librechat-data-provider';
import MemoryList from '../MemoryList';

const translations: Record<string, string> = {
  com_ui_memories: 'Memories',
  com_ui_memories_error: 'Something went wrong',
  com_ui_no_memories_found: 'No memories found',
  com_ui_no_memories_title: 'No memories yet',
  com_ui_retry: 'Retry',
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => translations[key] || key,
}));

jest.mock('~/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Avoid pulling the data-provider / @librechat/client tree through MemoryCard.
jest.mock('../MemoryCard', () => ({
  __esModule: true,
  default: ({ memory }: { memory: TUserMemory }) => (
    <div data-testid="memory-card">{memory.value}</div>
  ),
}));

const makeMemory = (key: string, value: string): TUserMemory => ({
  key,
  value,
  updated_at: '2026-04-07T00:00:00.000Z',
  tokenCount: 20,
});

describe('MemoryList', () => {
  test('renders error state and wires retry', () => {
    const onRetry = jest.fn();
    render(<MemoryList memories={[]} hasUpdateAccess isError onRetry={onRetry} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('renders loading skeletons', () => {
    const { container } = render(<MemoryList memories={[]} hasUpdateAccess isLoading />);
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).toBeInTheDocument();
    // 3 skeleton cards, 3 pulse bars each.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(9);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  test('renders empty state when not filtered', () => {
    const onAddMemory = jest.fn();
    render(<MemoryList memories={[]} hasUpdateAccess onAddMemory={onAddMemory} />);
    expect(screen.getByText('No memories yet')).toBeInTheDocument();
  });

  test('renders no-results state when filtered', () => {
    render(<MemoryList memories={[]} hasUpdateAccess emptyVariant="no-results" />);
    expect(screen.getByText('No memories found')).toBeInTheDocument();
  });

  test('renders a card per memory when populated', () => {
    const memories = [makeMemory('a', 'first memory'), makeMemory('b', 'second memory')];
    render(<MemoryList memories={memories} hasUpdateAccess />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('first memory')).toBeInTheDocument();
    expect(screen.getByText('second memory')).toBeInTheDocument();
  });
});
