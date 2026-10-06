/**
 * Isolation Forest implemented from scratch (Liu, Ting, Zhou 2008) with:
 *  - robust per-feature scaling (median / IQR) so units do not matter,
 *  - flat typed-array trees (fast scoring of millions of rows inside workers),
 *  - an "extrapolation guard" (same idea as docu-sentinel-ai): rows far OUTSIDE the training
 *    range are not under-scored, which matters when a baseline trained on history scores new data,
 *  - seeded PRNG: same data + same seed => bit-identical model.
 */
import type { FeatureKind } from '../types';
import { mulberry32 } from '../util/prng';
import { coherenceAttribution, coherenceDistance, coherenceScore, fitCoherence, type CoherenceModel } from './coherence';

export interface Tree {
  feature: Int16Array; // -1 for leaves
  split: Float64Array;
  left: Int32Array;
  right: Int32Array;
  size: Int32Array; // leaf sample size
}

export interface ForestModel {
  version: 1;
  columns: string[];
  kinds: FeatureKind[];
  nFeatures: number;
  sampleSize: number;
  trees: Tree[];
  /** per feature: scaled in log space (positive, right-skewed values such as money) */
  log: boolean[];
  median: number[];
  scale: number[];
  zMin: number[];
  zMax: number[];
  indicatorRate: number[];
  /** joint-distribution model that catches broken relations between fields (null when fewer than 3 features) */
  coherence: CoherenceModel | null;
  threshold: number;
  floor: number;
  contamination: number;
  trainedRows: number;
  seed: number;
}

export const MAX_ABS_Z = 50;
export const ABS_THRESHOLD_FLOOR = 0.55;
const UNSEEN_INDICATOR_EXT = 3;
const EXT_SCALE = 4;
const EULER = 0.5772156649;

function avgPathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n;
}

function quantileOf(sorted: Float64Array, n: number, p: number): number {
  const pos = p * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Positive, right-skewed numeric features (money, quantities) are modelled in log space: products become sums. */
export function shouldLog(matrix: Float64Array, nRows: number, nFeatures: number, j: number, kind: FeatureKind): boolean {
  if (kind !== 'numeric') return false;
  const buf = new Float64Array(nRows);
  let n = 0;
  let nonPositive = 0;
  for (let i = 0; i < nRows; i++) {
    const v = matrix[i * nFeatures + j];
    if (Number.isNaN(v)) continue;
    if (v > 0) buf[n++] = v;
    else nonPositive++;
  }
  if (n < 30 || nonPositive / (n + nonPositive) > 0.005) return false;
  const sorted = buf.slice(0, n).sort();
  const q1 = quantileOf(sorted, n, 0.25);
  const med = quantileOf(sorted, n, 0.5);
  const q3 = quantileOf(sorted, n, 0.75);
  if (!(q1 > 0)) return false;
  return q3 - med > 1.5 * (med - q1) || (sorted[n - 1] / med > 20 && q3 > med);
}

export function transformValue(raw: number, isLog: boolean): number {
  if (!isLog) return raw;
  return raw > 0 ? Math.log(raw) : NaN;
}

export function robustStats(matrix: Float64Array, nRows: number, nFeatures: number): { median: number[]; scale: number[] } {
  const median = new Array<number>(nFeatures).fill(0);
  const scale = new Array<number>(nFeatures).fill(1);
  const buf = new Float64Array(nRows);
  for (let j = 0; j < nFeatures; j++) {
    let n = 0;
    for (let i = 0; i < nRows; i++) {
      const v = matrix[i * nFeatures + j];
      if (!Number.isNaN(v)) buf[n++] = v;
    }
    if (n === 0) continue;
    const sorted = buf.slice(0, n).sort();
    const at = (p: number): number => {
      const pos = p * (n - 1);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };
    median[j] = at(0.5);
    let s = (at(0.75) - at(0.25)) / 1.349;
    if (!(s > 1e-12)) {
      let mean = 0;
      for (let i = 0; i < n; i++) mean += sorted[i];
      mean /= n;
      let v = 0;
      for (let i = 0; i < n; i++) v += (sorted[i] - mean) ** 2;
      s = Math.sqrt(v / n);
    }
    scale[j] = s > 1e-12 ? s : 1;
  }
  return { median, scale };
}

function toZ(value: number, median: number, scale: number): number {
  if (Number.isNaN(value)) return 0;
  const z = (value - median) / scale;
  return z > MAX_ABS_Z ? MAX_ABS_Z : z < -MAX_ABS_Z ? -MAX_ABS_Z : z;
}

export interface TrainOptions {
  columns: string[];
  kinds: FeatureKind[];
  nTrees?: number;
  sampleSize?: number;
  contamination: number;
  seed: number;
  /** minimum anomaly score to flag a row (Isolation Forest scores near 0.5 are normal) */
  thresholdFloor?: number;
}

export function trainForest(matrix: Float64Array, nRows: number, opts: TrainOptions): ForestModel {
  const F = opts.columns.length;
  if (nRows < 20) throw new Error('Se necesitan al menos 20 filas para entrenar el modelo');
  const nTrees = opts.nTrees ?? 100;
  const psi = Math.min(opts.sampleSize ?? 256, nRows);
  const log = opts.kinds.map((k, j) => shouldLog(matrix, nRows, F, j, k));
  let stats = matrix;
  if (log.some(Boolean)) {
    stats = new Float64Array(matrix.length);
    for (let i = 0; i < nRows; i++) for (let j = 0; j < F; j++) stats[i * F + j] = transformValue(matrix[i * F + j], log[j]);
  }
  const { median, scale } = robustStats(stats, nRows, F);

  // z-matrix
  const z = new Float64Array(nRows * F);
  const zMin = new Array<number>(F).fill(Infinity);
  const zMax = new Array<number>(F).fill(-Infinity);
  const indicatorRate = new Array<number>(F).fill(0);
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < F; j++) {
      const raw = matrix[i * F + j];
      const v = toZ(transformValue(raw, log[j]), median[j], scale[j]);
      z[i * F + j] = v;
      if (v < zMin[j]) zMin[j] = v;
      if (v > zMax[j]) zMax[j] = v;
      if (opts.kinds[j] === 'missing' && raw > 0.5) indicatorRate[j]++;
    }
  }
  for (let j = 0; j < F; j++) indicatorRate[j] /= nRows;

  const rng = mulberry32(opts.seed);
  const heightLimit = Math.ceil(Math.log2(Math.max(2, psi)));
  const trees: Tree[] = [];
  const idx = new Int32Array(nRows);
  for (let i = 0; i < nRows; i++) idx[i] = i;

  for (let t = 0; t < nTrees; t++) {
    // partial Fisher-Yates: first psi entries are a uniform sample without replacement
    for (let i = 0; i < psi; i++) {
      const j = i + Math.floor(rng() * (nRows - i));
      const tmp = idx[i];
      idx[i] = idx[j];
      idx[j] = tmp;
    }
    const sample = idx.slice(0, psi);
    trees.push(buildTree(z, F, sample, heightLimit, rng));
  }

  const model: ForestModel = {
    version: 1,
    columns: opts.columns,
    kinds: opts.kinds,
    nFeatures: F,
    sampleSize: psi,
    trees,
    log,
    median,
    scale,
    zMin,
    zMax,
    indicatorRate,
    coherence: fitCoherence(z, nRows, F, Math.min(0.1, 2 * opts.contamination + 0.01)),
    threshold: 1,
    floor: opts.thresholdFloor ?? ABS_THRESHOLD_FLOOR,
    contamination: opts.contamination,
    trainedRows: nRows,
    seed: opts.seed,
  };
  const scores = scoreMatrix(model, matrix, nRows, false);
  const sorted = Float64Array.from(scores).sort();
  const pos = Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - opts.contamination) * (sorted.length - 1))));
  model.threshold = Math.max(model.floor, sorted[pos]);
  return model;
}

