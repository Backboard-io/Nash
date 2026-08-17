import { useEffect, useState } from 'react';
import { RecoilRoot } from 'recoil';
import { DndProvider } from 'react-dnd';
import { RouterProvider } from 'react-router-dom';
import * as RadixToast from '@radix-ui/react-toast';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toast, ThemeProvider, ToastProvider } from '@librechat/client';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { ScreenshotProvider, useApiErrorBoundary } from './hooks';
import { isAbortedError } from './utils/errors';
import WakeLockManager from '~/components/System/WakeLockManager';
import { getThemeFromEnv } from './utils/getThemeFromEnv';
import { initializeFontSize } from '~/store/fontSize';
import { LiveAnnouncer } from '~/a11y';
import { router } from './routes';

const App = () => {
  const { setError } = useApiErrorBoundary();

  // One QueryClient for the component's lifetime. Constructing it inline
  // would hand QueryClientProvider a NEW client on every App re-render
  // (e.g. the 401 error-boundary state change), silently discarding the
  // entire query cache and refetching every mounted query at once. The
  // useState initializer runs once; `setError` is a useState setter from
  // the provider, so its identity is stable and the closure stays valid.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Always attempt network requests, even when navigator.onLine is false
            // This is needed because localhost is reachable without WiFi
            networkMode: 'always',
          },
          mutations: {
            networkMode: 'always',
          },
        },
        queryCache: new QueryCache({
          onError: (error) => {
            if (isAbortedError(error)) {
              return;
            }
            if (error?.response?.status === 401) {
              setError(error);
            }
          },
        }),
      }),
  );

  useEffect(() => {
    initializeFontSize();
  }, []);

  // Load theme from environment variables if available
  const envTheme = getThemeFromEnv();

  return (
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <LiveAnnouncer>
          <ThemeProvider
            // Only pass initialTheme and themeRGB if environment theme exists
            // This allows localStorage values to persist when no env theme is set
            {...(envTheme && { initialTheme: 'system', themeRGB: envTheme })}
          >
            {/* The ThemeProvider will automatically:
                1. Apply dark/light mode classes
                2. Apply custom theme colors if envTheme is provided
                3. Otherwise use stored theme preferences from localStorage
                4. Fall back to default theme colors if nothing is stored */}
            <RadixToast.Provider>
              <ToastProvider>
                <DndProvider backend={HTML5Backend}>
                <RouterProvider router={router} future={{ v7_startTransition: true }} />
                <WakeLockManager />
                  <ReactQueryDevtools initialIsOpen={false} position="bottom-left" />
                  <Toast />
                  {/* Bottom-right, 24px in, one stack (DESIGN.md §4) — it used
                      to sit top-centre over the conversation. */}
                  <RadixToast.Viewport className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000] flex flex-col items-end justify-end gap-[10px] p-6" />
                </DndProvider>
              </ToastProvider>
            </RadixToast.Provider>
          </ThemeProvider>
        </LiveAnnouncer>
      </RecoilRoot>
    </QueryClientProvider>
  );
};

export default () => (
  <ScreenshotProvider>
    <App />
  </ScreenshotProvider>
);
