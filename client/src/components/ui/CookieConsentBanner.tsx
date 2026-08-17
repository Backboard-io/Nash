import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const STORAGE_KEY = 'nash_cookie_consent';

type Choice = 'accept_all' | 'essential_only';

function readLocal(): { accepted: boolean } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(accepted: boolean) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accepted, at: new Date().toISOString() }),
    );
  } catch {
    // localStorage may be unavailable (e.g. Safari private mode); not fatal
  }
}

export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const local = readLocal();
    if (local) {
      return;
    }
    // Small delay so the banner doesn't flash during initial page load
    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const record = (choice: Choice) => {
    writeLocal(choice === 'accept_all');
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl animate-in slide-in-from-bottom-4 duration-300 rounded-2xl border border-border-light bg-surface-secondary p-4 shadow-lg sm:left-6 sm:right-auto sm:max-w-sm"
    >
      <button
        onClick={() => record('essential_only')}
        aria-label="Dismiss cookie notice"
        className="absolute right-3 top-3 rounded-lg p-1 text-text-secondary hover:bg-surface-active hover:text-text-primary transition-colors"
      >
        <X size={14} />
      </button>

      <p className="pr-6 text-sm text-text-secondary leading-relaxed">
        We use essential cookies to keep you logged in. We may also use analytics cookies to
        improve the experience.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => record('accept_all')}
          className="flex-1 rounded-xl bg-brand-purple px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-purple-hover transition-colors"
        >
          Accept all
        </button>
        <button
          onClick={() => record('essential_only')}
          className="flex-1 rounded-xl border border-border-medium px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-active transition-colors"
        >
          Essential only
        </button>
      </div>
    </div>
  );
}
