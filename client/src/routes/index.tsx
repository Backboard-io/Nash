import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { Login } from '~/components/Auth';
import { MarketplaceProvider } from '~/components/Agents/MarketplaceContext';
import AgentMarketplace from '~/components/Agents/Marketplace';
import BookmarksView from '~/components/SidePanel/Bookmarks/BookmarksView';
import MemoriesView from '~/components/SidePanel/Memories/MemoriesView';
import MCPView from '~/components/SidePanel/MCPBuilder/MCPView';
import LibraryView from '~/components/Library/LibraryView';
import { OAuthSuccess, OAuthError } from '~/components/OAuth';
import { AuthContextProvider } from '~/hooks/AuthContext';
import { PreviewAuthProvider } from '~/hooks/PreviewAuthProvider';
import RouteErrorBoundary from './RouteErrorBoundary';
import LoginLayout from './Layouts/Login';
import dashboardRoutes from './Dashboard';
import ShareRoute from './ShareRoute';
import ChatRoute from './ChatRoute';
import Search from './Search';
import Root from './Root';
import Privacy from './Privacy';
import Terms from './Terms';
import Docs from './Docs';
import Preview from './Preview';

const AuthLayout = () => (
  <AuthContextProvider>
    <Outlet />
  </AuthContextProvider>
);

const baseEl = document.querySelector('base');
const baseHref = baseEl?.getAttribute('href') || '/';

export const router = createBrowserRouter(
  [
    {
      path: 'preview',
      element: (
        <PreviewAuthProvider>
          <Preview />
        </PreviewAuthProvider>
      ),
      errorElement: <RouteErrorBoundary />,
    },
    {
      path: 'docs',
      element: <Docs />,
      errorElement: <RouteErrorBoundary />,
    },
    {
      path: 'privacy',
      element: <Privacy />,
      errorElement: <RouteErrorBoundary />,
    },
    {
      path: 'terms',
      element: <Terms />,
      errorElement: <RouteErrorBoundary />,
    },
    {
      path: 'oauth',
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          path: 'success',
          element: <OAuthSuccess />,
        },
        {
          path: 'error',
          element: <OAuthError />,
        },
      ],
    },
    {
      element: <AuthLayout />,
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          path: '/',
          element: <LoginLayout />,
          children: [
            {
              path: 'login',
              element: <Login />,
            },
          ],
        },
        dashboardRoutes,
        {
          // Auth-gated, full-screen standalone (sibling of <Root>, not nested):
          // AuthContextProvider redirects logged-out visitors to
          // /login?redirect_to=/share/<id> and back after login.
          path: 'share/:shareId',
          element: <ShareRoute />,
        },
        {
          path: '/',
          element: <Root />,
          children: [
            {
              // No marketing landing page: '/' sends authenticated users
              // straight to a new chat. Root renders this only when authed;
              // unauthenticated users are redirected to /login by
              // AuthContextProvider's 401 handler (see AuthContext userQuery).
              index: true,
              element: <Navigate to="/c/new" replace />,
            },
            {
              path: 'c/:conversationId?',
              element: <ChatRoute />,
            },
            {
              path: 'search',
              element: <Search />,
            },
            {
              path: 'mcp',
              element: (
                <MarketplaceProvider>
                  <MCPView />
                </MarketplaceProvider>
              ),
            },
            {
              path: 'agents',
              element: (
                <MarketplaceProvider>
                  <AgentMarketplace />
                </MarketplaceProvider>
              ),
            },
            {
              path: 'agents/:category',
              element: (
                <MarketplaceProvider>
                  <AgentMarketplace />
                </MarketplaceProvider>
              ),
            },
            {
              path: 'library/:section?',
              element: (
                <MarketplaceProvider>
                  <LibraryView />
                </MarketplaceProvider>
              ),
            },
            {
              path: 'bookmarks',
              element: (
                <MarketplaceProvider>
                  <BookmarksView />
                </MarketplaceProvider>
              ),
            },
            {
              path: 'memories',
              element: (
                <MarketplaceProvider>
                  <MemoriesView />
                </MarketplaceProvider>
              ),
            },
            {
              /* The Files page was folded into Library — keep the old URL working. */
              path: 'files',
              element: <Navigate to="/library" replace />,
            },
          ],
        },
      ],
    },
  ],
  { basename: baseHref, future: { v7_startTransition: true } },
);
