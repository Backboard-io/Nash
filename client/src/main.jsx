import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import './locales/i18n';

if (process.env.NODE_ENV === 'development') {
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('Cannot update a component') && args[0].includes('RouterProvider')) {
      return;
    }
    originalError(...args);
  };
}

// Dev: unregister any stale service worker (from a prior prod build on this
// origin) that keeps serving cached old UI until a hard refresh. SW is disabled
// in dev, so a leftover registration is the only thing that can intercept here.
// Localhost (including a locally-served production build) never benefits from
// the PWA cache and gets stuck one build behind, so unregister there too.
const isLocalHost =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

if ((process.env.NODE_ENV === 'development' || isLocalHost) && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
  }
}
import App from './App';
import './style.css';
import './mobile.css';
import { ApiErrorBoundaryProvider } from './hooks/ApiErrorBoundaryContext';
import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/copy-tex.js';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <ApiErrorBoundaryProvider>
    <App />
  </ApiErrorBoundaryProvider>,
);
