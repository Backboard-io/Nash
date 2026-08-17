import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type { TAuthConfig } from '~/common';

import { AuthContextProvider, useAuthContext } from '../AuthContext';
import { SESSION_KEY } from '~/utils';
import { setSessionKeyHeader } from 'librechat-data-provider';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  setTokenHeader: jest.fn(),
  setSessionKeyHeader: jest.fn(),
}));

let mockCapturedApiKeyOptions: {
  onSuccess: (...args: unknown[]) => void;
  onError: (...args: unknown[]) => void;
};
let mockLogoutMutationOptions: {
  onSuccess?: (data: { message: string; redirect?: string }) => void;
};

jest.mock('~/data-provider', () => ({
  useApiKeyLoginMutation: jest.fn(
    (options: {
      onSuccess: (...args: unknown[]) => void;
      onError: (...args: unknown[]) => void;
    }) => {
      mockCapturedApiKeyOptions = options;
      return { mutate: jest.fn() };
    },
  ),
  useLogoutUserMutation: jest.fn(
    (options: { onSuccess?: (data: { message: string; redirect?: string }) => void }) => {
      mockLogoutMutationOptions = options;
      return { mutate: jest.fn() };
    },
  ),
  useGetUserQuery: jest.fn(() => ({
    data: undefined,
    isError: false,
    error: null,
  })),
  useGetRole: jest.fn(() => ({ data: null })),
}));

const authConfig: TAuthConfig = { loginRedirect: '/login', test: true };

function TestConsumer() {
  const ctx = useAuthContext();
  return (
    <div data-testid="consumer" data-authenticated={ctx.isAuthenticated} data-error={ctx.error} />
  );
}

function renderProvider(config: TAuthConfig = authConfig) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <MemoryRouter>
          <AuthContextProvider authConfig={config}>
            <TestConsumer />
          </AuthContextProvider>
        </MemoryRouter>
      </RecoilRoot>
    </QueryClientProvider>,
  );
}

describe('AuthContextProvider — api-key login handling', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, pathname: '/login', search: '', hash: '' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('stores the returned session key after api-key login succeeds', () => {
    renderProvider();

    act(() => {
      mockCapturedApiKeyOptions.onSuccess({
        session_key: 'nash_sk_apikey',
        user: {
          id: 'user-1',
          email: 'apikey-user@apikey.nash.local',
          name: 'API Key User',
          username: 'apikey-user',
          provider: 'apikey',
          role: 'USER',
        },
      });
    });

    expect(setSessionKeyHeader).toHaveBeenCalledWith('nash_sk_apikey');
    expect(mockNavigate).toHaveBeenCalledWith('/c/new', { replace: true });
  });

  it('does not navigate away from /login on a failed api-key login', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/login', search: '?redirect_to=%2Fc%2Fabc123', hash: '' },
      writable: true,
      configurable: true,
    });

    renderProvider();

    act(() => {
      mockCapturedApiKeyOptions.onError({ message: 'Invalid API key' });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('honors a pending redirect_to after successful api-key login', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/login', search: '?redirect_to=%2Fshare%2Fabc123', hash: '' },
      writable: true,
      configurable: true,
    });

    renderProvider();

    act(() => {
      mockCapturedApiKeyOptions.onSuccess({
        session_key: 'nash_sk_apikey',
        user: { id: 'user-1', provider: 'apikey', role: 'USER' },
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/share/abc123', { replace: true });
  });

  it('logout navigates to /login and ignores stale post-login session redirect', async () => {
    sessionStorage.setItem(SESSION_KEY, '/c/abc123');
    Object.defineProperty(window, 'location', {
      value: { pathname: '/c/new', search: '', hash: '' },
      writable: true,
      configurable: true,
    });

    renderProvider();

    await act(async () => {
      mockLogoutMutationOptions.onSuccess?.({ message: 'Logged out' });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
