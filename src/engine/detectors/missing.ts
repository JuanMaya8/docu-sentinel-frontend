import type { DetectContext } from './context';
import { es } from '../i18n/es';

/** Rows that have at least half of their fields empty are reported once (empty_record), not per field. */
export function emptyRowMask(ctx: DetectContext): Uint8Array {
  const { view, profile } = ctx;
  const W = profile.columns.length;
  const mask = new Uint8Array(view.rowCount);
  if (W < 4) return mask;
  const counts = new Uint16Array(view.rowCount);
  for (let c = 0; c < W; c++) {
    const nm = view.nullMask[c];
    if (!nm) continue;
    for (let i = 0; i < view.rowCount; i++) counts[i] += nm[i];
  }
  for (let i = 0; i < view.rowCount; i++) if (counts[i] * 2 >= W) mask[i] = 1;
  return mask;
}

export function detectMissing(ctx: DetectContext, empty: Uint8Array): void {
  const { view, profile, emit } = ctx;
  const W = profile.columns.length;
  for (let i = 0; i < view.rowCount; i++) {
    if (empty[i]) {
      let n = 0;
      for (let c = 0; c < W; c++) n += view.nullMask[c]![i];
      emit({ row: i, type: 'empty_record', score: 70, field: null, explanation: es.emptyRecord(n, W), detector: 'missing' });
    }
  }
  for (const col of profile.columns) {
    if (col.nulls === 0 || !col.required || col.rows < 20) continue;
    const nm = view.nullMask[col.index]!;
    const score = col.index === profile.keyColumn ? 80 : col.role.amount || col.role.quantity || col.role.price ? 65 : 45;
    const text = es.missingField(col.name, col.nullRate);
    for (let i = 0; i < view.rowCount; i++) {
      if (nm[i] && !empty[i]) emit({ row: i, type: 'missing_field', score, field: col.name, value: '', explanation: text, detector: 'missing' });
    }
  }
}