function buildTree(z: Float64Array, F: number, sample: Int32Array, heightLimit: number, rng: () => number): Tree {
  const feature: number[] = [];
  const split: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const size: number[] = [];

  const build = (rows: Int32Array, depth: number): number => {
    const node = feature.length;
    feature.push(-1);
    split.push(0);
    left.push(-1);
    right.push(-1);
    size.push(rows.length);
    if (rows.length <= 1 || depth >= heightLimit) return node;
    // choose a random non-constant feature (try up to F random picks, then scan)
    let f = -1;
    let lo = 0;
    let hi = 0;
    for (let attempt = 0; attempt < F * 2 && f < 0; attempt++) {
      const cand = Math.floor(rng() * F);
      let mn = Infinity;
      let mx = -Infinity;
      for (let r = 0; r < rows.length; r++) {
        const v = z[rows[r] * F + cand];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mx > mn) {
        f = cand;
        lo = mn;
        hi = mx;
      }
    }
    if (f < 0) return node;
    const s = lo + rng() * (hi - lo);
    let nl = 0;
    for (let r = 0; r < rows.length; r++) if (z[rows[r] * F + f] < s) nl++;
    if (nl === 0 || nl === rows.length) return node;
    const L = new Int32Array(nl);
    const R = new Int32Array(rows.length - nl);
    let a = 0;
    let b = 0;
    for (let r = 0; r < rows.length; r++) {
      if (z[rows[r] * F + f] < s) L[a++] = rows[r];
      else R[b++] = rows[r];
    }
    feature[node] = f;
    split[node] = s;
    left[node] = build(L, depth + 1);
    right[node] = build(R, depth + 1);
    return node;
  };
  build(sample, 0);
  return {
    feature: Int16Array.from(feature),
    split: Float64Array.from(split),
    left: Int32Array.from(left),
    right: Int32Array.from(right),
    size: Int32Array.from(size),
  };
}

function pathLength(tree: Tree, zrow: Float64Array): number {
  let node = 0;
  let depth = 0;
  for (;;) {
    const f = tree.feature[node];
    if (f < 0) return depth + avgPathLength(tree.size[node]);
    node = zrow[f] < tree.split[node] ? tree.left[node] : tree.right[node];
    depth++;
  }
}

