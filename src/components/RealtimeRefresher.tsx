'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { socketOrigin } from '@/lib/api';
import { SESSION_EVENT, getStoredToken } from '@/lib/session';

const EVENTS = ['analysis.saved', 'analysis.deleted', 'baseline.trained', 'baseline.deleted'];

/** Listens to the backend's socket.io namespace /realtime and re-runs the server component when something changes. */
export function RealtimeRefresher() {
  const router = useRouter();
  const [live, setLive] = useState(false);

  useEffect(() => {
    const socket = io(`${socketOrigin()}/realtime`, { transports: ['websocket', 'polling'], reconnectionDelayMax: 10_000 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    for (const e of EVENTS) socket.on(e, refresh);
    return () => {
      clearTimeout(timer);
      socket.close();
    };
  }, [router]);

  return (
    <span className="chip" title="Conexión en tiempo real con el backend" aria-live="polite">
      <span className="dot" style={{ color: live ? 'var(--low)' : 'var(--muted)' }} aria-hidden="true" />
      {live ? 'En vivo' : 'Sin conexión en vivo'}
    </span>
  );
}
