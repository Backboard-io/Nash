import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import type { TStartupConfig } from 'librechat-data-provider';
import { TranslationKeys, useLocalize } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import AuthLayout from '~/components/Auth/AuthLayout';
import { REDIRECT_PARAM, SESSION_KEY } from '~/utils';

const headerMap: Record<string, TranslationKeys> = {
  '/login': 'com_auth_welcome_back',
  '/register': 'com_auth_create_account',
  '/forgot-password': 'com_auth_reset_password',
  '/reset-password': 'com_auth_reset_password',
  '/login/2fa': 'com_auth_verify_your_identity',
  '/login/mfa-enroll': 'com_auth_verify_your_identity',
};

/* Figma subtitles shown under each auth heading (brand copy, English — matching
 * the hardcoded legal/footer strings used elsewhere in the auth surface). */
const subtitleMap: Record<string, string> = {
  '/login': 'Log in to pick up right where you left off.',
  '/register': 'Set up Nash for yourself or your team in under a minute.',
  '/forgot-password': 'Enter your email to reset your password',
  '/reset-password': 'Choose a new password',
};

export default function StartupLayout({ isAuthenticated }: { isAuthenticated?: boolean }) {
  const [error, setError] = useState<TranslationKeys | null>(null);
  const [headerText, setHeaderText] = useState<TranslationKeys | null>(null);
  const [startupConfig, setStartupConfig] = useState<TStartupConfig | null>(null);
  const {
    data,
    isFetching,
    error: startupConfigError,
  } = useGetStartupConfig({
    enabled: isAuthenticated ? startupConfig === null : true,
  });
  const localize = useLocalize();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      const hasPendingRedirect =
        new URLSearchParams(location.search).has(REDIRECT_PARAM) ||
        sessionStorage.getItem(SESSION_KEY) != null;
      if (!hasPendingRedirect) {
        navigate('/c/new', { replace: true });
      }
    }
    if (data) {
      setStartupConfig(data);
    }
  }, [isAuthenticated, navigate, data, location.search]);

  useEffect(() => {
    document.title = startupConfig?.appTitle || 'Nash';
  }, [startupConfig?.appTitle]);

  useEffect(() => {
    setError(null);
    setHeaderText(null);
  }, [location.pathname]);

  const contextValue = {
    error,
    setError,
    headerText,
    setHeaderText,
    startupConfigError,
    startupConfig,
    isFetching,
  };

  return (
    <AuthLayout
      header={headerText ? localize(headerText) : localize(headerMap[location.pathname])}
      subheader={subtitleMap[location.pathname]}
      isFetching={isFetching}
      startupConfig={startupConfig}
      startupConfigError={startupConfigError}
      pathname={location.pathname}
      error={error}
    >
      <Outlet context={contextValue} />
    </AuthLayout>
  );
}
