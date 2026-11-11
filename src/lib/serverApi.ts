import { cookies } from 'next/headers';
import { createApi } from './api';
import { TOKEN_COOKIE } from './session';

/** API client for server components: forwards the session cookie as a Bearer token to the backend. */
export function serverApi(): ReturnType<typeof createApi> {
  const raw = cookies().get(TOKEN_COOKIE)?.value;
  const token = raw ? decodeURIComponent(raw) : undefined;
  return createApi(() => token);
}
