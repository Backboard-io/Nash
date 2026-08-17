import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TConversationTag } from 'librechat-data-provider';
import BookmarkList from '../BookmarkList';

const translations: Record<string, string> = {
  com_ui_bookmarks: 'Bookmarks',
  com_ui_bookmarks_error: 'Something went wrong',
  com_ui_bookmarks_no_results: 'No results found',
  com_ui_no_bookmarks_title: 'No bookmarks yet',
  com_ui_retry: 'Retry',
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => translations[key] || key,
}));

jest.mock('~/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Avoid pulling the data-provider / @librechat/client tree through BookmarkCard.
jest.mock('../BookmarkCard', () => ({
  __esModule: true,
  default: ({ bookmark }: { bookmark: TConversationTag }) => (
    <div data-testid="bookmark-card">{bookmark.tag}</div>
  ),
}));

const makeBookmark = (id: string, tag: string): TConversationTag => ({
  _id: id,
  user: 'user-1',
  tag,
  description: '',
  count: 1,
  position: 0,
  createdAt: '2026-04-07T00:00:00.000Z',
  updatedAt: '2026-04-07T00:00:00.000Z',
});

describe('BookmarkList', () => {
  test('renders error state and wires retry', () => {
    const onRetry = jest.fn();
    render(<BookmarkList bookmarks={[]} isError onRetry={onRetry} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('renders loading skeletons', () => {
    const { container } = render(<BookmarkList bookmarks={[]} isLoading />);
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).toBeInTheDocument();
    // 3 skeleton cards, 3 pulse bars each.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(9);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  test('renders empty state when not filtered', () => {
    const onGoToChats = jest.fn();
    render(<BookmarkList bookmarks={[]} onGoToChats={onGoToChats} />);
    expect(screen.getByText('No bookmarks yet')).toBeInTheDocument();
  });

  test('renders no-results state when filtered', () => {
    render(<BookmarkList bookmarks={[]} emptyVariant="no-results" />);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  test('renders a card per bookmark when populated', () => {
    const bookmarks = [makeBookmark('a', 'first bookmark'), makeBookmark('b', 'second bookmark')];
    render(<BookmarkList bookmarks={bookmarks} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('first bookmark')).toBeInTheDocument();
    expect(screen.getByText('second bookmark')).toBeInTheDocument();
  });
});
