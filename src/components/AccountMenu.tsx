'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { SESSION_EVENT, clearSession, getStoredUser, type SessionUser } from '@/lib/session';

/** Header account area. Hidden when the backend has no accounts (or is unreachable). */
export function AccountMenu() {
  const router = useRouter();
  const [authEnabled, setAuthEnabled] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let alive = true;
    api.health().then(
      (h) => alive && setAuthEnabled(Boolean(h.auth)),
      () => alive && setAuthEnabled(false),
    );
    const sync = (): void => setUser(getStoredUser());
    sync();
    window.addEventListener(SESSION_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      alive = false;
      window.removeEventListener(SESSION_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (!authEnabled) return null;
  if (!user) {
    return (
      <Link className="btn sm" href="/ingresar">
        Ingresar
      </Link>
    );
  }
  return (
    <div className="account">
      <span className="small muted account-name" title={user.email}>{user.name || user.email}</span>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          clearSession();
          router.push('/');
          router.refresh();
        }}
      >
        Salir
      </button>
    </div>
  );
}
