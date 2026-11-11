/**
 * Coordinator: orchestrates the pipeline phases over a WorkerPool. It runs on the main thread but only
 * routes messages and merges SMALL structures (profiles, samples, findings), so it never blocks the UI.
 *
 *  PLAN -> PARSE(+profile) -> STATS -> [ML features -> train] -> DETECT -> RESOLVE
 */
import {
  resolveOptions,
  type AnalysisOptions,
  type AnomalyType,
  type DatasetProfile,
  type FeatureKind,
  type FeatureSpec,
  type Finding,
  type PartialProfile,
  type Progress,
  type ProcessingMode,
  type RelationCheck,
  type Report,
  type RiskLevel,
} from '../types';
import { applyStats, buildColumnProfiles, mergePartials, pickKeyColumn } from '../profile/merge';
import { acceptRelations, relationCandidates } from '../profile/relations';
import { columnLevelFindings } from '../detectors/columnLevel';
import { resolveDuplicates, resolveDuplicatesAsync, type ShardHashes } from '../detectors/duplicates';
import { buildFeatureSpec, schemaSignature, specFromBaseline } from '../ml/features';
import type { ForestModel } from '../ml/isolationForest';
import { riskFromScore } from '../i18n/es';
import type { ParseResult, PlanResult, RecordResult, RemoteMlResult, StatsResult } from './messages';
import type { WorkerPool } from './pool';

export interface BaselineScore {
  scores: number[];
  flags: boolean[];
  threshold: number;
  contributions: Record<string, Array<{ field: string; message: string; deviation: number; kind?: string; expected?: number | null }>>;
}

export interface TrainingSample {
  columns: string[];
  kinds: FeatureKind[];
  matrix: Float64Array;
  rows: number;
  schemaSignature: string;
  /** parameters used by the local model, so a baseline trained from this sample behaves the same in the AI */
  contamination: number;
  thresholdFloor: number;
}

export interface AnalyzeHooks {
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  /** Scores feature rows against a saved baseline (backend -> AI service). Throw to fall back to the local model. */
  scoreBaseline?: (matrix: Array<Array<number | null>>) => Promise<BaselineScore>;
  /** Called with the feature sample used for local training, so the UI can offer "Guardar como línea base". */
  onTrainingSample?: (sample: TrainingSample) => void;
}

export interface AnalysisSession {
  report: Report;
  profile: DatasetProfile;
  /** Fetch the original row (all columns) from the worker that owns it. */
  getRecord(recordIndex: number): Promise<RecordResult>;
  dispose(): void;
}

const CONTAMINATION = { low: 0.005, medium: 0.01, high: 0.03 } as const;
/** minimum Isolation Forest score to flag a row, per sensitivity (0.5 = perfectly normal) */
const THRESHOLD_FLOOR = { low: 0.65, medium: 0.6, high: 0.55 } as const;
const PHASE_WEIGHT = { plan: 0.04, parse: 0.4, stats: 0.14, features: 0.1, detect: 0.27, resolve: 0.05 } as const;
const REMOTE_CHUNK = 5000;
const TRAINING_SAMPLE = 20000;

export class AnalysisAborted extends Error {
  constructor() {
    super('Análisis cancelado');
    this.name = 'AnalysisAborted';
  }
}

