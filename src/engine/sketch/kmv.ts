/**
 * K-Minimum-Values distinct-count sketch. Keeps the k smallest 32-bit hashes seen.
 * Union of two sketches = the k smallest of the union, independent of partitioning,
 * so merged results are deterministic. Exact while fewer than k distinct values exist.
 */
export class KmvSketch {
  private values: number[] = []; // sorted ascending, unique
  private set = new Set<number>();
  constructor(readonly k = 1024) {}

  add(hash: number): void {
    if (this.set.has(hash)) return;
    if (this.values.length >= this.k && hash >= this.values[this.values.length - 1]) return;
    this.set.add(hash);
    // binary insert
    let lo = 0;
    let hi = this.values.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.values[mid] < hash) lo = mid + 1;
      else hi = mid;
    }
    this.values.splice(lo, 0, hash);
    if (this.values.length > this.k) {
      const dropped = this.values.pop()!;
      this.set.delete(dropped);
    }
  }

  merge(other: KmvSketch): void {
    for (const h of other.values) this.add(h);
  }

  /** True when the estimate is exact (never saturated). */
  get exact(): boolean {
    return this.values.length < this.k;
  }

  estimate(): number {
    if (this.exact) return this.values.length;
    const kth = this.values[this.k - 1];
    return Math.round((this.k - 1) / (kth / 4294967296));
  }

  serialize(): number[] {
    return this.values.slice();
  }

  static from(values: number[], k = 1024): KmvSketch {
    const s = new KmvSketch(k);
    for (const v of values) s.add(v);
    return s;
  }
}
