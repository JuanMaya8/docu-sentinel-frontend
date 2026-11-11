'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { setSession } from '@/lib/session';

type Tab = 'login' | 'register';

/** Only same-site paths are accepted as the post-login destination (no open redirects). */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/analizar';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    api.health().then((h) => setEnabled(Boolean(h.auth)), () => setEnabled(null));
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = tab === 'login' ? await api.login({ email, password }) : await api.register({ email, password, ...(name.trim() ? { name: name.trim() } : {}) });
      setSession(session);
      router.push(safeNext(params.get('next')));
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (enabled === false) {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>Este servidor no usa cuentas de usuario: el historial y las líneas base están disponibles sin iniciar sesión.</p>
      </div>
    );
  }

  return (
    <form className="card stack auth-card" onSubmit={(e) => void submit(e)} aria-labelledby="auth-title">
      <div className="tabs" role="tablist" aria-label="Tipo de acceso">
        <button type="button" role="tab" aria-selected={tab === 'login'} className={`tab${tab === 'login' ? ' active' : ''}`} onClick={() => setTab('login')}>
          Ingresar
        </button>
        <button type="button" role="tab" aria-selected={tab === 'register'} className={`tab${tab === 'register' ? ' active' : ''}`} onClick={() => setTab('register')}>
          Crear cuenta
        </button>
      </div>
      <h2 id="auth-title" style={{ margin: 0 }}>{tab === 'login' ? 'Ingresa a tu cuenta' : 'Crea tu cuenta'}</h2>
      {tab === 'register' && (
        <div className="field">
          <label htmlFor="auth-name">Nombre (opcional)</label>
          <input id="auth-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
      )}
      <div className="field">
        <label htmlFor="auth-email">Correo</label>
        <input id="auth-email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="auth-password">Contraseña</label>
        <input
          id="auth-password"
          className="input"
          type="password"
          required
          minLength={tab === 'register' ? 8 : 1}
          autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tab === 'register' && <span className="small muted">Mínimo 8 caracteres.</span>}
      </div>
      {error && <p className="alert error small" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Un momento…' : tab === 'login' ? 'Ingresar' : 'Crear cuenta'}
      </button>
      <p className="small muted" style={{ margin: 0 }}>
        Tus archivos se siguen analizando en el navegador; la cuenta solo separa tu historial y tus líneas base de las de otras personas.
      </p>
    </form>
  );
}