export async function analyzeFile(
  pool: WorkerPool,
  file: Blob,
  fileName: string,
  partialOptions: Partial<AnalysisOptions> | undefined,
  mode: ProcessingMode,
  hooks: AnalyzeHooks = {},
): Promise<AnalysisSession> {
  const options = resolveOptions(partialOptions);
  const t0 = now();
  const phaseMs: Record<string, number> = {};
  const warnings: string[] = [];
  const check = (): void => {
    if (hooks.signal?.aborted) throw new AnalysisAborted();
  };
  let overallDone = 0;
  const report = (phase: Progress['phase'], fraction: number, message: string, extra: Partial<Progress> = {}): void => {
    const weight = phase === 'done' ? 0 : PHASE_WEIGHT[phase as keyof typeof PHASE_WEIGHT];
    hooks.onProgress?.({ phase, fraction, overall: Math.min(1, overallDone + weight * fraction), message, ...extra });
  };
  const endPhase = (phase: keyof typeof PHASE_WEIGHT, start: number): void => {
    phaseMs[phase] = Math.round(now() - start);
    overallDone += PHASE_WEIGHT[phase];
  };

  // ---------------------------------------------------------------- PLAN
  let t = now();
  report('plan', 0, 'Leyendo estructura del archivo…');
  const blocking = mode === 'main';
  const plan: PlanResult = await pool.call(0, 'plan', { file, fileName, shardCount: pool.size, dateOrder: options.dateOrder, blocking }, {
    onProgress: (p) => report('plan', p.fraction ?? 0, 'Planificando particiones del archivo…', { bytes: p.bytes }),
  });
  warnings.push(...plan.warnings);
  check();
  endPhase('plan', t);

  // ---------------------------------------------------------------- PARSE
  t = now();
  report('parse', 0, 'Leyendo y perfilando registros…');
  const shards = buildShardRequests(plan, pool.size, blocking, file);
  const shardCount = shards.length;
  const bytesPerShard = new Array<number>(shardCount).fill(0);
  const rowsPerShard = new Array<number>(shardCount).fill(0);
  const parsed: ParseResult[] = await Promise.all(
    shards.map((req, i) =>
      pool.call(i, 'parse', req, {
        onProgress: (p) => {
          bytesPerShard[i] = p.bytes ?? bytesPerShard[i];
          rowsPerShard[i] = p.rows ?? rowsPerShard[i];
          const bytes = bytesPerShard.reduce((a, b) => a + b, 0);
          const rows = rowsPerShard.reduce((a, b) => a + b, 0);
          report('parse', plan.totalBytes > 0 && plan.rows === null ? Math.min(1, bytes / plan.totalBytes) : 0.5, 'Leyendo y perfilando registros…', { rows, bytes });
        },
      }),
    ),
  );
  check();
  for (const p of parsed) warnings.push(...p.warnings);
  const offsets: number[] = [];
  let totalRows = 0;
  for (const p of parsed) {
    offsets.push(totalRows);
    totalRows += p.rowCount;
  }
  if (totalRows === 0) throw new Error('El archivo no contiene registros para analizar.');
  report('parse', 1, 'Registros leídos', { rows: totalRows });
  endPhase('parse', t);

  // ---------------------------------------------------------------- MERGE + STATS
  t = now();
  report('stats', 0, 'Calculando estadísticas globales…', { rows: totalRows });
  const merged: PartialProfile = mergePartials(parsed.map((p) => p.partial));
  const columns = buildColumnProfiles(plan.header, merged, options);
  const keyColumn = pickKeyColumn(columns, options.keyColumns);
  const candidates = relationCandidates(columns);
  const statsParts: StatsResult[] = await Promise.all(
    shards.map((_, i) => pool.call(i, 'stats', { columns, candidates, dateOrder: options.dateOrder })),
  );
  check();
  applyStats(columns, statsParts);
  const checks = sumChecks(statsParts.map((s) => s.relations));
  const profile: DatasetProfile = {
    rows: totalRows,
    columns,
    keyColumn,
    relations: options.detectors.relations ? acceptRelations(candidates, checks) : [],
    relationCandidates: candidates,
  };
  endPhase('stats', t);

  // ---------------------------------------------------------------- ML
  t = now();
  report('features', 0, 'Preparando el modelo de anomalías…');
  let forest: ForestModel | null = null;
  let spec: FeatureSpec[] | null = null;
  let remote: RemoteMlResult[] | null = null;
  let mlMode = options.detectors.ml ? options.ml.mode : 'off';
  if (mlMode === 'baseline') {
    const baseline = options.ml.baseline;
    const fallback = (reason: string): void => {
      warnings.push(reason + ' Se usó el modelo local entrenado con este mismo archivo.');
      mlMode = 'local';
    };
    if (!baseline || !hooks.scoreBaseline) fallback('No hay una línea base disponible.');
    else {
      const mapped = specFromBaseline(baseline, profile);
      if (!mapped.spec) fallback(`La línea base no es compatible con este archivo (faltan los campos: ${mapped.missingFields.slice(0, 6).join(', ')}).`);
      else {
        try {
          spec = mapped.spec;
          remote = await scoreAgainstBaseline(pool, shards.length, parsed, profile, spec, hooks.scoreBaseline, check, (f) => report('features', f, 'Puntuando con la línea base histórica…'));
        } catch (e) {
          if (e instanceof AnalysisAborted) throw e;
          remote = null;
          spec = null;
          fallback(`No se pudo usar la línea base (${e instanceof Error ? e.message : 'error desconocido'}).`);
        }
      }
    }
  }
  if (mlMode === 'local') {
    const s = buildFeatureSpec(profile);
    if (s.length < 2) {
      warnings.push('No hay suficientes columnas numéricas, de fecha o categóricas para entrenar el modelo de anomalías; se omitió la detección con IA.');
      mlMode = 'off';
    } else {
      spec = s;
      const feats = await Promise.all(
        shards.map((_, i) => pool.call(i, 'features', { profile, spec: s, offset: offsets[i], totalRows, seed: options.ml.seed, maxSample: TRAINING_SAMPLE })),
      );
      check();
      const rows = feats.reduce((a, f) => a + f.indexes.length, 0);
      const matrix = new Float64Array(rows * s.length);
      let at = 0;
      for (const f of feats) {
        matrix.set(f.matrix, at);
        at += f.matrix.length;
      }
      if (rows < 20) {
        warnings.push('Hay muy pocos registros para entrenar el modelo de anomalías; se omitió la detección con IA.');
        mlMode = 'off';
        spec = null;
      } else {
        const columnsF = s.map((f) => f.name);
        const kinds = s.map((f) => f.kind);
        report('features', 0.8, 'Entrenando el modelo de anomalías…');
        // trained inside a worker (it is CPU-heavy): the UI thread never runs it unless the user chose "main thread" mode
        forest = await pool.call(0, 'train', { matrix, rows, columns: columnsF, kinds, contamination: CONTAMINATION[options.sensitivity], thresholdFloor: THRESHOLD_FLOOR[options.sensitivity], seed: options.ml.seed });
        hooks.onTrainingSample?.({ columns: columnsF, kinds, matrix, rows, schemaSignature: schemaSignature(columnsF) });
      }
    }
  }
  check();
  endPhase('features', t);

  // ---------------------------------------------------------------- DETECT
  t = now();
  report('detect', 0, 'Buscando inconsistencias y anomalías…');
  let detectDone = 0;
  const detections = await Promise.all(
    shards.map(async (_, i) => {
      const res = await pool.call(i, 'detect', { profile, options: { ...options, ml: { ...options.ml, mode: mlMode } }, offset: offsets[i], forest, spec, remote: remote ? remote[i] : null });
      detectDone++;
      report('detect', detectDone / shards.length, 'Buscando inconsistencias y anomalías…', { rows: totalRows });
      return res;
    }),
  );
  check();
  endPhase('detect', t);

  // ---------------------------------------------------------------- RESOLVE
  t = now();
  report('resolve', 0, 'Resolviendo duplicados y armando el reporte…');
  let findings: Finding[] = [];
  for (const d of detections) findings.push(...d.findings);
  const keyName = keyColumn !== null ? columns[keyColumn].name : null;
  if (options.detectors.duplicates) {
    const dups = resolveDuplicates({ shards: detections.map((d) => d.hashes as ShardHashes), offsets, keyName });
    await attachRecordIds(pool, dups, offsets, shards.length);
    findings.push(...dups);
  }
  findings.push(...columnLevelFindings(profile, { types: options.detectors.types, suspicious: options.detectors.suspicious }));
  findings = dedupeMl(findings);
  findings.sort(compareFindings);

  const byRisk: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byType: Partial<Record<AnomalyType, number>> = {};
  const perRecord = new Map<number, { keep: number; count: number; id?: string }>();
  for (const f of findings) {
    byRisk[f.risk]++;
    byType[f.type] = (byType[f.type] ?? 0) + 1;
    if (f.recordIndex !== null) {
      const cur = perRecord.get(f.recordIndex) ?? { keep: 1, count: 0, id: f.recordId };
      cur.keep *= 1 - f.score / 100;
      cur.count++;
      perRecord.set(f.recordIndex, cur);
    }
  }
  const totalFindings = findings.length;
  const truncated = totalFindings > options.maxFindings;
  if (truncated) {
    findings = findings.slice(0, options.maxFindings);
    warnings.push(`El reporte tiene ${totalFindings.toLocaleString('es-CO')} hallazgos; se muestran los ${options.maxFindings.toLocaleString('es-CO')} de mayor puntaje.`);
  }
  const topRecords = [...perRecord.entries()]
    .map(([recordIndex, v]) => {
      const score = Math.round(100 * (1 - v.keep));
      return { recordIndex, recordId: v.id, risk: riskFromScore(score), score, findings: v.count };
    })
    .sort((a, b) => b.score - a.score || a.recordIndex - b.recordIndex)
    .slice(0, 50);
  endPhase('resolve', t);

  const reportOut: Report = {
    meta: {
      fileName,
      format: plan.format,
      fileSizeBytes: plan.totalBytes,
      rows: totalRows,
      columns: columns.length,
      durationMs: Math.round(now() - t0),
      mode,
      workers: pool.size,
      sensitivity: options.sensitivity,
      mlMode: mlMode === 'baseline' ? 'baseline' : mlMode === 'local' ? 'local' : 'off',
      baselineId: mlMode === 'baseline' ? options.ml.baseline?.id : undefined,
      keyColumn: keyName,
      warnings,
      truncated,
      phaseMs,
    },
    columns: columns.map((c) => ({ name: c.name, type: c.type, nullRate: c.nullRate, distinct: c.distinct })),
    findings,
    totalFindings,
    recordsAffected: perRecord.size,
    byRisk,
    byType,
    topRecords,
  };
  report('done', 1, 'Análisis completado');
  return {
    report: reportOut,
    profile,
    async getRecord(recordIndex: number): Promise<RecordResult> {
      let s = offsets.length - 1;
      while (s > 0 && offsets[s] > recordIndex) s--;
      return pool.call(s, 'record', { row: recordIndex - offsets[s] });
    },
    dispose(): void {
      pool.terminate();
    },
  };
}

