import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import { NavLinks } from '@/components/NavLinks';
import { THEME_BOOT_SCRIPT, ThemeToggle } from '@/components/ThemeToggle';

export const metadata: Metadata = {
  title: { default: 'Docu Sentinel — Motor de inconsistencias en documentos', template: '%s · Docu Sentinel' },
  description: 'Detecta duplicados, campos faltantes, valores fuera de rango y registros sospechosos en CSV, JSON y PDF sin subir tus archivos: el análisis corre en tu navegador con Web Workers.',
};
export const viewport: Viewport = { themeColor: '#0f5c5c', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand" aria-label="Docu Sentinel, inicio">
              <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
                <path d="M13 2 22 5.5v7.2c0 5.2-3.7 9.2-9 11.3-5.3-2.1-9-6.1-9-11.3V5.5L13 2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M8.5 13.2h3l1.6-4 2.2 7.2 1.2-3.2h1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Docu Sentinel
            </Link>
            <NavLinks />
          </div>
        </header>
        <main>
          <div className="wrap">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="wrap">Tus archivos se analizan en este navegador y no se suben a ningún servidor. Solo se guarda el reporte si tú lo decides.</div>
        </footer>
      </body>
    </html>
  );
}
