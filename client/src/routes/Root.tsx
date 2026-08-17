import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useRecoilState } from 'recoil';
import { useMediaQuery } from '@librechat/client';
import type { ContextType } from '~/common';
import {
  useSearchEnabled,
  useAssistantsMap,
  useAuthContext,
  useAgentsMap,
  useFileMap,
} from '~/hooks';
import {
  PromptGroupsProvider,
  AssistantsMapContext,
  AgentsMapContext,
  SetConvoProvider,
  FileMapContext,
} from '~/Providers';
import { useUserTermsQuery, useInitQuery } from '~/data-provider';
import { Nav, MobileNav } from '~/components/Nav';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { CookieConsentBanner, TermsGate } from '~/components/ui';
import { useHealthCheck } from '~/data-provider';
import { Banner } from '~/components/Banners';
import { AuthModal } from '~/components/Auth';
import { authModalTabAtom, showAuthModalAtom } from '~/store/authModal';

export default function Root() {
  const [bannerHeight, setBannerHeight] = useState(0);
  const [showAuthModal, setShowAuthModal] = useRecoilState(showAuthModalAtom);
  const [authModalTab, setAuthModalTab] = useRecoilState(authModalTabAtom);
  const [navVisible, setNavVisible] = useState(() => {
    const savedNavVisible = localStorage.getItem('navVisible');
    return savedNavVisible !== null ? JSON.parse(savedNavVisible) : true;
  });

  const { isAuthenticated, logout, user } = useAuthContext();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  useInitQuery({ enabled: isAuthenticated });
  useHealthCheck(isAuthenticated);

  const assistantsMap = useAssistantsMap({ isAuthenticated });
  const agentsMap = useAgentsMap({ isAuthenticated });
  const fileMap = useFileMap({ isAuthenticated });

  const { data: termsData } = useUserTermsQuery({ enabled: isAuthenticated });

  useSearchEnabled(isAuthenticated);

  if (!isAuthenticated) {
    return null;
  }

  // Block access until terms are explicitly accepted
  if (isAuthenticated && termsData != null && !termsData.termsAccepted) {
    return <TermsGate onDecline={() => logout('/login?redirect=false')} />;
  }

  return (
    <SetConvoProvider>
      <FileMapContext.Provider value={fileMap}>
        <AssistantsMapContext.Provider value={assistantsMap}>
          <AgentsMapContext.Provider value={agentsMap}>
            <PromptGroupsProvider>
              <Banner onHeightChange={setBannerHeight} />
              <div className="flex" style={{ height: `calc(100dvh - ${bannerHeight}px)` }}>
                <div className="relative z-0 flex h-full w-full overflow-hidden">
                  <Nav navVisible={navVisible} setNavVisible={setNavVisible} />
                  <div className="relative flex h-full min-w-0 max-w-full flex-1 flex-col overflow-hidden">
                    <MobileNav navVisible={navVisible} setNavVisible={setNavVisible} />
                    {!isSmallScreen && !navVisible && (
                      <OpenSidebar
                        setNavVisible={setNavVisible}
                        className="absolute left-2 top-2 z-20"
                      />
                    )}
                    <Outlet context={{ navVisible, setNavVisible } satisfies ContextType} />
                  </div>
                </div>
              </div>
              <AuthModal
                open={showAuthModal}
                onOpenChange={(open) => {
                  setShowAuthModal(open);
                  if (!open) {
                    setAuthModalTab('login');
                  }
                }}
                defaultTab={authModalTab}
              />
            </PromptGroupsProvider>
          </AgentsMapContext.Provider>
          <CookieConsentBanner />
        </AssistantsMapContext.Provider>
      </FileMapContext.Provider>
    </SetConvoProvider>
  );
}
