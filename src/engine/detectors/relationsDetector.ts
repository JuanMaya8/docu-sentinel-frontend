import type { RelationSpec } from '../types';
import type { DetectContext } from './context';
import { es, fmtNum } from '../i18n/es';
import { epochDaysToIso } from '../util/dates';
import { withinTolerance } from '../profile/relations';

export function detectRelations(ctx: DetectContext, skipRows: Uint8Array): void {
  const { view, profile, emit } = ctx;
  const name = (c: number): string => profile.columns[c].name;
  const n = view.rowCount;
  const valueArr = (c: number): Float64Array => (profile.columns[c].type === 'date' ? view.dates[c]! : view.numeric[c]!)!;
  for (const spec of profile.relations) {
    switch (spec.kind) {
      case 'date_order': {
        const a = valueArr(spec.earlier);
        const b = valueArr(spec.later);
        for (let i = 0; i < n; i++) {
          if (skipRows[i] || Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
          if (b[i] < a[i]) {
            const gap = a[i] - b[i];
            emit({
              row: i,
              type: 'impossible_relation',
              score: gap > 30 ? 90 : 80,
              field: name(spec.later),
              value: epochDaysToIso(b[i]),
              explanation: es.relationDateOrder(name(spec.later), epochDaysToIso(b[i]), name(spec.earlier), epochDaysToIso(a[i])),
              detector: 'relations',
            });
          }
        }
        break;
      }
      case 'product': {
        const a = valueArr(spec.a);
        const b = valueArr(spec.b);
        const r = valueArr(spec.result);
        for (let i = 0; i < n; i++) {
          if (skipRows[i] || Number.isNaN(a[i]) || Number.isNaN(b[i]) || Number.isNaN(r[i])) continue;
          const expected = a[i] * b[i];
          if (!withinTolerance(expected, r[i])) {
            emit({
              row: i,
              type: 'impossible_relation',
              score: severity(expected, r[i]),
              field: name(spec.result),
              value: fmtNum(r[i]),
              explanation: es.relationProduct(name(spec.result), r[i], name(spec.a), name(spec.b), expected),
              detector: 'relations',
            });
          }
        }
        break;
      }
      case 'sum': {
        const parts = spec.parts.map((p) => ({ arr: valueArr(p.col), sign: p.sign }));
        const r = valueArr(spec.result);
        const formula = spec.parts.map((p, k) => (k === 0 ? '' : p.sign > 0 ? ' + ' : ' − ') + `«${name(p.col)}»`).join('');
        for (let i = 0; i < n; i++) {
          if (skipRows[i] || Number.isNaN(r[i])) continue;
          let sum = 0;
          let ok = true;
          for (const p of parts) {
            const v = p.arr[i];
            if (Number.isNaN(v)) {
              ok = false;
              break;
            }
            sum += p.sign * v;
          }
          if (!ok) continue;
          if (!withinTolerance(sum, r[i])) {
            emit({
              row: i,
              type: 'impossible_relation',
              score: severity(sum, r[i]),
              field: name(spec.result),
              value: fmtNum(r[i]),
              explanation: es.relationSum(name(spec.result), r[i], formula, sum),
              detector: 'relations',
            });
          }
        }
        break;
      }
      case 'lte': {
        const s = valueArr(spec.small);
        const b = valueArr(spec.big);
        for (let i = 0; i < n; i++) {
          if (skipRows[i] || Number.isNaN(s[i]) || Number.isNaN(b[i])) continue;
          if (s[i] > b[i] && !withinTolerance(s[i], b[i])) {
            emit({
              row: i,
              type: 'impossible_relation',
              score: severity(b[i], s[i]),
              field: name(spec.small),
              value: fmtNum(s[i]),
              explanation: es.relationLte(name(spec.small), s[i], name(spec.big), b[i]),
              detector: 'relations',
            });
          }
        }
        break;
      }
    }
  }
}

function severity(expected: number, actual: number): number {
  const denom = Math.max(Math.abs(expected), Math.abs(actual), 1);
  return Math.abs(expected - actual) / denom > 0.5 ? 90 : 80;
}

export type { RelationSpec };
