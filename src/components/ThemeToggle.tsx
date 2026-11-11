'use client';

import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export const THEME_KEY = 'ds-theme';

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Theme, string> = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: oscuro' };

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/**
 * Inline script for <head>: applies the saved theme BEFORE the first paint (no flash of the wrong theme).
 * Kept tiny and dependency-free; it must not throw when storage is blocked.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

/** Cycles automatic → light → dark. "Automatic" follows the operating system (prefers-color-scheme). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => setTheme(readTheme()), []);

  const cycle = (): void => {
    const next = NEXT[theme];
    setTheme(next);
    applyTheme(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the theme still applies for this page view */
    }
  };

  return (
    <button type="button" className="theme-toggle" onClick={cycle} aria-label={`${LABEL[theme]}. Cambiar tema`} title={LABEL[theme]}>
      {theme === 'light' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