// -------------------------------------------------------------------- helpers

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function buildShardRequests(plan: PlanResult, poolSize: number, blocking: boolean, file: Blob) {
  const base = { format: plan.format, delimiter: plan.delimiter, encoding: plan.encoding, header: plan.header, blocking };
  if (plan.ranges) {
    return plan.ranges.slice(0, Math.max(1, plan.ranges.length)).map((range, shardIndex) => ({ ...base, shardIndex, file, range }));
  }
  const rows = plan.rows ?? [];
  const n = Math.max(1, Math.min(blocking ? 1 : poolSize, Math.ceil(rows.length / 2000)));
  const size = Math.ceil(rows.length / n);
  return Array.from({ length: n }, (_, shardIndex) => ({ ...base, shardIndex, rows: rows.slice(shardIndex * size, (shardIndex + 1) * size) }));
}

function sumChecks(lists: RelationCheck[][]): RelationCheck[] {
  const map = new Map<string, RelationCheck>();
  for (const list of lists) {
    for (const c of list) {
      const cur = map.get(c.id) ?? { id: c.id, checked: 0, ok: 0 };
      cur.checked += c.checked;
      cur.ok += c.ok;
      map.set(c.id, cur);
    }
  }
  return [...map.values()];
}

async function scoreAgainstBaseline(
  pool: WorkerPool,
  shardCount: number,
  parsed: ParseResult[],
  profile: DatasetProfile,
  spec: FeatureSpec[],
  scorer: NonNullable<AnalyzeHooks['scoreBaseline']>,
  check: () => void,
  progress: (fraction: number) => void,
): Promise<RemoteMlResult[]> {
  const out: RemoteMlResult[] = [];
  const total = parsed.reduce((a, p) => a + p.rowCount, 0);
  let done = 0;
  for (let s = 0; s < shardCount; s++) {
    const n = parsed[s].rowCount;
    const scores = new Float32Array(n);
    const flags = new Uint8Array(n);
    const parts: RemoteMlResult['parts'] = {};
    let threshold = 0.55;
    for (let from = 0; from < n; from += REMOTE_CHUNK) {
      check();
      const chunk = await pool.call(s, 'featureChunk', { profile, spec, from, count: REMOTE_CHUNK });
      const F = spec.length;
      const matrix: Array<Array<number | null>> = [];
      for (let r = 0; r < chunk.count; r++) {
        const row: Array<number | null> = new Array(F);
        for (let k = 0; k < F; k++) {
          const v = chunk.matrix[r * F + k];
          row[k] = Number.isNaN(v) ? null : v;
        }
        matrix.push(row);
      }
      const res = await scorer(matrix);
      threshold = res.threshold;
      for (let r = 0; r < chunk.count; r++) {
        scores[from + r] = res.scores[r];
        flags[from + r] = res.flags[r] ? 1 : 0;
        const c = res.contributions[String(r)];
        if (c) parts[from + r] = c;
      }
      done += chunk.count;
      progress(done / total);
    }
    out.push({ scores, flags, parts, threshold });
  }
  return out;
}

