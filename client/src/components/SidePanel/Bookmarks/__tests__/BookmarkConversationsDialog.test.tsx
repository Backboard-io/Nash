import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import BookmarkConversationsDialog from '../BookmarkConversationsDialog';

const translations: Record<string, string> = {
  com_ui_conversation: 'conversation',
  com_ui_conversations: 'conversations',
  com_ui_loading: 'Loading',
  com_ui_error: 'Something went wrong',
  com_ui_nothing_found: 'Nothing found',
  com_ui_new_chat: 'New chat',
};

const mockNavigateToConvo = jest.fn();

/* The regression this file guards: opening a conversation from the bookmarks
 * dialog MUST go through useNavigateToConvo (which prepares conversation state
 * the way a sidebar click does). A bare navigate('/c/<id>') strands ChatRoute
 * on an infinite spinner once any chat was previously opened in the tab. */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => translations[key] || key,
  useNavigateToConvo: () => ({ navigateToConvo: mockNavigateToConvo }),
}));

const mockConversations = [
  { conversationId: 'c-1', title: 'Jazz talk' },
  { conversationId: 'c-2', title: 'Cat facts' },
];

jest.mock('~/data-provider', () => ({
  useConversationsInfiniteQuery: jest.fn(() => ({
    data: { pages: [{ conversations: mockConversations }] },
    isLoading: false,
    isError: false,
  })),
}));

jest.mock('@librechat/client', () => ({
  OGDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  OGDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Spinner: () => <div data-testid="spinner" />,
}));

describe('BookmarkConversationsDialog', () => {
  beforeEach(() => {
    mockNavigateToConvo.mockClear();
  });

  it('lists the conversations carrying the bookmark', () => {
    render(<BookmarkConversationsDialog tag="funny" open onOpenChange={jest.fn()} />);
    expect(screen.getByText('Jazz talk')).toBeInTheDocument();
    expect(screen.getByText('Cat facts')).toBeInTheDocument();
    expect(screen.getByText('2 conversations')).toBeInTheDocument();
  });

  it('opens a conversation via navigateToConvo with the full conversation object', () => {
    const onOpenChange = jest.fn();
    render(<BookmarkConversationsDialog tag="funny" open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByText('Jazz talk'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigateToConvo).toHaveBeenCalledTimes(1);
    expect(mockNavigateToConvo).toHaveBeenCalledWith(mockConversations[0]);
  });

  it('ignores clicks on conversations without an id', () => {
    const { useConversationsInfiniteQuery } = jest.requireMock('~/data-provider');
    useConversationsInfiniteQuery.mockReturnValueOnce({
      data: { pages: [{ conversations: [{ conversationId: null, title: 'Ghost' }] }] },
      isLoading: false,
      isError: false,
    });
    render(<BookmarkConversationsDialog tag="funny" open onOpenChange={jest.fn()} />);
    fireEvent.click(screen.getByText('Ghost'));
    expect(mockNavigateToConvo).not.toHaveBeenCalled();
  });
});
