import React from 'react';
import { render, act } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type { TAuthConfig } from '~/common';

import { AuthContextProvider, useAuthContext } from '../AuthContext';

/**
 * Safari sign-in persistence: the session token handoff.
 *
 * After any sign-in the frontend must hydrate the `X-Session-Key` header before
 * the first `/api/user` request, because Safari's ITP drops the cross-site
 * `session_key` cookie and a cookie-only first request would 401 and bounce the
 * user back to login. These tests prove AuthContext installs the header from
 * every source (URL fragment, password login, API-key login) and does so
 * before the user query is enabled.
 */

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockSetSessionKeyHeader = jest.fn();
const mockRestoreSessionKeyHeader = jest.fn(() => false);
jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  setSessionKeyHeader: (...args: unknown[]) => mockSetSessionKeyHeader(...args),
  restoreSessionKeyHeader: (...args: unknown[]) => mockRestoreSessionKeyHeader(...args),
}));

let mockCapturedApiKeyOptions: { onSuccess: (data: unknown) => void };
let mockCapturedUserQueryOptions: { enabled?: boolean };
const mockUseGetUserQuery = jest.fn((options: { enabled?: boolean }) => {
  mockCapturedUserQueryOptions = options;
  return { data: undefined, isError: false, error: null };
});

jest.mock('~/data-provider', () => ({
  useApiKeyLoginMutation: jest.fn((options: { onSuccess: (data: unknown) => void }) => {
    mockCapturedApiKeyOptions = options;
    return { mutate: jest.fn() };
  }),
  useLogoutUserMutation: jest.fn(() => ({ mutate: jest.fn() })),
  useGetUserQuery: (options: { enabled?: boolean }) => mockUseGetUserQuery(options),
  useGetRole: jest.fn(() => ({ data: null })),
}));

const authConfig: TAuthConfig = { loginRedirect: '/login', test: true };

function TestConsumer() {
  const ctx = useAuthContext();
  return <div data-testid="consumer" data-authenticated={ctx.isAuthenticated} />;
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

function setLocation(hash: string, pathname = '/c/new', search = '') {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname, search, hash },
    writable: true,
    configurable: true,
  });
}

describe('AuthContextProvider — Safari session-token handoff', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRestoreSessionKeyHeader.mockReturnValue(false);
    jest.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
    setLocation('');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('consumes #session_token from the URL fragment and installs the header (OAuth/email redirect landing)', () => {
    setLocation('#session_token=sk_from_oauth');

    renderProvider();

    expect(mockSetSessionKeyHeader).toHaveBeenCalledWith('sk_from_oauth');
    // The fragment was consumed, so we do not fall back to restoring from storage.
    expect(mockRestoreSessionKeyHeader).not.toHaveBeenCalled();
    // And the token is stripped from the URL so it is not left in history.
    expect(window.history.replaceState).toHaveBeenCalled();
  });

  it('accepts the #session_key fragment name as a fallback', () => {
    setLocation('#session_key=sk_fallback');

    renderProvider();

    expect(mockSetSessionKeyHeader).toHaveBeenCalledWith('sk_fallback');
  });

  it('restores the header from storage when no fragment is present (refresh / cookie-only load)', () => {
    setLocation('');

    renderProvider();

    expect(mockRestoreSessionKeyHeader).toHaveBeenCalled();
    expect(mockSetSessionKeyHeader).not.toHaveBeenCalled();
  });

  it('Safari regression: installs the session header BEFORE the first /api/user query fires', () => {
    setLocation('#session_token=sk_race');

    renderProvider();

    expect(mockSetSessionKeyHeader).toHaveBeenCalledWith('sk_race');
    // The user query is gated on the header being ready...
    expect(mockCapturedUserQueryOptions.enabled).toBe(true);
    // ...and the header was installed before the query hook ran.
    const headerOrder = mockSetSessionKeyHeader.mock.invocationCallOrder[0];
    const queryOrder = mockUseGetUserQuery.mock.invocationCallOrder[0];
    expect(headerOrder).toBeLessThan(queryOrder);
  });

  it('falls back to session_key when a login response omits session_token', () => {
    renderProvider();

    act(() => {
      mockCapturedApiKeyOptions.onSuccess({ user: { id: 'u1' }, session_key: 'key_api' });
    });

    expect(mockSetSessionKeyHeader).toHaveBeenCalledWith('key_api');
  });

  it('stores the returned session_token on successful API-key login', () => {
    renderProvider();

    act(() => {
      mockCapturedApiKeyOptions.onSuccess({ user: { id: 'u2' }, session_token: 'tok_api' });
    });

    expect(mockSetSessionKeyHeader).toHaveBeenCalledWith('tok_api');
  });
});
