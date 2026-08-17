import { applyFontSize } from '@librechat/client';
import { createStorageAtomWithEffect, initializeFromStorage } from './jotai-utils';

const STORAGE_KEY = 'fontSize';

/**
 * 'text-sm' (0.875rem / 14px), not 'text-base'.
 *
 * The chat redesign hard-coded message text at 14px, which silently disabled
 * this setting entirely. Unpinning it (see `.markdown.prose.message-content` in
 * style.css) without also moving the default down one notch would have resized
 * every existing user's chat from 14px to 16px on deploy.
 */
const DEFAULT_FONT_SIZE = 'text-sm';

/**
 * One-shot repair of a default that was force-written, not chosen.
 *
 * `client/src/hooks/ThemeContext.tsx` used to do an unconditional
 * `localStorage.setItem('fontSize', '"text-base"')` on first load. It was
 * mounted in App.jsx from #3568 (Aug 2024) until #8685 (Jul 2025) moved shared
 * components into `@librechat/client` and dropped it, so every profile that
 * loaded Nash in that window has "text-base" persisted without the user ever
 * opening Settings. Lowering DEFAULT_FONT_SIZE alone does not reach them — they
 * have a stored value — so they would be exactly the users who jump to 16px.
 *
 * Rewriting their stored value once is safe because until now picking "Medium"
 * had no effect on message text at all (it was pinned at 14px), so nobody can
 * have deliberately chosen and observed 16px messages. It did affect a few
 * message-adjacent surfaces (thinking text, tool-progress, the edit view), so
 * this is not literally lossless for someone who set Medium after Jul 2025 —
 * it is simply much closer to intent than resizing everyone's chat.
 *
 * Runs at module scope, before `createStorageAtomWithEffect` below reads
 * storage via `getOnInit`. Deferring it to `initializeFontSize` (a useEffect)
 * would let the atom latch the stale value first, leaving the Settings dropdown
 * reading "Medium" while the DOM rendered Small.
 */
const LEGACY_DEFAULT_MIGRATION_KEY = 'fontSizeDefaultRebased';

function migrateForceWrittenDefault(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    if (localStorage.getItem(LEGACY_DEFAULT_MIGRATION_KEY) != null) {
      return;
    }
    /* Set the flag first: a later failure must not leave this retrying forever. */
    localStorage.setItem(LEGACY_DEFAULT_MIGRATION_KEY, '1');
    if (localStorage.getItem(STORAGE_KEY) === JSON.stringify('text-base')) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_FONT_SIZE));
    }
  } catch {
    /* Private mode or quota — fall through and let the default apply. */
  }
}

migrateForceWrittenDefault();

/**
 * This atom stores the user's font size preference
 */
export const fontSizeAtom = createStorageAtomWithEffect<string>(
  STORAGE_KEY,
  DEFAULT_FONT_SIZE,
  applyFontSize,
);

/**
 * Initialize font size on app load
 * This function applies the saved font size from localStorage to the DOM
 */
export const initializeFontSize = (): void => {
  initializeFromStorage(STORAGE_KEY, DEFAULT_FONT_SIZE, applyFontSize);
};
