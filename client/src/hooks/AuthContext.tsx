import {
  useRef,
  useMemo,
  useState,
  useEffect,
  useContext,
  useCallback,
  createContext,
} from 'react';
import { useRecoilState } from 'recoil';
import { useNavigate } from 'react-router-dom';
import {
  restoreSessionKeyHeader,
  setSessionKeyHeader,
  SystemRoles,
} from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import type { ReactNode } from 'react';
import {
  useGetRole,
  useGetUserQuery,
  useApiKeyLoginMutation,
  useLogoutUserMutation,
} from '~/data-provider';
import {
  isSafeRedirect,
  buildLoginRedirectUrl,
  getPostLoginRedirect,
  persistRedirectToSession,
  REDIRECT_PARAM,
} from '~/utils';
import { TAuthConfig, TUserContext, TAuthContext, TResError } from '~/common';
import useTimeout from './useTimeout';
import store from '~/store';

const AuthContext = createContext<TAuthContext | undefined>(undefined);
const PUBLIC_AUTH_PATH_RE = /(?:^|\/)(?:login|register|forgot-password|reset-password)(?:\/|$)/;
const isPublicPreviewPath = (pathname: string) =>
  pathname === '/preview' || pathname.startsWith('/preview/');

const loginSessionToken = (data: t.TLoginResponse) => data.session_token || data.session_key || '';

