import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecoilRoot, useRecoilValue } from 'recoil';
import store from '~/store';
import TemporaryChatToggle from './TemporaryChatToggle';

// Real Recoil + real `~/store` (the same isTemporary atom the submission path
// reads). Only the chat context, tooltip shell, and localize are mocked.

const mockNewConversation = jest.fn();
const mockChatCtx: {
  conversation: { conversationId: string; messages: unknown[] } | null;
  isSubmitting: boolean;
  newConversation: jest.Mock;
} = {
  conversation: { conversationId: 'new', messages: [] },
  isSubmitting: false,
  newConversation: mockNewConversation,
};

jest.mock('~/Providers', () => ({
  useChatContext: () => mockChatCtx,
}));

jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ render: element }: { render: React.ReactElement }) => element,
}));

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string) =>
      ({
        com_ui_temporary_on: 'Start a temporary chat',
        com_ui_temporary_off: 'Turn off temporary chat',
      })[key] ?? key,
}));

function TempStateProbe() {
  const isTemporary = useRecoilValue(store.isTemporary);
  return <div data-testid="temp-state">{String(isTemporary)}</div>;
}

beforeEach(() => {
  localStorage.clear();
  mockNewConversation.mockClear();
  mockChatCtx.conversation = { conversationId: 'new', messages: [] };
  mockChatCtx.isSubmitting = false;
});

test('idle state shows "Start a temporary chat" and toggles to active purple state', () => {
  render(
    <RecoilRoot>
      <TemporaryChatToggle />
      <TempStateProbe />
    </RecoilRoot>,
  );

  const idle = screen.getByRole('button', { name: 'Start a temporary chat' });
  expect(idle).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByTestId('temp-state')).toHaveTextContent('false');

  fireEvent.click(idle);

  const active = screen.getByRole('button', { name: 'Turn off temporary chat' });
  expect(active).toHaveAttribute('aria-pressed', 'true');
  expect(active.className).toContain('brand-purple');
  expect(screen.getByTestId('temp-state')).toHaveTextContent('true');
  // Fresh conversation: toggling must NOT navigate away.
  expect(mockNewConversation).not.toHaveBeenCalled();

  fireEvent.click(active);
  expect(screen.getByRole('button', { name: 'Start a temporary chat' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('toggling while the conversation has messages starts a fresh chat', () => {
  mockChatCtx.conversation = { conversationId: 'c1', messages: [{ messageId: 'm1' }] };
  render(
    <RecoilRoot>
      <TemporaryChatToggle />
    </RecoilRoot>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Start a temporary chat' }));
  expect(mockNewConversation).toHaveBeenCalledTimes(1);
});

test('disabled while submitting', () => {
  mockChatCtx.isSubmitting = true;
  render(
    <RecoilRoot>
      <TemporaryChatToggle />
    </RecoilRoot>,
  );
  expect(screen.getByRole('button', { name: 'Start a temporary chat' })).toBeDisabled();
});
