import type { ProcessingMode } from '@/engine';

/** User-facing names of the processing modes (no technical jargon: the user picks a speed, not a threading model). */
export const MODE_LABEL: Record<ProcessingMode, string> = {
  main: 'Básico',
  worker: 'En segundo plano',
  pool: 'Rápido',
};

export function modeLabel(mode: string): string {
  return (MODE_LABEL as Record<string, string>)[mode] ?? mode;
}
