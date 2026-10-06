import type {
  AnalysisOptions,
  ColumnProfile,
  ColumnType,
  NumericProfile,
  PartialColumn,
  PartialProfile,
  StatsPartial,
  ValueType,
} from '../types';
import { QuantileSketch } from '../sketch/ddsketch';
import { KmvSketch } from '../sketch/kmv';
import { emptyVotes } from './accumulator';
import { detectRole } from './roles';
import type { DateFormat } from '../util/dates';

const TYPE_SHARE = 0.85;
const CATEGORICAL_MAX_DISTINCT = 200;

// ------------------------------------------------------------------ stage 1 (PARSE)

export function mergePartials(partials: PartialProfile[]): PartialProfile {
  if (partials.length === 0) return { rows: 0, columns: [] };
  const width = partials[0].columns.length;
  const columns: PartialColumn[] = [];
  for (let c = 0; c < width; c++) {
    const votes = emptyVotes();
    const dateVotes = new Map<string, number>();
    const cats = new Map<string, number>();
    const kmv = new KmvSketch(1024);
    let count = 0;
    let nulls = 0;
    let dot = 0;
    let comma = 0;
    let impossible = 0;
    let padded = 0;
    let overflow = false;
    for (const p of partials) {
      const col = p.columns[c];
      count += col.count;
      nulls += col.nulls;
      dot += col.styleVotes.dot;
      comma += col.styleVotes.comma;
      impossible += col.impossibleDates;
      padded += col.whitespacePadded;
      for (const k of Object.keys(votes) as ValueType[]) votes[k] += col.votes[k];
      for (const [f, n] of Object.entries(col.dateFormatVotes)) dateVotes.set(f, (dateVotes.get(f) ?? 0) + (n as number));
      kmv.merge(KmvSketch.from(col.kmv));
      if (col.categoriesOverflow) overflow = true;
      else if (!overflow) for (const [v, n] of col.categories) cats.set(v, (cats.get(v) ?? 0) + n);
    }
    columns.push({
      count,
      nulls,
      votes,
      styleVotes: { dot, comma },
      dateFormatVotes: Object.fromEntries(dateVotes),
      impossibleDates: impossible,
      whitespacePadded: padded,
      kmv: kmv.serialize(),
      categories: overflow ? [] : sortCategories(cats),
      categoriesOverflow: overflow,
    });
  }
  return { rows: partials.reduce((a, p) => a + p.rows, 0), columns };
}

function sortCategories(m: Map<string, number>): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function dominantDateFormat(votes: Partial<Record<DateFormat, number>>): DateFormat | null {
  let best: DateFormat | null = null;
  let bestN = 0;
  for (const key of Object.keys(votes).sort() as DateFormat[]) {
    const n = votes[key] ?? 0;
    if (n > bestN) {
      best = key;
      bestN = n;
    }
  }
  return best;
}

export function buildColumnProfiles(
  names: string[],
  merged: PartialProfile,
  opts: Pick<AnalysisOptions, 'requiredMaxNullRate'>,
): ColumnProfile[] {
  return names.map((name, index) => {
    const col = merged.columns[index];
    const nonNull = col.count - col.nulls;
    const share = (t: ValueType): number => (nonNull > 0 ? col.votes[t] / nonNull : 0);
    const numericShare = share('integer') + share('decimal');
    let type: ColumnType;
    let typeShare: number;
    if (nonNull === 0) {
      type = 'string';
      typeShare = 0;
    } else if (numericShare >= TYPE_SHARE) {
      type = col.votes.decimal > 0 && col.votes.integer / (col.votes.integer + col.votes.decimal) < 0.995 ? 'decimal' : 'integer';
      typeShare = numericShare;
    } else if (share('date') >= TYPE_SHARE) {
      type = 'date';
      typeShare = share('date');
    } else if (share('boolean') >= TYPE_SHARE) {
      type = 'boolean';
      typeShare = share('boolean');
    } else if (share('email') >= TYPE_SHARE) {
      type = 'email';
      typeShare = share('email');
    } else if (share('string') >= TYPE_SHARE) {
      type = 'string';
      typeShare = share('string');
    } else {
      type = 'mixed';
      typeShare = Math.max(numericShare, share('date'), share('boolean'), share('email'), share('string'));
    }
    const kmv = KmvSketch.from(col.kmv);
    const distinct = kmv.estimate();
    const nullRate = col.count > 0 ? col.nulls / col.count : 0;
    const categorical =
      !col.categoriesOverflow &&
      distinct <= CATEGORICAL_MAX_DISTINCT &&
      col.count >= 50 &&
      (type === 'string' || type === 'boolean') &&
      distinct >= 1;
    const typeShares: Partial<Record<ValueType, number>> = {};
    if (nonNull > 0) {
      for (const t of ['integer', 'decimal', 'date', 'boolean', 'email', 'string'] as ValueType[]) {
        if (col.votes[t] > 0) typeShares[t] = col.votes[t] / nonNull;
      }
    }
    return {
      index,
      name,
      type,
      typeShare,
      rows: col.count,
      nulls: col.nulls,
      nullRate,
      distinct,
      distinctExact: kmv.exact,
      numberStyle: col.styleVotes.comma > col.styleVotes.dot ? 'comma' : 'dot',
      dateFormat: type === 'date' ? dominantDateFormat(col.dateFormatVotes) : null,
      role: detectRole(name),
      required: col.nulls === 0 ? true : nullRate <= opts.requiredMaxNullRate,
      whitespacePaddedShare: nonNull > 0 ? col.whitespacePadded / nonNull : 0,
      categorical,
      categories: categorical ? col.categories : null,
      typeShares,
      numeric: null,
      leadingDigits: null,
      multiplesOf1000: 0,
      thresholds: [],
      dateMin: null,
      dateMax: null,
    };
  });
}

