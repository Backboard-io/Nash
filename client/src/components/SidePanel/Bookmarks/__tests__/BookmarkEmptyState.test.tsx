import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import BookmarkEmptyState from '../BookmarkEmptyState';

const translations: Record<string, string> = {
  com_ui_bookmarks_error: 'Something went wrong',
  com_ui_bookmarks_error_desc: "We couldn't load your bookmarks. Please try again.",
  com_ui_bookmarks_no_results: 'No results found',
  com_ui_bookmarks_no_results_desc: 'Try a different search term or filter.',
  com_ui_bookmarks_category_empty: 'No bookmarks in this category yet',
  com_ui_bookmarks_category_empty_desc: 'This type of bookmark will appear here once you save one.',
  com_ui_no_bookmarks_title: 'No bookmarks yet',
  com_ui_bookmarks_empty_desc:
    'Bookmark useful responses, code, artifacts, or files to find them later.',
  com_ui_go_to_chats: 'Go to chats',
  com_ui_retry: 'Retry',
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => translations[key] || key,
}));

jest.mock('~/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

describe('BookmarkEmptyState', () => {
  describe('empty variant', () => {
    test('renders title and description', () => {
      render(<BookmarkEmptyState variant="empty" />);
      expect(screen.getByText('No bookmarks yet')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Bookmark useful responses, code, artifacts, or files to find them later.',
        ),
      ).toBeInTheDocument();
    });

    test('renders Go to chats button and fires callback', () => {
      const onGoToChats = jest.fn();
      render(<BookmarkEmptyState variant="empty" onGoToChats={onGoToChats} />);
      const btn = screen.getByRole('button', { name: 'Go to chats' });
      fireEvent.click(btn);
      expect(onGoToChats).toHaveBeenCalledTimes(1);
    });

    test('omits button when no callback provided', () => {
      render(<BookmarkEmptyState variant="empty" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('no-results variant', () => {
    test('renders no-results copy and no button', () => {
      render(<BookmarkEmptyState variant="no-results" onGoToChats={jest.fn()} />);
      expect(screen.getByText('No results found')).toBeInTheDocument();
      expect(screen.getByText('Try a different search term or filter.')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('category-empty variant', () => {
    test('renders category-empty copy and no button', () => {
      render(<BookmarkEmptyState variant="category-empty" onGoToChats={jest.fn()} />);
      expect(screen.getByText('No bookmarks in this category yet')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('error variant', () => {
    test('renders error copy and Retry button that fires callback', () => {
      const onRetry = jest.fn();
      render(<BookmarkEmptyState variant="error" onRetry={onRetry} />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(
        screen.getByText("We couldn't load your bookmarks. Please try again."),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test('omits Retry button when no callback provided', () => {
      render(<BookmarkEmptyState variant="error" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  test('defaults to empty variant', () => {
    render(<BookmarkEmptyState />);
    expect(screen.getByText('No bookmarks yet')).toBeInTheDocument();
  });
});
