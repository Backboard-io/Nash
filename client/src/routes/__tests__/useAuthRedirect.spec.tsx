/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import useAuthRedirect from '../useAuthRedirect';
import { useAuthContext } from '~/hooks';

// The redirect/timeout/redirect_to logic that used to live here moved into
// AuthContext (covered by AuthContext.spec.tsx). useAuthRedirect is now a thin
// pass-through of the auth state, so these tests verify that contract only.
jest.mock('~/hooks', () => ({
  useAuthContext: jest.fn(),
}));

function TestComponent() {
  const result = useAuthRedirect();
  (window as any).__testResult = result;
  return <div data-testid="test-component">Test Component</div>;
}

describe('useAuthRedirect', () => {
  beforeEach(() => {
    (window as any).__testResult = undefined;
  });

  afterEach(() => {
    jest.clearAllMocks();
    (window as any).__testResult = undefined;
  });

  it('returns user, roles, and isAuthenticated from the auth context', async () => {
    const mockUser = { id: '123', email: 'test@example.com' };
    const mockRoles = { USER: { name: 'USER' } };
    (useAuthContext as jest.Mock).mockReturnValue({
      user: mockUser,
      roles: mockRoles,
      isAuthenticated: true,
    });

    render(<TestComponent />);

    await waitFor(() => {
      const testResult = (window as any).__testResult;
      expect(testResult).toBeDefined();
      expect(testResult.user).toEqual(mockUser);
      expect(testResult.roles).toEqual(mockRoles);
      expect(testResult.isAuthenticated).toBe(true);
    });
  });

  it('passes through the unauthenticated state without redirecting', () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      user: null,
      roles: undefined,
      isAuthenticated: false,
    });

    const { getByTestId } = render(<TestComponent />);

    expect(getByTestId('test-component')).toBeInTheDocument();
    const testResult = (window as any).__testResult;
    expect(testResult.user).toBeNull();
    expect(testResult.isAuthenticated).toBe(false);
  });
});
