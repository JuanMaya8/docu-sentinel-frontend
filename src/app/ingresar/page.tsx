import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';

export const metadata: Metadata = { title: 'Ingresar' };

export default function LoginPage() {
  return (
    <div className="stack" style={{ maxWidth: 440, margin: '0 auto' }}>
      <header>
        <p className="eyebrow">Cuenta</p>
        <h1 style={{ fontSize: '2rem', margin: 0 }}>Ingresar</h1>
      </header>
      <Suspense fallback={<div className="skeleton" style={{ height: 320 }} />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