const consumeSessionTokenFromLocation = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!rawHash) {
    return false;
  }

  const params = new URLSearchParams(rawHash);
  const sessionToken = params.get('session_token') || params.get('session_key') || '';
  if (!sessionToken) {
    return false;
  }

  setSessionKeyHeader(sessionToken);
  params.delete('session_token');
  params.delete('session_key');

  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`;
  window.history.replaceState(window.history.state, document.title, nextUrl);
  return true;
};

const AuthContextProvider = ({
  authConfig,
  children,
}: {
  authConfig?: TAuthConfig;
  children: ReactNode;
}) => {
  const [user, setUser] = useRecoilState(store.user);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const logoutRedirectRef = useRef<string | undefined>(undefined);
  const justLoggedOutRef = useRef(false);
  const pendingRedirectConsumedRef = useRef(false);
  const [sessionHeaderReady] = useState(() => {
    if (!consumeSessionTokenFromLocation()) {
      restoreSessionKeyHeader();
    }
    return true;
  });

  const { data: userRole = null } = useGetRole(SystemRoles.USER, {
    enabled: !!(isAuthenticated && (user?.role ?? '')),
  });
  const { data: adminRole = null } = useGetRole(SystemRoles.ADMIN, {
    enabled: !!(isAuthenticated && user?.role === SystemRoles.ADMIN),
  });

  const navigate = useNavigate();

  const setUserContext = useCallback(
    (userContext: TUserContext) => {
      const { isAuthenticated, user, redirect } = userContext;
      const searchParams = new URLSearchParams(window.location.search);
      const postLoginRedirect = isAuthenticated ? getPostLoginRedirect(searchParams) : null;

      const logoutRedirect = logoutRedirectRef.current;
      logoutRedirectRef.current = undefined;

      const explicitRedirect = redirect && isSafeRedirect(redirect) ? redirect : null;
      const finalRedirect = logoutRedirect ?? postLoginRedirect ?? explicitRedirect;

      setUser(user);
      setIsAuthenticated(isAuthenticated);

      if (finalRedirect != null) {
        navigate(finalRedirect, { replace: true });
      }
    },
    [navigate, setUser],
  );
  const doSetError = useTimeout({ callback: (error) => setError(error as string | undefined) });

  const applyLogoutState = useCallback(
    (redirect?: string) => {
      justLoggedOutRef.current = true;
      try {
        sessionStorage.clear();
        localStorage.clear();
      } catch {
        /* storage unavailable */
      }
      setUser(undefined);
      setIsAuthenticated(false);

      const logoutRedirect = logoutRedirectRef.current;
      logoutRedirectRef.current = undefined;
      const explicitRedirect = redirect && isSafeRedirect(redirect) ? redirect : null;
      navigate(logoutRedirect ?? explicitRedirect ?? '/login', { replace: true });
    },
    [navigate, setUser],
  );

  const logoutUser = useLogoutUserMutation({
    onSuccess: (data) => {
      applyLogoutState(data.redirect);
    },
    onError: (error) => {
      doSetError((error as Error).message);
      applyLogoutState();
    },
  });

  const logout = useCallback(
    (redirect?: string) => {
      if (redirect) {
        logoutRedirectRef.current = redirect;
      }
      logoutUser.mutate(undefined);
    },
    [logoutUser],
  );

  // The session_key cookie is the credential. If it's missing or invalid the
  // axios 401 interceptor will redirect to /login; if it's good /api/user
  // returns the current user and we flip isAuthenticated.
  const isOnPublicAuthPage = PUBLIC_AUTH_PATH_RE.test(window.location.pathname);
  const isOnPublicChatPreviewPage = isPublicPreviewPath(window.location.pathname);
  const userQuery = useGetUserQuery({
    enabled: sessionHeaderReady && !justLoggedOutRef.current && !isOnPublicAuthPage,
  });

  const apiKeyLoginMutation = useApiKeyLoginMutation({
    onSuccess: (data: t.TLoginResponse) => {
      const { user } = data;
      const sessionToken = loginSessionToken(data);
      if (sessionToken) {
        setSessionKeyHeader(sessionToken);
      }
      setError(undefined);
      setUserContext({ token: undefined, isAuthenticated: true, user, redirect: '/c/new' });
    },
    onError: (error: TResError | unknown) => {
      const resError = error as TResError;
      const serverMessage = resError?.response?.data?.message;
      doSetError(serverMessage || resError.message || 'Login failed');
    },
  });

  const apiKeyLogin = (apiKey: string) => {
    apiKeyLoginMutation.mutate({ apiKey });
  };

  useEffect(() => {
    if (userQuery.data) {
      setUser(userQuery.data);
      setIsAuthenticated(true);
    } else if (userQuery.isError) {
      doSetError((userQuery.error as Error).message);
      if (
        authConfig?.test !== true &&
        !isOnPublicAuthPage &&
        !isOnPublicChatPreviewPage &&
        !isPublicPreviewPath(window.location.pathname)
      ) {
        // Persist to sessionStorage as well as the login URL param so the
        // intended destination survives a login → register hop (the register
        // route doesn't carry the query string).
        const { pathname, search, hash } = window.location;
        persistRedirectToSession(`${pathname}${search}${hash}`);
        navigate(buildLoginRedirectUrl(), { replace: true });
      }
    }
    if (error != null && error && isAuthenticated) {
      doSetError(undefined);
    }
  }, [
    isAuthenticated,
    userQuery.data,
    userQuery.isError,
    userQuery.error,
    error,
    setUser,
    navigate,
    authConfig,
    isOnPublicAuthPage,
    isOnPublicChatPreviewPage,
  ]);

  // The 401 handler persists the intended destination (e.g. a shared-chat
  // link) to sessionStorage before bouncing to /login, so consume it here
  // once authentication completes. Read sessionStorage only (empty params)
  // and bail when a redirect_to URL param is present — that case is an
  // in-app login already handled by setUserContext, and racing it would
  // clobber the navigation.
  useEffect(() => {
    if (!isAuthenticated || pendingRedirectConsumedRef.current) {
      return;
    }
    if (new URLSearchParams(window.location.search).has(REDIRECT_PARAM)) {
      return;
    }
    const pending = getPostLoginRedirect(new URLSearchParams());
    if (pending != null) {
      pendingRedirectConsumedRef.current = true;
      navigate(pending, { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const memoedValue = useMemo(
    () => ({
      user,
      token: undefined,
      error,
      apiKeyLogin,
      logout,
      setError,
      roles: {
        [SystemRoles.USER]: userRole,
        [SystemRoles.ADMIN]: adminRole,
      },
      isAuthenticated,
    }),

    [user, error, isAuthenticated, userRole, adminRole],
  );

  return <AuthContext.Provider value={memoedValue}>{children}</AuthContext.Provider>;
};

const useAuthContext = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuthContext should be used inside AuthProvider');
  }

  return context;
};

export { AuthContextProvider, useAuthContext, AuthContext };
