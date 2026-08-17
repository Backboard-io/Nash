import React from 'react';
import { render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import Root from '../Root';

jest.mock('@librechat/client', () => ({
  useMediaQuery: jest.fn(() => false),
}));

jest.mock('~/hooks', () => ({
  useSearchEnabled: jest.fn(),
  useAssistantsMap: jest.fn(() => ({})),
  useAuthContext: jest.fn(() => ({
    isAuthenticated: true,
    logout: jest.fn(),
    user: {
      role: 'ADMIN',
      twoFactorEnabled: false,
    },
  })),
  useAgentsMap: jest.fn(() => ({})),
  useFileMap: jest.fn(() => ({})),
  useLocalize: jest.fn(() => (key: string) => key),
}));

jest.mock('~/Providers', () => {
  const React = require('react');
  return {
    PromptGroupsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    AssistantsMapContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
    AgentsMapContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
    SetConvoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    FileMapContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  };
});

jest.mock('~/data-provider', () => ({
  useUserTermsQuery: jest.fn(() => ({ data: { termsAccepted: true } })),
  useInitQuery: jest.fn(),
  useHealthCheck: jest.fn(),
  useGetBackboardOrgsQuery: jest.fn(() => ({ data: undefined })),
  useGetAuthContextsQuery: jest.fn(() => ({ data: undefined })),
}));

jest.mock('~/components/Nav', () => ({
  Nav: () => <div>nav</div>,
  MobileNav: () => <div>mobile-nav</div>,
  NAV_WIDTH: { MOBILE: 320 },
}));

jest.mock('~/components/ui', () => ({
  CookieConsentBanner: () => <div>cookie-banner</div>,
  TermsGate: () => <div>terms-gate</div>,
}));

jest.mock('~/components/Banners', () => ({
  Banner: () => <div>banner</div>,
}));

jest.mock('~/components/Auth', () => ({
  AuthModal: () => <div>auth-modal</div>,
}));

const renderRoot = () =>
  render(
    <RecoilRoot>
      <MemoryRouter>
        <Root />
      </MemoryRouter>
    </RecoilRoot>,
  );

describe('Root', () => {
  it('renders the main shell for an authenticated admin once terms are accepted', () => {
    renderRoot();

    expect(screen.getByText('nav')).toBeInTheDocument();
    // Terms are accepted, so the terms gate should not block the shell.
    expect(screen.queryByText('terms-gate')).not.toBeInTheDocument();
  });
});
