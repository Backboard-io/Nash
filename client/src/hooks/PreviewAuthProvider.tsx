import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { SystemRoles, setSessionKeyHeader } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import type { TAuthContext, TResError } from '~/common';
import { useApiKeyLoginMutation, useLogoutUserMutation } from '~/data-provider';
import { AuthContext } from './AuthContext';

const getReturnedSessionKey = (data: t.TLoginResponse) =>
  (data as t.TLoginResponse & { session_key?: string }).session_key || data.session_token;

export function PreviewAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<t.TUser | undefined>(undefined);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const logoutMutation = useLogoutUserMutation({
    onSuccess: () => {
      setUser(undefined);
      setToken(undefined);
      setError(undefined);
      setIsAuthenticated(false);
    },
    onError: () => {
      setUser(undefined);
      setToken(undefined);
      setIsAuthenticated(false);
    },
  });

  const apiKeyLoginMutation = useApiKeyLoginMutation({
    onSuccess: (data: t.TLoginResponse) => {
      const { user, token } = data;
      const sessionKey = getReturnedSessionKey(data);
      if (sessionKey) {
        setSessionKeyHeader(sessionKey);
      }
      setError(undefined);
      setUser(user);
      setToken(token);
      setIsAuthenticated(true);
    },
    onError: (err: TResError | unknown) => {
      const resError = err as TResError;
      const serverMessage = (resError as any)?.response?.data?.message;
      setError(serverMessage || resError.message || 'Login failed');
    },
  });

  const apiKeyLogin = useCallback((apiKey: string) => {
    apiKeyLoginMutation.mutate({ apiKey });
  }, [apiKeyLoginMutation]);

  const logout = useCallback((redirect?: string) => {
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        if (redirect) {
          navigate(redirect, { replace: true });
        }
      },
    });
  }, [logoutMutation, navigate]);

  const value = useMemo<TAuthContext>(
    () => ({
      user,
      token,
      error,
      apiKeyLogin,
      logout,
      setError,
      isAuthenticated,
      roles: {
        [SystemRoles.USER]: null,
        [SystemRoles.ADMIN]: null,
      },
    }),
    [user, token, error, apiKeyLogin, logout, isAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
