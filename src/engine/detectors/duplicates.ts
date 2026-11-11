import type { Finding } from '../types';
import { es, riskFromScore } from '../i18n/es';

/** Per-shard hashes returned by workers (53-bit hashes stored as doubles; 0 = "not applicable"). */
export interface ShardHashes {
  exact: Float64Array;
  key: Float64Array | null;
  near: Float64Array | null;
}

export interface DuplicateInput {
  shards: ShardHashes[];
  offsets: number[];
  keyName: string | null;
  recordIdOf?: (globalIndex: number) => string | undefined;
}

function make(
  recordIndex: number,
  type: Finding['type'],
  score: number,
  field: string | null,
  explanation: string,
  recordId?: string,
): Finding {
  const f: Finding = { recordIndex, type, risk: riskFromScore(score), score, field, explanation, detector: 'duplicates' };
  if (recordId !== undefined) f.recordId = recordId;
  return f;
}

/**
 * Cross-shard duplicate resolution. Rows are visited in GLOBAL order, so "the first occurrence" is the same
 * no matter how the file was split between workers (determinism).
 * Priority per row: exact > duplicate key > near duplicate.
 */
function createResolver(input: DuplicateInput): { visit: (s: number, i: number) => void; out: Finding[] } {
  const { shards, offsets, keyName } = input;
  const out: Finding[] = [];
  const firstExact = new Map<number, number>();
  const firstKey = new Map<number, number>();
  const firstNear = new Map<number, number>();
  const idOf = input.recordIdOf;
  const visit = (s: number, i: number): void => {
    const sh = shards[s];
    const g = offsets[s] + i;
    const hExact = sh.exact[i];
    const firstE = firstExact.get(hExact);
    if (firstE !== undefined) {
      out.push(make(g, 'duplicate_exact', 75, null, es.duplicateExact(firstE + 1), idOf?.(g)));
      return;
    }
    firstExact.set(hExact, g);
    const hKey = sh.key ? sh.key[i] : 0;
    if (hKey !== 0) {
      const firstK = firstKey.get(hKey);
      if (firstK !== undefined) {
        out.push(make(g, 'duplicate_key', 85, keyName, es.duplicateKey(keyName ?? 'identificador', firstK + 1), idOf?.(g)));
        return;
      }
      firstKey.set(hKey, g);
    }
    const hNear = sh.near ? sh.near[i] : 0;
    if (hNear !== 0) {
      const firstN = firstNear.get(hNear);
      if (firstN !== undefined) {
        out.push(make(g, 'duplicate_near', 55, null, es.duplicateNear(firstN + 1), idOf?.(g)));
        return;
      }
      firstNear.set(hNear, g);
    }
  };
  return { visit, out };
}

export function resolveDuplicates(input: DuplicateInput): Finding[] {
  const r = createResolver(input);
  for (let s = 0; s < input.shards.length; s++) {
    const n = input.shards[s].exact.length;
    for (let i = 0; i < n; i++) r.visit(s, i);
  }
  return r.out;
}

/**
 * Same result as `resolveDuplicates` (same global visiting order), but awaits `pause()` every `every` rows so the UI
 * thread can paint and handle input while hundreds of thousands of rows are resolved.
 */
export async function resolveDuplicatesAsync(input: DuplicateInput, pause: () => Promise<void>, every = 100_000): Promise<Finding[]> {
  const r = createResolver(input);
  let visited = 0;
  for (let s = 0; s < input.shards.length; s++) {
    const n = input.shards[s].exact.length;
    for (let i = 0; i < n; i++) {
      r.visit(s, i);
      if (++visited % every === 0) await pause();
    }
  }
  return r.out;
}
