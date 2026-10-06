import { fmtNum } from '@/engine';

export function fmtInt(n: number): string {
  return fmtNum(Math.round(n), 0);
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${fmtNum(v, v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${fmtNum(ms / 1000, ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

export function downloadText(fileName: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const RISK_ORDER = ['critical', 'high', 'medium', 'low'] as const;
