'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { setSession } from '@/lib/session';
import { Icon } from './Icon';

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
      <div className="card auth-card">
        <span className="icon-tile auth-mark"><Icon name="info" size={22} /></span>
        <h1 className="auth-title">Sin cuentas en este servidor</h1>
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>Este servidor no usa cuentas de usuario: el historial y las líneas base están disponibles sin iniciar sesión.</p>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={(e) => void submit(e)} aria-labelledby="auth-title">
        <span className="icon-tile auth-mark"><Icon name="shield" size={22} /></span>
        <p className="eyebrow auth-eyebrow">Docu Sentinel <span className="muted">/ Cuenta</span></p>
        <h1 id="auth-title" className="auth-title">{tab === 'login' ? 'Ingresa a tu cuenta' : 'Crea tu cuenta'}</h1>
        <p className="small muted auth-intro">
          Tus archivos se siguen analizando en el navegador; la cuenta solo separa tu historial y tus líneas base de las de otras personas.
        </p>
        <div className="tabs" role="tablist" aria-label="Tipo de acceso">
          <button type="button" role="tab" aria-selected={tab === 'login'} className={`tab${tab === 'login' ? ' active' : ''}`} onClick={() => setTab('login')}>
            <Icon name="logIn" size={16} /> Ingresar
          </button>
          <button type="button" role="tab" aria-selected={tab === 'register'} className={`tab${tab === 'register' ? ' active' : ''}`} onClick={() => setTab('register')}>
            <Icon name="userPlus" size={16} /> Crear cuenta
          </button>
        </div>
        {tab === 'register' && (
          <div className="field">
            <label htmlFor="auth-name">Nombre (opcional)</label>
            <div className="input-icon">
              <Icon name="user" size={16} />
              <input id="auth-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="auth-email">Correo</label>
          <div className="input-icon">
            <Icon name="mail" size={16} />
            <input id="auth-email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="auth-password">Contraseña</label>
          <div className="input-icon">
            <Icon name="key" size={16} />
            <input
              id="auth-password"
              className="input"
              type="password"
              required
              minLength={tab === 'register' ? 8 : 1}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={tab === 'register' ? 'auth-password-hint' : undefined}
            />
          </div>
          {tab === 'register' && <span id="auth-password-hint" className="small muted">Mínimo 8 caracteres.</span>}
        </div>
        {error && <p className="alert error small" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn primary lg block" type="submit" disabled={busy}>
          {busy ? 'Un momento…' : tab === 'login' ? 'Ingresar' : 'Crear cuenta'} {!busy && <Icon name="arrowRight" size={16} />}
        </button>
      </form>
      <p className="small muted auth-switch">
        {tab === 'login' ? '¿Aún no tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
        <button type="button" className="link-btn" onClick={() => setTab(tab === 'login' ? 'register' : 'login')}>
          {tab === 'login' ? 'Crea una aquí' : 'Ingresa aquí'}
        </button>
      </p>
    </div>
  );
}
