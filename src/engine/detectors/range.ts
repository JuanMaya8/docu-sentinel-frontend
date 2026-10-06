import type { ColumnProfile, Sensitivity } from '../types';
import type { DetectContext } from './context';
import { es } from '../i18n/es';
import { epochDaysToIso } from '../util/dates';
import { fmtNum } from '../i18n/es';

const FENCE_K: Record<Sensitivity, number> = { low: 6, medium: 3, high: 1.5 };

export interface Fences {
  low: number;
  high: number;
  /** spread used to measure distance (IQR, or log-IQR in log mode) */
  spread: number;
  log: boolean;
}

/**
 * IQR fences. For right-skewed positive columns (typical for money) the fences are computed on the
 * log scale: quantiles are invariant under monotone transforms, so log(q) is exact and the false-positive
 * rate stays tiny for log-normal data (a plain IQR fence would flag ~3% of a log-normal column).
 */
export function computeFences(col: ColumnProfile, k: number): Fences | null {
  const n = col.numeric;
  if (!n || n.n < 30 || n.scale <= 0) return null;
  const skewed = n.min > 0 && n.q1 > 0 && n.q3 - n.median > 1.5 * (n.median - n.q1);
  if (skewed) {
    const l1 = Math.log(n.q1);
    const l3 = Math.log(n.q3);
    const spread = l3 - l1;
    if (spread > 1e-9) return { low: Math.exp(l1 - k * spread), high: Math.exp(l3 + k * spread), spread, log: true };
  }
  const spread = n.iqr > 0 ? n.iqr : n.scale * 1.349;
  if (!(spread > 0)) return null;
  return { low: n.q1 - k * spread, high: n.q3 + k * spread, spread, log: false };
}

export function detectRange(ctx: DetectContext, skipRows: Uint8Array): void {
  const { view, profile, options, emit } = ctx;
  const k = FENCE_K[options.sensitivity];
  const now = (options.now ?? Date.now()) / 86_400_000;
  for (const col of profile.columns) {
    const nm = view.nullMask[col.index]!;
    const n = view.rowCount;
    if (col.type === 'integer' || col.type === 'decimal') {
      const num = view.numeric[col.index]!;
      const stats = col.numeric;
      if (!stats) continue;
      const businessCol = col.role.amount || col.role.quantity || col.role.price;
      const flagNegative = businessCol && stats.negatives > 0 && stats.negatives / stats.n <= 0.05;
      const flagZeroPrice = col.role.price && stats.zeros > 0 && stats.zeros / stats.n <= 0.05;
      const fences = col.role.identifier || col.distinct <= 10 ? null : computeFences(col, k);
      for (let i = 0; i < n; i++) {
        const v = num[i];
        if (nm[i] || skipRows[i] || Number.isNaN(v)) continue;
        if (col.role.age && (v < 0 || v > 120)) {
          emit({ row: i, type: 'out_of_range', score: 90, field: col.name, value: String(v), explanation: es.impossibleAge(col.name, v), detector: 'range' });
          continue;
        }
        if (flagNegative && v < 0) {
          emit({ row: i, type: 'negative_value', score: 70, field: col.name, value: String(v), explanation: es.negative(col.name, v), detector: 'range' });
          continue;
        }
        if (flagZeroPrice && v === 0) {
          emit({ row: i, type: 'out_of_range', score: 40, field: col.name, value: '0', explanation: es.zeroPrice(col.name), detector: 'range' });
          continue;
        }
        if (fences && (v > fences.high || v < fences.low)) {
          const above = v > fences.high;
          let distance: number;
          if (fences.log) {
            distance = v > 0 ? (above ? Math.log(v) - Math.log(stats.q3) : Math.log(stats.q1) - Math.log(v)) / fences.spread : k + 10;
          } else {
            distance = (above ? v - stats.q3 : stats.q1 - v) / fences.spread;
          }
          const score = Math.max(45, Math.min(95, 45 + 8 * (distance - k)));
          const dev = stats.scale > 0 ? (v - stats.median) / stats.scale : 0;
          emit({
            row: i,
            type: 'out_of_range',
            score,
            field: col.name,
            value: fmtNum(v),
            explanation: es.outOfRange(col.name, v, stats.median, dev, fences.low, fences.high),
            detector: 'range',
          });
        }
      }
    } else if (col.type === 'date' && (col.role.dateRole === 'birth' || col.role.dateRole === 'issue' || col.role.dateRole === 'created')) {
      const days = view.dates[col.index]!;
      const score = col.role.dateRole === 'birth' ? 85 : 70;
      for (let i = 0; i < n; i++) {
        const d = days[i];
        if (nm[i] || skipRows[i] || Number.isNaN(d)) continue;
        if (d > now) {
          emit({ row: i, type: 'future_date', score, field: col.name, value: epochDaysToIso(d), explanation: es.futureDate(col.name, epochDaysToIso(d)), detector: 'range' });
        }
      }
    }
  }
}
