import axios from 'axios';

import {
  setSessionKeyHeader,
  restoreSessionKeyHeader,
  getSessionKey,
  clearSessionKey,
  setRememberSession,
  shouldRememberSession,
} from './headers-helpers';

/**
 * These tests exercise the Safari sign-in persistence fix at its core: the
 * `X-Session-Key` request header handoff. The header is what lets an
 * authenticated request succeed independent of cookie policy, which is exactly
 * the property Safari's Intelligent Tracking Prevention (ITP) breaks when the
 * frontend and API live on different origins and the `session_key` cookie is
 * treated as cross-site.
 *
 * jsdom/node can't model ITP itself, so each test names the browser condition
 * it stands in for and asserts the header behaves correctly under it.
 */

const HEADER = 'X-Session-Key';
const STORAGE_KEY = 'nash_session_key';

class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

describe('session-key header handoff (Safari cross-site cookie workaround)', () => {
  beforeEach(() => {
    (global as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();
    (global as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    delete axios.defaults.headers.common[HEADER];
  });

  it('installs the X-Session-Key header and persists the token for later requests', () => {
    setSessionKeyHeader('sk_live_123');

    expect(axios.defaults.headers.common[HEADER]).toBe('sk_live_123');
    expect(getSessionKey()).toBe('sk_live_123');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('sk_live_123');
  });

  it('Safari: authenticates via the header even when no cookie is available', () => {
    // Safari blocked the cross-site session_key cookie, so document.cookie is empty.
    (global as unknown as { document: { cookie: string } }).document = { cookie: '' };

    setSessionKeyHeader('sk_safari');

    // The request credential does not depend on cookies at all — the header carries it.
    expect((global as unknown as { document: { cookie: string } }).document.cookie).toBe('');
    expect(axios.defaults.headers.common[HEADER]).toBe('sk_safari');
  });

  it('rehydrates the header from storage after a page refresh', () => {
    setSessionKeyHeader('sk_refresh');

    // A refresh recreates axios defaults (header gone) but sessionStorage survives.
    delete axios.defaults.headers.common[HEADER];

    expect(restoreSessionKeyHeader()).toBe(true);
    expect(axios.defaults.headers.common[HEADER]).toBe('sk_refresh');
  });

  it('does nothing for a first-time visitor with empty storage', () => {
    expect(restoreSessionKeyHeader()).toBe(false);
    expect(axios.defaults.headers.common[HEADER]).toBeUndefined();
  });

  it('clears the header and stored token on logout', () => {
    setSessionKeyHeader('sk_bye');
    clearSessionKey();

    expect(axios.defaults.headers.common[HEADER]).toBeUndefined();
    expect(getSessionKey()).toBeNull();
  });

  it('removes the header when set with an empty token', () => {
    setSessionKeyHeader('sk_x');
    setSessionKeyHeader('');

    expect(axios.defaults.headers.common[HEADER]).toBeUndefined();
    expect(getSessionKey()).toBeNull();
  });

  it('clears the header and stored token from both storages on logout', () => {
    setSessionKeyHeader('sk_remembered', true);
    clearSessionKey();

    expect(axios.defaults.headers.common[HEADER]).toBeUndefined();
    expect(getSessionKey()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('degrades gracefully when storage is unavailable (Safari private mode / lockdown)', () => {
    (global as unknown as { sessionStorage: unknown }).sessionStorage = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
      removeItem: () => {
        throw new Error('storage disabled');
      },
    };

    // Persistence fails, but the header must still be set for the current session
    // and nothing may throw.
    expect(() => setSessionKeyHeader('sk_private')).not.toThrow();
    expect(axios.defaults.headers.common[HEADER]).toBe('sk_private');

    expect(() => restoreSessionKeyHeader()).not.toThrow();
    expect(restoreSessionKeyHeader()).toBe(false);
  });
});

/**
 * "Remember me" on the login form chooses which storage backs the session key.
 * Unchecked, the key must not outlive the tab.
 */
describe('remember me session persistence', () => {
  beforeEach(() => {
    (global as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();
    (global as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    delete axios.defaults.headers.common[HEADER];
  });

  it('defaults to not remembering', () => {
    expect(shouldRememberSession()).toBe(false);
  });

  it('records and clears the preference', () => {
    setRememberSession(true);
    expect(shouldRememberSession()).toBe(true);

    setRememberSession(false);
    expect(shouldRememberSession()).toBe(false);
  });

  it('keeps the key out of localStorage when remember me is unchecked', () => {
    setRememberSession(false);
    setSessionKeyHeader('sk_tab_only');

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('sk_tab_only');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('persists the key to localStorage when remember me is checked', () => {
    setRememberSession(true);
    setSessionKeyHeader('sk_remembered');

    expect(localStorage.getItem(STORAGE_KEY)).toBe('sk_remembered');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('survives closing the tab when remembered', () => {
    setRememberSession(true);
    setSessionKeyHeader('sk_survives');

    // A new tab gets fresh axios defaults and empty sessionStorage.
    delete axios.defaults.headers.common[HEADER];
    (global as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();

    expect(restoreSessionKeyHeader()).toBe(true);
    expect(axios.defaults.headers.common[HEADER]).toBe('sk_survives');
  });

  it('does not survive closing the tab when not remembered', () => {
    setRememberSession(false);
    setSessionKeyHeader('sk_gone');

    delete axios.defaults.headers.common[HEADER];
    (global as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();

    expect(restoreSessionKeyHeader()).toBe(false);
  });

  it('does not leave a stale key behind when the preference flips', () => {
    setRememberSession(true);
    setSessionKeyHeader('sk_old');

    // Signing out and back in with the box unchecked must not leave the old
    // remembered key readable from localStorage.
    setRememberSession(false);
    setSessionKeyHeader('sk_new');

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getSessionKey()).toBe('sk_new');
  });

  it('honours the stored preference for tokens issued later (OAuth callback)', () => {
    setRememberSession(true);

    // The OAuth callback sets the key without knowing about the checkbox.
    setSessionKeyHeader('sk_oauth');

    expect(localStorage.getItem(STORAGE_KEY)).toBe('sk_oauth');
  });
});
