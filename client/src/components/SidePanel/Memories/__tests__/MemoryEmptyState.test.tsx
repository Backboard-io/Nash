import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import MemoryEmptyState from '../MemoryEmptyState';

const translations: Record<string, string> = {
  com_ui_memories_error: 'Something went wrong',
  com_ui_memories_error_desc: "We couldn't load memories. Please try again.",
  com_ui_no_memories_found: 'No memories found',
  com_ui_no_memories_found_desc: 'Try a different search.',
  com_ui_no_memories_title: 'No memories yet',
  com_ui_no_memories_desc: 'Saved memories will appear here when Nash learns something useful.',
  com_ui_add_memory: 'Add memory',
  com_ui_retry: 'Retry',
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => translations[key] || key,
}));

jest.mock('~/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

describe('MemoryEmptyState', () => {
  describe('empty variant', () => {
    test('renders title and description', () => {
      render(<MemoryEmptyState variant="empty" />);
      expect(screen.getByText('No memories yet')).toBeInTheDocument();
      expect(
        screen.getByText('Saved memories will appear here when Nash learns something useful.'),
      ).toBeInTheDocument();
    });

    test('renders Add memory button and fires callback', () => {
      const onAddMemory = jest.fn();
      render(<MemoryEmptyState variant="empty" onAddMemory={onAddMemory} />);
      const btn = screen.getByRole('button', { name: 'Add memory' });
      fireEvent.click(btn);
      expect(onAddMemory).toHaveBeenCalledTimes(1);
    });

    test('omits button when no callback provided', () => {
      render(<MemoryEmptyState variant="empty" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('no-results variant', () => {
    test('renders no-results copy and no button', () => {
      render(<MemoryEmptyState variant="no-results" onAddMemory={jest.fn()} />);
      expect(screen.getByText('No memories found')).toBeInTheDocument();
      expect(screen.getByText('Try a different search.')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('error variant', () => {
    test('renders error copy and Retry button that fires callback', () => {
      const onRetry = jest.fn();
      render(<MemoryEmptyState variant="error" onRetry={onRetry} />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(
        screen.getByText("We couldn't load memories. Please try again."),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test('omits Retry button when no callback provided', () => {
      render(<MemoryEmptyState variant="error" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  test('defaults to empty variant', () => {
    render(<MemoryEmptyState />);
    expect(screen.getByText('No memories yet')).toBeInTheDocument();
  });
});
