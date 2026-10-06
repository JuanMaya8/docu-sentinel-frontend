/**
 * DDSketch-style quantile sketch with relative error `alpha` (default 1%).
 *
 * KEY PROPERTY: merging is just adding integer bucket counts, so the merged sketch is
 * IDENTICAL regardless of how the data was partitioned across workers or in which order
 * shards are merged. That is what makes the whole pipeline deterministic for any pool size
 * (a t-digest or a reservoir sample would not be).
 */
export interface SerializedSketch {
  /** [bucketIndex, count] sorted by index */
  pos: Array<[number, number]>;
  neg: Array<[number, number]>;
  zero: number;
  count: number;
  min: number;
  max: number;
}

const ALPHA = 0.01;
const GAMMA = (1 + ALPHA) / (1 - ALPHA);
const LOG_GAMMA = Math.log(GAMMA);

export class QuantileSketch {
  private pos = new Map<number, number>();
  private neg = new Map<number, number>();
  private zero = 0;
  count = 0;
  min = Infinity;
  max = -Infinity;

  static bucketIndex(absValue: number): number {
    return Math.ceil(Math.log(absValue) / LOG_GAMMA);
  }

  /** Representative value of a bucket (relative error <= alpha). */
  static bucketValue(index: number): number {
    return (2 * Math.pow(GAMMA, index)) / (GAMMA + 1);
  }

  add(x: number): void {
    if (!Number.isFinite(x)) return;
    this.count++;
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
    if (x === 0) {
      this.zero++;
      return;
    }
    const map = x > 0 ? this.pos : this.neg;
    const idx = QuantileSketch.bucketIndex(Math.abs(x));
    map.set(idx, (map.get(idx) ?? 0) + 1);
  }

  merge(other: QuantileSketch): void {
    this.count += other.count;
    this.zero += other.zero;
    if (other.min < this.min) this.min = other.min;
    if (other.max > this.max) this.max = other.max;
    for (const [i, c] of other.pos) this.pos.set(i, (this.pos.get(i) ?? 0) + c);
    for (const [i, c] of other.neg) this.neg.set(i, (this.neg.get(i) ?? 0) + c);
  }

  /** q in [0,1]. Returns NaN when empty. */
  quantile(q: number): number {
    if (this.count === 0) return NaN;
    if (q <= 0) return this.min;
    if (q >= 1) return this.max;
    const rank = q * (this.count - 1);
    let seen = 0;
    // negatives: largest magnitude first (most negative)
    const negIdx = [...this.neg.keys()].sort((a, b) => b - a);
    for (const i of negIdx) {
      seen += this.neg.get(i)!;
      if (seen > rank) return -QuantileSketch.bucketValue(i);
    }
    seen += this.zero;
    if (seen > rank) return 0;
    const posIdx = [...this.pos.keys()].sort((a, b) => a - b);
    for (const i of posIdx) {
      seen += this.pos.get(i)!;
      if (seen > rank) return QuantileSketch.bucketValue(i);
    }
    return this.max;
  }

  serialize(): SerializedSketch {
    const sortEntries = (m: Map<number, number>): Array<[number, number]> =>
      [...m.entries()].sort((a, b) => a[0] - b[0]);
    return {
      pos: sortEntries(this.pos),
      neg: sortEntries(this.neg),
      zero: this.zero,
      count: this.count,
      min: this.min,
      max: this.max,
    };
  }

  static from(s: SerializedSketch): QuantileSketch {
    const q = new QuantileSketch();
    for (const [i, c] of s.pos) q.pos.set(i, c);
    for (const [i, c] of s.neg) q.neg.set(i, c);
    q.zero = s.zero;
    q.count = s.count;
    q.min = s.min;
    q.max = s.max;
    return q;
  }
}
