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
export function resolveDuplicates(input: DuplicateInput): Finding[] {
  const { shards, offsets, keyName } = input;
  const out: Finding[] = [];
  const firstExact = new Map<number, number>();
  const firstKey = new Map<number, number>();
  const firstNear = new Map<number, number>();
  const idOf = input.recordIdOf;
  for (let s = 0; s < shards.length; s++) {
    const sh = shards[s];
    const base = offsets[s];
    for (let i = 0; i < sh.exact.length; i++) {
      const g = base + i;
      const hExact = sh.exact[i];
      const firstE = firstExact.get(hExact);
      if (firstE !== undefined) {
        out.push(make(g, 'duplicate_exact', 75, null, es.duplicateExact(firstE + 1), idOf?.(g)));
        continue;
      }
      firstExact.set(hExact, g);
      const hKey = sh.key ? sh.key[i] : 0;
      if (hKey !== 0) {
        const firstK = firstKey.get(hKey);
        if (firstK !== undefined) {
          out.push(make(g, 'duplicate_key', 85, keyName, es.duplicateKey(keyName ?? 'identificador', firstK + 1), idOf?.(g)));
          continue;
        }
        firstKey.set(hKey, g);
      }
      const hNear = sh.near ? sh.near[i] : 0;
      if (hNear !== 0) {
        const firstN = firstNear.get(hNear);
        if (firstN !== undefined) {
          out.push(make(g, 'duplicate_near', 55, null, es.duplicateNear(firstN + 1), idOf?.(g)));
          continue;
        }
        firstNear.set(hNear, g);
      }
    }
  }
  return out;
}
