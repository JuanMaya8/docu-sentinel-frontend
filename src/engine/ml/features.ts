import type { ColumnProfile, DatasetProfile, FeatureKind, FeatureSpec } from '../types';

export const MAX_FEATURES = 64;
const MISSING_MAX_RATE = 0.2;

/** Everything the feature extractor needs from a shard (satisfied by ShardEngine's cache). */
export interface FeatureSource {
  rowCount: number;
  raw: string[][];
  numeric: Array<Float64Array | null>;
  dates: Array<Float64Array | null>;
  nullMask: Array<Uint8Array | null>;
}

export function stripFeatureSuffix(name: string): string {
  if (name.endsWith('__missing')) return name.slice(0, -'__missing'.length);
  if (name.endsWith('__rarity')) return name.slice(0, -'__rarity'.length);
  return name;
}

export function featureKindFromName(name: string): FeatureKind {
  if (name.endsWith('__missing')) return 'missing';
  if (name.endsWith('__rarity')) return 'rarity';
  return 'numeric';
}

/** Features used when training on the same file ("local" mode). Deterministic given the profile. */
export function buildFeatureSpec(profile: DatasetProfile): FeatureSpec[] {
  const values: FeatureSpec[] = [];
  const rarity: FeatureSpec[] = [];
  const missing: FeatureSpec[] = [];
  for (const c of profile.columns) {
    if (c.role.identifier && !c.role.amount) continue;
    if ((c.type === 'integer' || c.type === 'decimal') && c.numeric && c.numeric.scale > 0 && c.numeric.n >= 30) {
      values.push({ name: c.name, kind: 'numeric', columnIndex: c.index });
    } else if (c.type === 'date' && c.dateMin !== null && c.dateMax !== null && c.dateMax > c.dateMin) {
      values.push({ name: c.name, kind: 'date', columnIndex: c.index });
    } else if (c.categorical && c.categories && c.distinct >= 2) {
      rarity.push({ name: `${c.name}__rarity`, kind: 'rarity', columnIndex: c.index });
    }
    if (c.nulls > 0 && c.nullRate <= MISSING_MAX_RATE) {
      missing.push({ name: `${c.name}__missing`, kind: 'missing', columnIndex: c.index });
    }
  }
  return [...values, ...rarity, ...missing].slice(0, MAX_FEATURES);
}

export interface BaselineSpecResult {
  spec: FeatureSpec[] | null;
  missingFields: string[];
}

/** Maps a saved baseline (columns+kinds) onto the columns of the NEW file. */
export function specFromBaseline(baseline: { columns: string[]; kinds: FeatureKind[] }, profile: DatasetProfile): BaselineSpecResult {
  const byName = new Map<string, ColumnProfile>();
  for (const c of profile.columns) byName.set(c.name, c);
  const spec: FeatureSpec[] = [];
  const missingFields: string[] = [];
  baseline.columns.forEach((name, i) => {
    const field = stripFeatureSuffix(name);
    const col = byName.get(field);
    if (!col) {
      missingFields.push(field);
      return;
    }
    spec.push({ name, kind: baseline.kinds[i], columnIndex: col.index });
  });
  return { spec: missingFields.length === 0 ? spec : null, missingFields };
}

/** Stable short hash of the feature list, to compare schemas cheaply (see docs/CONTRACT.md). */
export function schemaSignature(columns: string[]): string {
  let h = 0x811c9dc5;
  const s = columns.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** rarity = -ln(freq) lookup tables, one per feature (null when the feature is not a rarity). */
export function rarityTables(profile: DatasetProfile, spec: FeatureSpec[]): Array<Map<string, number> | null> {
  return spec.map((f) => {
    if (f.kind !== 'rarity') return null;
    const col = profile.columns[f.columnIndex];
    if (!col.categories) return new Map<string, number>();
    const total = col.categories.reduce((a, [, n]) => a + n, 0);
    const m = new Map<string, number>();
    for (const [value, n] of col.categories) m.set(value, -Math.log(n / total));
    return m;
  });
}

export function extractFeatureRow(
  src: FeatureSource,
  spec: FeatureSpec[],
  rarity: Array<Map<string, number> | null>,
  row: number,
  out: Float64Array,
  outOffset: number,
): void {
  for (let k = 0; k < spec.length; k++) {
    const f = spec[k];
    let v = NaN;
    switch (f.kind) {
      case 'numeric': {
        const arr = src.numeric[f.columnIndex];
        if (arr) v = arr[row];
        break;
      }
      case 'date': {
        const arr = src.dates[f.columnIndex];
        if (arr) v = arr[row];
        break;
      }
      case 'missing': {
        const mask = src.nullMask[f.columnIndex];
        v = mask ? mask[row] : NaN;
        break;
      }
      case 'rarity': {
        const mask = src.nullMask[f.columnIndex];
        if (mask && mask[row] === 0) {
          const r = rarity[k]?.get(src.raw[f.columnIndex][row]);
          if (r !== undefined) v = r;
        }
        break;
      }
    }
    out[outOffset + k] = v;
  }
}
