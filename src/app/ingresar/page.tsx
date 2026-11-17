import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';

export const metadata: Metadata = { title: 'Ingresar' };

export default function LoginPage() {
  return (
    <div className="auth-page">
      <Suspense fallback={<div className="skeleton" style={{ height: 420 }} role="status" aria-label="Cargando" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