// ------------------------------------------------------------------ stage 2 (STATS)

export function applyStats(profiles: ColumnProfile[], parts: StatsPartial[]): void {
  for (const col of profiles) {
    const sketch = new QuantileSketch();
    const digits = new Array<number>(9).fill(0);
    let nonZero = 0;
    let m1000 = 0;
    let negatives = 0;
    let zeros = 0;
    let dateMin = Infinity;
    let dateMax = -Infinity;
    const thresholds = new Map<string, [number, number, number]>();
    for (const p of parts) {
      const s = p.columns[col.index];
      if (!s) continue;
      if (s.sketch) sketch.merge(QuantileSketch.from(s.sketch));
      for (let i = 0; i < 9; i++) digits[i] += s.leadingDigits[i];
      nonZero += s.nonZero;
      m1000 += s.multiplesOf1000;
      negatives += s.negatives;
      zeros += s.zeros;
      if (s.dateMin < dateMin) dateMin = s.dateMin;
      if (s.dateMax > dateMax) dateMax = s.dateMax;
      for (const [k, prev, below, above] of s.thresholdCounts) {
        const cur = thresholds.get(k) ?? [0, 0, 0];
        cur[0] += prev;
        cur[1] += below;
        cur[2] += above;
        thresholds.set(k, cur);
      }
    }
    if (col.type === 'date') {
      col.dateMin = Number.isFinite(dateMin) ? dateMin : null;
      col.dateMax = Number.isFinite(dateMax) ? dateMax : null;
    }
    if ((col.type === 'integer' || col.type === 'decimal') && sketch.count > 0) {
      col.numeric = buildNumeric(sketch, negatives, zeros);
      col.leadingDigits = digits;
      col.multiplesOf1000 = m1000;
      if ((col.role.amount || col.role.price) && !col.role.identifier && sketch.count >= 300) {
        const flagged: Array<{ value: number; below: number }> = [];
        for (const [key, [prev, below, above]] of [...thresholds.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          if (below >= 10 && below >= 2 * Math.max(above, prev, 1) && below / sketch.count >= 0.002) {
            flagged.push({ value: Number(key), below });
          }
        }
        col.thresholds = flagged;
      }
    }
  }
}

function buildNumeric(s: QuantileSketch, negatives: number, zeros: number): NumericProfile {
  const q1 = s.quantile(0.25);
  const median = s.quantile(0.5);
  const q3 = s.quantile(0.75);
  const p01 = s.quantile(0.01);
  const p99 = s.quantile(0.99);
  const iqr = q3 - q1;
  let scale = iqr / 1.349;
  if (!(scale > 1e-12)) scale = (p99 - p01) / 4.65;
  if (!(scale > 1e-12)) scale = 0;
  return { n: s.count, min: s.min, max: s.max, q1, median, q3, p01, p99, iqr, scale, negatives, zeros };
}

// ------------------------------------------------------------------ key column

export function pickKeyColumn(profiles: ColumnProfile[], override?: string[]): number | null {
  if (override && override.length > 0) {
    const found = profiles.find((p) => override.includes(p.name));
    return found ? found.index : null;
  }
  const candidates = profiles.filter((p) => p.role.keyCandidate && p.rows >= 2 && p.distinct / Math.max(1, p.rows - p.nulls) >= 0.9);
  if (candidates.length === 0) return null;
  const rank = (p: ColumnProfile): number => {
    const n = p.name.toLowerCase();
    if (/(invoice|factura|order|orden|pedido|folio)/.test(n)) return 0;
    if (/(^id$|_id$|^id_|uuid|guid)/.test(n)) return 1;
    return 2;
  };
  candidates.sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  return candidates[0].index;
}