/** Scores `nRows` rows of a row-major matrix. Higher = more anomalous, in (0,1). */
export function scoreMatrix(model: ForestModel, matrix: Float64Array, nRows: number, guard = true): Float32Array {
  const F = model.nFeatures;
  const out = new Float32Array(nRows);
  const zrow = new Float64Array(F);
  const c = avgPathLength(model.sampleSize);
  const nTrees = model.trees.length;
  for (let i = 0; i < nRows; i++) {
    let worstExt = 0;
    const base = i * F;
    for (let j = 0; j < F; j++) {
      const raw = matrix[base + j];
      const zv = toZ(transformValue(raw, model.log[j]), model.median[j], model.scale[j]);
      zrow[j] = zv;
      if (guard) {
        let ext = Math.max(model.zMin[j] - zv, zv - model.zMax[j], 0);
        if (model.kinds[j] === 'missing') {
          ext = model.indicatorRate[j] === 0 && raw > 0.5 ? UNSEEN_INDICATOR_EXT : 0;
        }
        if (ext > worstExt) worstExt = ext;
      }
    }
    let total = 0;
    for (let t = 0; t < nTrees; t++) total += pathLength(model.trees[t], zrow);
    let s = Math.pow(2, -(total / nTrees) / c);
    if (guard && worstExt > 0) {
      const g = 0.5 + 0.5 * (1 - Math.exp(-((worstExt / EXT_SCALE) ** 2)));
      if (g > s) s = g;
    }
    if (guard && model.coherence) {
      const g = coherenceScore(model.coherence, coherenceDistance(model.coherence, zrow));
      if (g > s) s = g;
    }
    out[i] = s;
  }
  return out;
}

export interface Contribution {
  featureIndex: number;
  kind: FeatureKind | 'coherence';
  /** signed robust z (strength for missing/rarity, residual in z units for coherence) */
  deviation: number;
  value: number;
  /** only for 'coherence': the value the other fields would predict */
  expected?: number;
}

/** Top-k reasons why a row is unusual: broken coherence between fields first, then extreme single values. */
export function topContributions(model: ForestModel, row: Float64Array, topK: number): Contribution[] {
  const F = model.nFeatures;
  const out: Contribution[] = [];
  const used = new Set<number>();
  if (model.coherence) {
    const zrow = new Float64Array(F);
    for (let j = 0; j < F; j++) zrow[j] = toZ(transformValue(row[j], model.log[j]), model.median[j], model.scale[j]);
    const attr = coherenceAttribution(model.coherence, zrow);
    if (attr.dist > model.coherence.dev0) {
      const order = Array.from({ length: F }, (_, j) => j)
        .filter((j) => model.kinds[j] !== 'missing' && Math.abs(attr.t[j]) >= 3)
        .sort((a, b) => Math.abs(attr.t[b]) - Math.abs(attr.t[a]) || a - b);
      for (const j of order.slice(0, Math.min(2, topK))) {
        const v = model.median[j] + attr.expectedZ[j] * model.scale[j];
        const expected = model.log[j] ? Math.exp(v) : v;
        out.push({ featureIndex: j, kind: 'coherence', deviation: attr.t[j], value: row[j], expected });
        used.add(j);
      }
    }
  }
  const cands: Contribution[] = [];
  for (let j = 0; j < F; j++) {
    if (used.has(j)) continue;
    const kind = model.kinds[j];
    const value = row[j];
    if (kind === 'missing') {
      if (Number.isNaN(value) || value < 0.5) continue;
      const rate = model.indicatorRate[j];
      if (rate > 0.2) continue;
      const strength = Math.min(MAX_ABS_Z, -Math.log(Math.max(rate, 1e-4)) * 1.5);
      cands.push({ featureIndex: j, kind, deviation: strength, value });
      continue;
    }
    if (Number.isNaN(value)) continue;
    const dev = toZ(transformValue(value, model.log[j]), model.median[j], model.scale[j]);
    if (Number.isNaN(dev) || (model.log[j] && !(value > 0))) continue;
    if (kind === 'rarity' && dev <= 0) continue;
    // keep only values that are unusual in themselves
    if (Math.abs(dev) < 2.5 && out.length > 0) continue;
    cands.push({ featureIndex: j, kind, deviation: dev, value });
  }
  cands.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation) || a.featureIndex - b.featureIndex);
  for (const c of cands) {
    if (out.length >= topK) break;
    out.push(c);
  }
  return out;
}

export function serializeModel(model: ForestModel): string {
  return JSON.stringify(model, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v));
}

export function deserializeModel(json: string): ForestModel {
  const raw = JSON.parse(json) as Omit<ForestModel, 'trees'> & { trees: Array<Record<keyof Tree, number[]>> };
  if (raw.version !== 1) throw new Error('Versión de modelo no soportada');
  const trees: Tree[] = raw.trees.map((t) => ({
    feature: Int16Array.from(t.feature),
    split: Float64Array.from(t.split),
    left: Int32Array.from(t.left),
    right: Int32Array.from(t.right),
    size: Int32Array.from(t.size),
  }));
  return { ...raw, trees };
}
