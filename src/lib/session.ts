/**
 * Browser session (only used when the backend has accounts enabled, i.e. JWT_SECRET is set there).
 *  - the token lives in localStorage (sent as `Authorization: Bearer` by src/lib/api.ts)
 *  - and in a first-party cookie `ds_token`, so server components (SSR /reportes) can forward it to the backend
 * Both are cleared on logout or when the backend answers 401 to a request that carried the token.
 */
export const TOKEN_KEY = 'ds-token';
export const USER_KEY = 'ds-user';
export const TOKEN_COOKIE = 'ds_token';
export const SESSION_EVENT = 'ds-session';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

const inBrowser = (): boolean => typeof window !== 'undefined';

export function getStoredToken(): string | undefined {
  if (!inBrowser()) return undefined;
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function getStoredUser(): SessionUser | null {
  if (!inBrowser()) return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

function notify(): void {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function setSession(session: { token: string; expiresAt: string; user: SessionUser }): void {
  if (!inBrowser()) return;
  try {
    localStorage.setItem(TOKEN_KEY, session.token);
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  } catch {
    /* storage blocked: the cookie still carries the session for this tab */
  }
  const maxAge = Math.max(60, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(session.token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  notify();
}

export function clearSession(): void {
  if (!inBrowser()) return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  notify();
}
