/**
 * Coherence model: a robust Gaussian model of the joint distribution of the (robust-scaled) features.
 *
 * An Isolation Forest splits ONE feature at a time, so it is weak at spotting rows whose individual values are all
 * plausible but whose COMBINATION is impossible (e.g. shipping cost vs distance and weight). The Mahalanobis distance
 * uses the covariance (the relations between fields) and amplifies deviations along the low-variance directions,
 * which is exactly where "broken relations" live.
 *
 * Robustness: trimmed fit (the most distant rows are excluded and the model is refit), calibration only on kept rows.
 * Attribution: with the precision matrix P = Σ^-1 the conditional residual of feature j given all the others is
 * r_j = (P (x-μ))_j / P_jj, standardised t_j = (P (x-μ))_j / sqrt(P_jj). The expected value of x_j is x_j - r_j.
 */
export interface CoherenceModel {
  n: number;
  F: number;
  mean: number[];
  /** F x F precision matrix, row-major */
  precision: number[];
  /** distances above this are anomalous (>= 1.5 x the 99.9th percentile of trimmed training distances, at least sqrt(F)+4) */
  dev0: number;
}

export function jacobiEigen(matrix: Float64Array, F: number): { values: Float64Array; vectors: Float64Array } {
  const a = Float64Array.from(matrix);
  const v = new Float64Array(F * F);
  for (let i = 0; i < F; i++) v[i * F + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < F - 1; p++) for (let q = p + 1; q < F; q++) off += a[p * F + q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < F - 1; p++) {
      for (let q = p + 1; q < F; q++) {
        const apq = a[p * F + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q * F + q] - a[p * F + p]) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let r = 0; r < F; r++) {
          const arp = a[r * F + p];
          const arq = a[r * F + q];
          a[r * F + p] = c * arp - s * arq;
          a[r * F + q] = s * arp + c * arq;
        }
        for (let r = 0; r < F; r++) {
          const apr = a[p * F + r];
          const aqr = a[q * F + r];
          a[p * F + r] = c * apr - s * aqr;
          a[q * F + r] = s * apr + c * aqr;
        }
        for (let r = 0; r < F; r++) {
          const vrp = v[r * F + p];
          const vrq = v[r * F + q];
          v[r * F + p] = c * vrp - s * vrq;
          v[r * F + q] = s * vrp + c * vrq;
        }
      }
    }
  }
  const values = new Float64Array(F);
  for (let i = 0; i < F; i++) values[i] = a[i * F + i];
  return { values, vectors: v }; // eigenvectors are the COLUMNS of v
}

function meanCovPrecision(z: Float64Array, n: number, F: number): { mean: number[]; precision: number[] } | null {
  const mean = new Array<number>(F).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < F; j++) mean[j] += z[i * F + j];
  for (let j = 0; j < F; j++) mean[j] /= n;
  const cov = new Float64Array(F * F);
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < F; p++) {
      const dp = z[i * F + p] - mean[p];
      if (dp === 0) continue;
      for (let q = p; q < F; q++) cov[p * F + q] += dp * (z[i * F + q] - mean[q]);
    }
  }
  let trace = 0;
  for (let p = 0; p < F; p++) {
    for (let q = p; q < F; q++) {
      const c = cov[p * F + q] / (n - 1);
      cov[p * F + q] = c;
      cov[q * F + p] = c;
    }
    trace += cov[p * F + p];
  }
  if (!(trace > 1e-12)) return null;
  const { values, vectors } = jacobiEigen(cov, F);
  const floor = Math.max(1e-10 * trace, 1e-12);
  const precision = new Array<number>(F * F).fill(0);
  for (let c = 0; c < F; c++) {
    const inv = 1 / Math.max(values[c], floor);
    for (let p = 0; p < F; p++) {
      const vp = vectors[p * F + c] * inv;
      for (let q = 0; q < F; q++) precision[p * F + q] += vp * vectors[q * F + c];
    }
  }
  return { mean, precision };
}

/** sqrt((x-μ)ᵀ P (x-μ)); optionally returns q = P (x-μ) in `outQ`. */
export function coherenceDistance(model: CoherenceModel, zrow: Float64Array, outQ?: Float64Array): number {
  const { F, mean, precision } = model;
  const d = new Float64Array(F);
  for (let j = 0; j < F; j++) d[j] = zrow[j] - mean[j];
  let sq = 0;
  for (let p = 0; p < F; p++) {
    let q = 0;
    const base = p * F;
    for (let r = 0; r < F; r++) q += precision[base + r] * d[r];
    if (outQ) outQ[p] = q;
    sq += d[p] * q;
  }
  return Math.sqrt(Math.max(0, sq));
}

export function fitCoherence(z: Float64Array, n: number, F: number, trim = 0.03): CoherenceModel | null {
  if (F < 3 || n < 50) return null;
  const first = meanCovPrecision(z, n, F);
  if (!first) return null;
  let model: CoherenceModel = { n, F, mean: first.mean, precision: first.precision, dev0: 0 };
  const dists = new Float64Array(n);
  const zrow = new Float64Array(F);
  const computeDists = (m: CoherenceModel, data: Float64Array, count: number): Float64Array => {
    const out = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < F; j++) zrow[j] = data[i * F + j];
      out[i] = coherenceDistance(m, zrow);
    }
    return out;
  };
  dists.set(computeDists(model, z, n));
  const cut = Float64Array.from(dists).sort()[Math.min(n - 1, Math.floor((1 - trim) * (n - 1)))];
  const keep: number[] = [];
  for (let i = 0; i < n; i++) if (dists[i] <= cut) keep.push(i);
  let zk = z;
  let nk = n;
  if (keep.length >= 50 && keep.length < n) {
    zk = new Float64Array(keep.length * F);
    keep.forEach((row, r) => zk.set(z.subarray(row * F, (row + 1) * F), r * F));
    nk = keep.length;
    const second = meanCovPrecision(zk, nk, F);
    if (second) model = { n: nk, F, mean: second.mean, precision: second.precision, dev0: 0 };
  }
  const sorted = computeDists(model, zk, nk).sort();
  const q999 = sorted[Math.min(nk - 1, Math.floor(0.999 * (nk - 1)))];
  model.dev0 = Math.max(Math.sqrt(F) + 4, 1.5 * q999);
  return model;
}

/** 0 below dev0, then 0.5 -> 1, aligned with Isolation Forest scores. */
export function coherenceScore(model: CoherenceModel, dist: number): number {
  if (dist <= model.dev0) return 0;
  const x = (dist - model.dev0) / model.dev0;
  return 0.5 + 0.5 * (1 - Math.exp(-(x * x)));
}

/** Per-feature standardised conditional residual t_j and the expected z value of each feature given the rest. */
export function coherenceAttribution(model: CoherenceModel, zrow: Float64Array): { t: Float64Array; expectedZ: Float64Array; dist: number } {
  const F = model.F;
  const q = new Float64Array(F);
  const dist = coherenceDistance(model, zrow, q);
  const t = new Float64Array(F);
  const expectedZ = new Float64Array(F);
  for (let j = 0; j < F; j++) {
    const pjj = model.precision[j * F + j];
    t[j] = pjj > 0 ? q[j] / Math.sqrt(pjj) : 0;
    expectedZ[j] = pjj > 0 ? zrow[j] - q[j] / pjj : zrow[j];
  }
  return { t, expectedZ, dist };
}
