import type { ColumnProfile, RelationCheck, RelationSpec } from '../types';
import { nameTokens } from '../util/text';
import { DATE_GENERIC_TOKENS, DATE_ROLE_TOKENS, groupKey, hasAny } from './roles';

const TAX = new Set(['tax', 'iva', 'impuesto', 'impuestos', 'vat']);
const DISCOUNT = new Set(['discount', 'descuento', 'desc']);
const SHIPPING = new Set(['shipping', 'envio', 'flete', 'freight']);
const SUBTOTAL = new Set(['subtotal', 'sub']);
const TOTAL = new Set(['total', 'amount', 'monto', 'importe']);
const PAID = new Set(['paid', 'pagado', 'abono', 'payment']);
const MIN = new Set(['min', 'minimum', 'minimo', 'mínimo']);
const MAX = new Set(['max', 'maximum', 'maximo', 'máximo']);

const isNumericCol = (c: ColumnProfile): boolean => c.type === 'integer' || c.type === 'decimal';

function pick(cols: ColumnProfile[], pred: (tokens: string[], c: ColumnProfile) => boolean): ColumnProfile | undefined {
  return cols.find((c) => pred(nameTokens(c.name), c));
}

/** Candidate relations inferred from column NAMES. They are verified against the data before being used. */
export function relationCandidates(cols: ColumnProfile[]): RelationSpec[] {
  const out: RelationSpec[] = [];
  const numeric = cols.filter((c) => isNumericCol(c) && !c.role.identifier);
  const dates = cols.filter((c) => c.type === 'date');

  // ---- date order: issue -> due, start -> end
  const pairs: Array<[NonNullable<ColumnProfile['role']['dateRole']>, NonNullable<ColumnProfile['role']['dateRole']>]> = [
    ['issue', 'due'],
    ['created', 'due'],
    ['start', 'end'],
  ];
  for (const [a, b] of pairs) {
    const firsts = dates.filter((d) => d.role.dateRole === a);
    const seconds = dates.filter((d) => d.role.dateRole === b);
    for (const f of firsts) {
      const gf = groupKey(f.name, DATE_ROLE_TOKENS[a]);
      const match = seconds.find((s) => groupKey(s.name, DATE_ROLE_TOKENS[b]) === gf) ?? (seconds.length === 1 && firsts.length === 1 ? seconds[0] : undefined);
      if (match) out.push({ id: `date:${f.index}<=${match.index}`, kind: 'date_order', earlier: f.index, later: match.index });
    }
  }
  // generic: any two date columns named like *_date where one has "from/to" etc. are covered above.

  // ---- product: quantity * unit price = subtotal | total
  const qty = pick(numeric, (t, c) => c.role.quantity && !t.includes('stock') && !t.includes('existencias'));
  const price = pick(numeric, (t, c) => c.role.price && !hasAny(t, TOTAL) && !hasAny(t, SUBTOTAL));
  const subtotal = pick(numeric, (t) => hasAny(t, SUBTOTAL));
  const total = pick(numeric, (t) => hasAny(t, TOTAL) && !hasAny(t, SUBTOTAL) && !t.includes('unit') && !t.includes('unitario'));
  if (qty && price) {
    if (subtotal) out.push({ id: `product:${qty.index}*${price.index}=${subtotal.index}`, kind: 'product', a: qty.index, b: price.index, result: subtotal.index });
    if (total) out.push({ id: `product:${qty.index}*${price.index}=${total.index}`, kind: 'product', a: qty.index, b: price.index, result: total.index });
  }

  // ---- sum: subtotal (+tax) (-discount) (+shipping) = total
  if (subtotal && total) {
    const tax = pick(numeric, (t) => hasAny(t, TAX));
    const disc = pick(numeric, (t) => hasAny(t, DISCOUNT));
    const ship = pick(numeric, (t) => hasAny(t, SHIPPING));
    const extras: Array<{ col: ColumnProfile; sign: 1 | -1 }> = [];
    if (tax) extras.push({ col: tax, sign: 1 });
    if (disc) extras.push({ col: disc, sign: -1 });
    if (ship) extras.push({ col: ship, sign: 1 });
    for (let mask = 0; mask < 1 << extras.length; mask++) {
      const parts: Array<{ col: number; sign: 1 | -1 }> = [{ col: subtotal.index, sign: 1 }];
      for (let i = 0; i < extras.length; i++) if (mask & (1 << i)) parts.push({ col: extras[i].col.index, sign: extras[i].sign });
      out.push({
        id: `sum:${parts.map((p) => (p.sign > 0 ? '+' : '-') + p.col).join('')}=${total.index}`,
        kind: 'sum',
        parts,
        result: total.index,
      });
    }
  }

  // ---- lte
  const disc = pick(numeric, (t) => hasAny(t, DISCOUNT));
  const base = subtotal ?? total ?? price;
  if (disc && base && disc.index !== base.index) out.push({ id: `lte:${disc.index}<=${base.index}`, kind: 'lte', small: disc.index, big: base.index });
  const paid = pick(numeric, (t) => hasAny(t, PAID));
  if (paid && total && paid.index !== total.index) out.push({ id: `lte:${paid.index}<=${total.index}`, kind: 'lte', small: paid.index, big: total.index });
  for (const mn of numeric.filter((c) => hasAny(nameTokens(c.name), MIN))) {
    const g = nameTokens(mn.name).filter((t) => !MIN.has(t)).join('_');
    const mx = numeric.find((c) => hasAny(nameTokens(c.name), MAX) && nameTokens(c.name).filter((t) => !MAX.has(t)).join('_') === g);
    if (mx) out.push({ id: `lte:${mn.index}<=${mx.index}`, kind: 'lte', small: mn.index, big: mx.index });
  }
  void DATE_GENERIC_TOKENS;
  return out;
}

/** Keeps candidates that hold in >= 80% of the checked rows. For product/sum only the best per result column survives. */
export function acceptRelations(candidates: RelationSpec[], checks: RelationCheck[], minChecked = 20, minShare = 0.8): RelationSpec[] {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const scored = candidates
    .map((spec) => {
      const c = byId.get(spec.id);
      return { spec, share: c && c.checked >= minChecked ? c.ok / c.checked : 0 };
    })
    .filter((x) => x.share >= minShare);
  const accepted: RelationSpec[] = [];
  const groups = new Map<string, typeof scored>();
  for (const s of scored) {
    const key = s.spec.kind === 'product' || s.spec.kind === 'sum' ? `${s.spec.kind}:${s.spec.result}` : s.spec.id;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.share - a.share || partsCount(a.spec) - partsCount(b.spec) || (a.spec.id < b.spec.id ? -1 : 1));
    accepted.push(group[0].spec);
  }
  return accepted.sort((a, b) => (a.id < b.id ? -1 : 1));
}

function partsCount(spec: RelationSpec): number {
  return spec.kind === 'sum' ? spec.parts.length : 0;
}

/** Relative tolerance used by arithmetic relations (1%, at least 0.01 absolute). */
export function withinTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, 0.01 * Math.max(Math.abs(a), Math.abs(b)));
}
