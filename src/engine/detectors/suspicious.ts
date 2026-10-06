import type { DetectContext } from './context';
import { es } from '../i18n/es';

/** Row-level suspicious patterns: values bunched just below a round approval threshold. */
export function detectSuspicious(ctx: DetectContext, skipRows: Uint8Array): void {
  const { view, profile, emit } = ctx;
  for (const col of profile.columns) {
    if (col.thresholds.length === 0) continue;
    const num = view.numeric[col.index]!;
    const nm = view.nullMask[col.index]!;
    for (let i = 0; i < view.rowCount; i++) {
      const v = num[i];
      if (nm[i] || skipRows[i] || Number.isNaN(v) || v <= 0) continue;
      for (const t of col.thresholds) {
        if (v < t.value && v > t.value * 0.97) {
          emit({
            row: i,
            type: 'suspicious_threshold',
            score: 55,
            field: col.name,
            value: String(v),
            explanation: es.thresholdBunching(col.name, v, t.value, t.below),
            detector: 'suspicious',
          });
          break;
        }
      }
    }
  }
}
