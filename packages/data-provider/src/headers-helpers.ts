import axios from 'axios';

// Ensure cookies (httpOnly Backboard credentials, CSRF token, refresh token)
// are sent on cross-origin requests (e.g. frontend :3090 → API :3080).
axios.defaults.withCredentials = true;

export function setAcceptLanguageHeader(value: string): void {
  axios.defaults.headers.common['Accept-Language'] = value;
}

export function setTokenHeader(token: string) {
  axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
}

export function setBackboardHeaders(_apiKey?: string, _assistantId?: string) {
  // No-op: Backboard credentials are now sent via httpOnly cookies automatically.
}

export function persistBackboardCredentials(_apiKey?: string, _assistantId?: string) {
  // Clear localStorage credentials on new login — cookies handle it now.
  try {
    localStorage.removeItem('bb_api_key');
    localStorage.removeItem('bb_assistant_id');
  } catch {
    /* localStorage unavailable */
  }
}

// ---------------------------------------------------------------------------
// BYOK Session Key management
// ---------------------------------------------------------------------------

const SESSION_KEY_STORAGE = 'nash_session_key';
const REMEMBER_STORAGE = 'nash_remember_session';

/**
 * "Remember me" decides which storage backs the session key. localStorage
 * survives closing the tab; sessionStorage does not. The choice is recorded
 * separately so later token writes (OAuth callback, email verification) honour
 * the preference the user set on the login form.
 */
export function setRememberSession(remember: boolean) {
  try {
    if (remember) {
      localStorage.setItem(REMEMBER_STORAGE, '1');
    } else {
      localStorage.removeItem(REMEMBER_STORAGE);
    }
  } catch {
    /* localStorage unavailable */
  }
}

export function shouldRememberSession(): boolean {
  try {
    return localStorage.getItem(REMEMBER_STORAGE) === '1';
  } catch {
    return false;
  }
}

export function setSessionKeyHeader(sessionKey: string, persist?: boolean) {
  const remember = persist ?? shouldRememberSession();
  if (sessionKey) {
    axios.defaults.headers.common['X-Session-Key'] = sessionKey;
    try {
      // Write to one storage only, so a later read can't resurrect a stale key
      // from the other one.
      const [write, clear] = remember
        ? [localStorage, sessionStorage]
        : [sessionStorage, localStorage];
      write.setItem(SESSION_KEY_STORAGE, sessionKey);
      clear.removeItem(SESSION_KEY_STORAGE);
    } catch {
      /* storage unavailable */
    }
  } else {
    delete axios.defaults.headers.common['X-Session-Key'];
    try {
      sessionStorage.removeItem(SESSION_KEY_STORAGE);
      localStorage.removeItem(SESSION_KEY_STORAGE);
    } catch {
      /* storage unavailable */
    }
  }
}

export function getSessionKey(): string | null {
  try {
    return (
      localStorage.getItem(SESSION_KEY_STORAGE) ?? sessionStorage.getItem(SESSION_KEY_STORAGE)
    );
  } catch {
    return null;
  }
}

export function restoreSessionKeyHeader(): boolean {
  const sk = getSessionKey();
  if (sk) {
    axios.defaults.headers.common['X-Session-Key'] = sk;
    return true;
  }
  return false;
}

export function clearSessionKey() {
  delete axios.defaults.headers.common['X-Session-Key'];
  try {
    sessionStorage.removeItem(SESSION_KEY_STORAGE);
    localStorage.removeItem(SESSION_KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
}
