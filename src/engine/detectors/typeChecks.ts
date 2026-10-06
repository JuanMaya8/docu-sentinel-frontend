import type { DetectContext } from './context';
import { DATE_FORMAT_CODES } from './context';
import { es } from '../i18n/es';
import { normalizeLabel } from '../util/text';

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BOOL_WORDS = new Set(['true', 'false', 'si', 'sí', 'no', 'yes', 'verdadero', 'falso']);
const DATE_FORMAT_NAMES: Record<string, string> = {
  iso: 'AAAA-MM-DD',
  ymd_slash: 'AAAA/MM/DD',
  dmy_slash: 'DD/MM/AAAA',
  dmy_dash: 'DD-MM-AAAA',
  dmy_dot: 'DD.MM.AAAA',
  mdy: 'MM/DD/AAAA',
};

export function detectTypes(ctx: DetectContext, skipRows: Uint8Array): void {
  const { view, profile, emit } = ctx;
  for (const col of profile.columns) {
    const raw = view.raw[col.index];
    const nm = view.nullMask[col.index]!;
    const n = view.rowCount;
    if (col.rows - col.nulls < 20) continue;
    switch (col.type) {
      case 'integer':
      case 'decimal': {
        const num = view.numeric[col.index]!;
        const text = (v: string) => es.typeMismatchNumeric(col.name, v, col.typeShare);
        for (let i = 0; i < n; i++) {
          if (nm[i] || skipRows[i] || !Number.isNaN(num[i])) continue;
          emit({ row: i, type: 'type_mismatch', score: 70, field: col.name, value: raw[i], explanation: text(raw[i]), detector: 'types' });
        }
        break;
      }
      case 'date': {
        const days = view.dates[col.index]!;
        const fmt = view.dateFormat[col.index]!;
        const imp = view.dateImpossible[col.index]!;
        const dominant = col.dateFormat ? DATE_FORMAT_CODES.indexOf(col.dateFormat) + 1 : 0;
        const dominantName = col.dateFormat ? DATE_FORMAT_NAMES[col.dateFormat] : '';
        for (let i = 0; i < n; i++) {
          if (nm[i] || skipRows[i]) continue;
          if (imp[i]) {
            emit({ row: i, type: 'impossible_date', score: 75, field: col.name, value: raw[i], explanation: es.impossibleDate(col.name, raw[i]), detector: 'types' });
          } else if (Number.isNaN(days[i])) {
            emit({ row: i, type: 'type_mismatch', score: 65, field: col.name, value: raw[i], explanation: es.typeMismatchDate(col.name, raw[i], col.typeShare), detector: 'types' });
          } else if (dominant > 0 && fmt[i] !== dominant) {
            emit({ row: i, type: 'invalid_format', score: 25, field: col.name, value: raw[i], explanation: es.dateFormat(col.name, raw[i], dominantName), detector: 'types' });
          }
        }
        break;
      }
      case 'email': {
        for (let i = 0; i < n; i++) {
          if (nm[i] || skipRows[i]) continue;
          if (!RE_EMAIL.test(raw[i].trim())) {
            emit({ row: i, type: 'invalid_format', score: 65, field: col.name, value: raw[i], explanation: es.invalidEmail(col.name, raw[i]), detector: 'types' });
          }
        }
        break;
      }
      case 'boolean': {
        for (let i = 0; i < n; i++) {
          if (nm[i] || skipRows[i]) continue;
          if (!BOOL_WORDS.has(raw[i].trim().toLowerCase())) {
            emit({ row: i, type: 'type_mismatch', score: 55, field: col.name, value: raw[i], explanation: es.typeMismatchGeneric(col.name, raw[i], 'un valor sí/no'), detector: 'types' });
          }
        }
        break;
      }
      case 'string': {
        detectStringIssues(ctx, col.index, skipRows);
        break;
      }
      default:
        break; // 'mixed' is reported once at column level
    }
  }
}

function detectStringIssues(ctx: DetectContext, c: number, skipRows: Uint8Array): void {
  const { view, profile, emit } = ctx;
  const col = profile.columns[c];
  const raw = view.raw[c];
  const nm = view.nullMask[c]!;
  const nonNull = col.rows - col.nulls;
  const padded = nonNull > 0 ? col.whitespacePaddedShare : 0;
  const flagPadding = padded > 0 && padded <= 0.05;
  // label variants only for categorical columns
  let canon: Map<string, string> | null = null;
  if (col.categorical && col.categories) {
    const groups = new Map<string, Array<[string, number]>>();
    for (const [value, count] of col.categories) {
      const key = normalizeLabel(value);
      if (key.length === 0) continue;
      const g = groups.get(key);
      if (g) g.push([value, count]);
      else groups.set(key, [[value, count]]);
    }
    canon = new Map();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const total = group.reduce((a, [, n]) => a + n, 0);
      if (total < 5) continue;
      group.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      const best = group[0][0].trim();
      for (let k = 1; k < group.length; k++) canon.set(group[k][0], best);
    }
    if (canon.size === 0) canon = null;
  }
  if (!flagPadding && !canon) return;
  for (let i = 0; i < raw.length; i++) {
    if (nm[i] || skipRows[i]) continue;
    const v = raw[i];
    if (flagPadding && v.length > 0 && (v.charCodeAt(0) <= 32 || v.charCodeAt(v.length - 1) <= 32) && v.trim() !== v) {
      emit({ row: i, type: 'whitespace', score: 20, field: col.name, value: v, explanation: es.whitespace(col.name, v), detector: 'types' });
      continue;
    }
    const target = canon?.get(v);
    if (target !== undefined) {
      emit({ row: i, type: 'inconsistent_label', score: 35, field: col.name, value: v, explanation: es.inconsistentLabel(col.name, v, target), detector: 'types' });
    }
  }
}
