'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS: Array<{ href: string; label: string; short?: string }> = [
  { href: '/analizar', label: 'Analizar' },
  { href: '/benchmark', label: 'Comparar velocidad', short: 'Velocidad' },
  { href: '/reportes', label: 'Reportes' },
];

export function NavLinks() {
  const path = usePathname() ?? '';
  return (
    <nav className="nav" aria-label="Principal">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path.startsWith(l.href) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