async function attachRecordIds(pool: WorkerPool, findings: Finding[], offsets: number[], shardCount: number): Promise<void> {
  const byShard: Array<Array<{ f: Finding; row: number }>> = Array.from({ length: shardCount }, () => []);
  for (const f of findings) {
    if (f.recordIndex === null) continue;
    let s = shardCount - 1;
    while (s > 0 && offsets[s] > f.recordIndex) s--;
    byShard[s].push({ f, row: f.recordIndex - offsets[s] });
  }
  await Promise.all(
    byShard.map(async (list, s) => {
      if (list.length === 0) return;
      const res = await pool.call(s, 'ids', { rows: list.map((x) => x.row) });
      list.forEach((x, i) => {
        const id = res.ids[i];
        if (id) x.f.recordId = id;
      });
    }),
  );
}

/** An IA finding is dropped when a rule-based finding already explains the same field of the same record. */
function dedupeMl(findings: Finding[]): Finding[] {
  const covered = new Set<string>();
  for (const f of findings) {
    if (f.detector !== 'isolation_forest' && f.recordIndex !== null && f.field !== null) covered.add(`${f.recordIndex}|${f.field}`);
  }
  return findings.filter((f) => !(f.detector === 'isolation_forest' && f.field !== null && f.recordIndex !== null && covered.has(`${f.recordIndex}|${f.field}`)));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareFindings(a: Finding, b: Finding): number {
  if (a.score !== b.score) return b.score - a.score;
  const ai = a.recordIndex ?? Number.MAX_SAFE_INTEGER;
  const bi = b.recordIndex ?? Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai - bi;
  return cmp(a.type, b.type) || cmp(a.field ?? '', b.field ?? '') || cmp(a.explanation, b.explanation);
}
