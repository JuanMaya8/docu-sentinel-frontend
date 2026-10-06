/**
 * ShardEngine: the stateful unit of work. Each worker (or each InlinePool slot) owns one engine that
 * keeps its shard in memory as COLUMNS (string[] per column + typed arrays built later), so the heavy
 * data never travels between threads; only small profiles, samples and findings do.
 *
 * The worker script is a thin postMessage wrapper around `handle()`. Tests and the "main thread" mode
 * call `handle()` directly.
 */
import type { ColumnProfile, FileFormat, PartialProfile, StatsColumn, StatsPartial, RelationCheck, RelationSpec, DatasetProfile } from '../types';
import { ColumnAccumulator } from '../profile/accumulator';
import { QuantileSketch } from '../sketch/ddsketch';
import { CsvParser, normalizeHeader, sniffDelimiter } from '../parsers/csv';
import { discoverNdjsonHeader, parseJsonText, parseNdjsonLine } from '../parsers/json';
import { extractPdfTable, type PdfJsLike } from '../parsers/pdf';
import { BoundaryScanner, effectiveShardCount, rangesFrom } from './planner';
import { MAX_JSON_BYTES, detectFormat, pickEncoding, readHead, readTextChunks } from './ingest';
import { isNullToken, normalizeForNear } from '../util/text';
import { leadingDigit, parseNumber } from '../util/numbers';
import { parseDate } from '../util/dates';
import { hash53 } from '../util/hash';
import { unitFromInt } from '../util/hash';
import { DATE_FORMAT_CODES, makeEmitter, type DetectContext, type ShardView } from '../detectors/context';
import { detectMissing, emptyRowMask } from '../detectors/missing';
import { detectTypes } from '../detectors/typeChecks';
import { detectRange } from '../detectors/range';
import { detectRelations } from '../detectors/relationsDetector';
import { detectSuspicious } from '../detectors/suspicious';
import type { ShardHashes } from '../detectors/duplicates';
import { extractFeatureRow, rarityTables } from '../ml/features';
import { scoreMatrix, topContributions, trainForest } from '../ml/isolationForest';
import { explainContribution } from '../ml/explain';
import { es } from '../i18n/es';
import { withinTolerance } from '../profile/relations';
import type { Finding } from '../types';
import type {
  DetectRequest,
  DetectResult,
  FeatureChunkRequest,
  FeatureChunkResult,
  FeaturesRequest,
  FeaturesResult,
  IdsRequest,
  IdsResult,
  ParseRequest,
  ParseResult,
  PlanRequest,
  PlanResult,
  ProgressMsg,
  RecordRequest,
  RecordResult,
  StatsRequest,
  TrainRequest,
} from './messages';

export interface ShardEngineOptions {
  loadPdfJs?: () => Promise<PdfJsLike>;
}

export type ProgressFn = (p: ProgressMsg) => void;

const THRESHOLD_MANTISSAS = [1, 2, 5];

export class ShardEngine {
  private header: string[] = [];
  private raw: string[][] = [];
  private rowCount = 0;
  private view: ShardView | null = null;
  private keyColumnIndex: number | null = null;

  constructor(private readonly options: ShardEngineOptions = {}) {}

  async handle(type: string, payload: unknown, progress: ProgressFn = () => {}): Promise<unknown> {
    switch (type) {
      case 'plan':
        return this.plan(payload as PlanRequest, progress);
      case 'parse':
        return this.parse(payload as ParseRequest, progress);
      case 'stats':
        return this.stats(payload as StatsRequest);
      case 'features':
        return this.features(payload as FeaturesRequest);
      case 'featureChunk':
        return this.featureChunk(payload as FeatureChunkRequest);
      case 'train': {
        const r = payload as TrainRequest;
        return trainForest(r.matrix, r.rows, { columns: r.columns, kinds: r.kinds, contamination: r.contamination, thresholdFloor: r.thresholdFloor, seed: r.seed });
      }
      case 'detect':
        return this.detect(payload as DetectRequest);
      case 'record':
        return this.record(payload as RecordRequest);
      case 'ids':
        return this.ids(payload as IdsRequest);
      case 'dispose':
        this.raw = [];
        this.view = null;
        this.rowCount = 0;
        return null;
      default:
        throw new Error(`Mensaje desconocido: ${type}`);
    }
  }

  // ------------------------------------------------------------------ PLAN

  private async plan(req: PlanRequest, progress: ProgressFn): Promise<PlanResult> {
    const { file, fileName } = req;
    const total = file.size;
    if (total === 0) throw new Error('El archivo está vacío.');
    const head = await readHead(file);
    const format = detectFormat(fileName, head);
    const encoding = pickEncoding(head);
    const warnings: string[] = [];

    if (format === 'pdf') {
      if (!this.options.loadPdfJs) throw new Error('La lectura de PDF no está disponible en este entorno.');
      const tab = await extractPdfTable(await file.arrayBuffer(), await this.options.loadPdfJs());
      return { format, delimiter: null, encoding, header: tab.header, ranges: null, rows: tab.rows, totalBytes: total, warnings: tab.warnings };
    }
    if (format === 'json') {
      if (total > MAX_JSON_BYTES) throw new Error('El JSON supera 400 MB. Conviértelo a NDJSON (un objeto por línea) para procesarlo por partes.');
      const tab = parseJsonText(new TextDecoder(encoding).decode(await file.arrayBuffer()));
      if (tab.rows.length === 0) throw new Error('El JSON no contiene registros.');
      return { format, delimiter: null, encoding, header: normalizeHeader(tab.header), ranges: null, rows: tab.rows, totalBytes: total, warnings: tab.warnings };
    }

    const headText = new TextDecoder(encoding).decode(head);
    const shardCount = req.blocking ? 1 : effectiveShardCount(req.shardCount, total);
    let delimiter: string | null = null;
    let header: string[];
    if (format === 'ndjson') {
      const lines = headText.split(/\r?\n/);
      if (head.length < total) lines.pop(); // last line may be cut
      const d = discoverNdjsonHeader(lines.slice(0, 2000));
      header = normalizeHeader(d.header);
      warnings.push(...d.warnings);
      if (header.length === 0) throw new Error('No se encontraron registros JSON válidos en el archivo.');
    } else {
      delimiter = format === 'tsv' ? '\t' : sniffDelimiter(headText.slice(0, 65536));
      let first: string[] | null = null;
      const parser = new CsvParser({
        delimiter,
        onRow: (r) => {
          if (!first) first = r;
        },
      });
      parser.push(headText);
      if (!first) throw new Error('No se pudo leer el encabezado del archivo.');
      header = normalizeHeader(first);
    }

    const scanner = new BoundaryScanner(format !== 'ndjson', total, shardCount, format === 'ndjson' ? false : true);
    if (req.blocking && format !== 'ndjson') {
      scanner.push(head);
      const r = scanner.result();
      if (r.totalBytes < total && scannerHeaderUnknown(scanner)) {
        // header longer than the head sample: scan the rest (rare)
        await readRemaining(file, head.length, scanner);
      }
      const res = scanner.result();
      return { format, delimiter, encoding, header, ranges: [{ start: res.headerEnd, end: total }], rows: null, totalBytes: total, warnings };
    }
    if (req.blocking) {
      return { format, delimiter, encoding, header, ranges: [{ start: 0, end: total }], rows: null, totalBytes: total, warnings };
    }
    const reader = file.stream().getReader();
    let read = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      scanner.push(value);
      read += value.byteLength;
      progress({ bytes: read, fraction: read / total });
    }
    const ranges = rangesFrom(scanner.result());
    return { format, delimiter, encoding, header, ranges, rows: null, totalBytes: total, warnings };
  }

  // ------------------------------------------------------------------ PARSE

  private async parse(req: ParseRequest, progress: ProgressFn): Promise<ParseResult> {
    const header = req.header;
    const W = header.length;
    const cols: string[][] = Array.from({ length: W }, () => []);
    const accs = header.map(() => new ColumnAccumulator());
    const warnings: string[] = [];
    let ragged = 0;
    let rows = 0;
    let lastTick = Date.now();
    let bytesRead = 0;

    const addRow = (fields: string[]): void => {
      if (fields.length !== W) ragged++;
      for (let c = 0; c < W; c++) {
        const v = c < fields.length ? fields[c] : '';
        cols[c].push(v);
        accs[c].add(v);
      }
      rows++;
      if ((rows & 0x3fff) === 0) {
        const now = Date.now();
        if (now - lastTick > 120) {
          lastTick = now;
          progress({ rows, bytes: bytesRead });
        }
      }
    };

    const format: FileFormat = req.format;
    if (req.rows) {
      for (const r of req.rows) addRow(r);
    } else if (req.file && req.range) {
      const blob = req.file.slice(req.range.start, req.range.end);
      if (format === 'ndjson') {
        let bad = 0;
        let leftover = '';
        const handleLine = (line: string): void => {
          if (line.trim().length === 0) return;
          try {
            const r = parseNdjsonLine(line, header);
            if (r) addRow(r);
          } catch {
            bad++;
          }
        };
        const onText = (text: string): void => {
          const parts = (leftover + text).split('\n');
          leftover = parts.pop() ?? '';
          for (const l of parts) handleLine(l);
        };
        if (req.blocking) onText(new TextDecoder(req.encoding).decode(await blob.arrayBuffer()));
        else await readTextChunks(blob, req.encoding, onText, (b) => (bytesRead = b));
        handleLine(leftover);
        if (bad > 0) warnings.push(`${bad} línea(s) NDJSON inválidas fueron omitidas.`);
      } else {
        const parser = new CsvParser({ delimiter: req.delimiter ?? ',', onRow: addRow, onWarning: (m) => warnings.push(m) });
        if (req.blocking) parser.push(new TextDecoder(req.encoding).decode(await blob.arrayBuffer()));
        else await readTextChunks(blob, req.encoding, (t) => parser.push(t), (b) => (bytesRead = b));
        parser.end();
      }
    }
    if (ragged > 0) warnings.push(`${ragged} fila(s) tenían un número de columnas distinto al encabezado (se rellenaron o recortaron).`);

    this.header = header;
    this.raw = cols;
    this.rowCount = rows;
    this.view = null;
    const partial: PartialProfile = { rows, columns: accs.map((a) => a.toPartial()) };
    return { rowCount: rows, partial, warnings };
  }

  // ------------------------------------------------------------------ STATS

  private stats(req: StatsRequest): StatsPartial {
    const n = this.rowCount;
    const W = this.header.length;
    const numeric: Array<Float64Array | null> = new Array(W).fill(null);
    const dates: Array<Float64Array | null> = new Array(W).fill(null);
    const nullMask: Array<Uint8Array | null> = new Array(W).fill(null);
    const dateFormat: Array<Uint8Array | null> = new Array(W).fill(null);
    const dateImpossible: Array<Uint8Array | null> = new Array(W).fill(null);
    const stats: StatsColumn[] = [];

    for (const col of req.columns) {
      const raw = this.raw[col.index];
      const nm = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const v = raw[i];
        if (v.length === 0 || isNullToken(v)) nm[i] = 1;
      }
      nullMask[col.index] = nm;
      const s: StatsColumn = {
        sketch: null,
        leadingDigits: new Array<number>(9).fill(0),
        nonZero: 0,
        multiplesOf1000: 0,
        negatives: 0,
        zeros: 0,
        thresholdCounts: [],
        dateMin: Infinity,
        dateMax: -Infinity,
      };
      if (col.type === 'integer' || col.type === 'decimal') {
        const arr = new Float64Array(n).fill(NaN);
        const sketch = new QuantileSketch();
        const trackThresholds = (col.role.amount || col.role.price) && !col.role.identifier;
        const thr = new Map<string, [number, number, number]>();
        for (let i = 0; i < n; i++) {
          if (nm[i]) continue;
          const v = parseNumber(raw[i], col.numberStyle);
          if (Number.isNaN(v)) continue;
          arr[i] = v;
          sketch.add(v);
          if (v < 0) s.negatives++;
          if (v === 0) {
            s.zeros++;
            continue;
          }
          s.nonZero++;
          const d = leadingDigit(v);
          if (d > 0) s.leadingDigits[d - 1]++;
          if (Math.abs(v) >= 1000 && Math.abs(v) % 1000 === 0) s.multiplesOf1000++;
          if (trackThresholds && v > 0) {
            const e = Math.floor(Math.log10(v));
            for (let k = e - 1; k <= e + 1; k++) {
              for (const m of THRESHOLD_MANTISSAS) {
                const T = m * 10 ** k;
                const prev = v <= T * 0.97 && v > T * 0.94;
                const below = v < T && v > T * 0.97;
                const above = v >= T && v < T * 1.03;
                if (prev || below || above) {
                  const key = `${m}e${k}`;
                  const cur = thr.get(key) ?? [0, 0, 0];
                  if (prev) cur[0]++;
                  else if (below) cur[1]++;
                  else cur[2]++;
                  thr.set(key, cur);
                }
              }
            }
          }
        }
        numeric[col.index] = arr;
        s.sketch = sketch.serialize();
        s.thresholdCounts = [...thr.entries()].map(([k, [p, b, a]]) => [k, p, b, a] as [string, number, number, number]);
      } else if (col.type === 'date') {
        const arr = new Float64Array(n).fill(NaN);
        const fmt = new Uint8Array(n);
        const imp = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          if (nm[i]) continue;
          const d = parseDate(raw[i], req.dateOrder);
          if (!d) continue;
          fmt[i] = DATE_FORMAT_CODES.indexOf(d.format) + 1;
          if (d.impossible) imp[i] = 1;
          else {
            arr[i] = d.days;
            if (d.days < s.dateMin) s.dateMin = d.days;
            if (d.days > s.dateMax) s.dateMax = d.days;
          }
        }
        dates[col.index] = arr;
        dateFormat[col.index] = fmt;
        dateImpossible[col.index] = imp;
      }
      stats[col.index] = s;
    }
    for (let c = 0; c < W; c++) {
      if (!stats[c]) {
        stats[c] = { sketch: null, leadingDigits: new Array<number>(9).fill(0), nonZero: 0, multiplesOf1000: 0, negatives: 0, zeros: 0, thresholdCounts: [], dateMin: Infinity, dateMax: -Infinity };
      }
    }

    this.view = { rowCount: n, raw: this.raw, numeric, dates, nullMask, dateFormat, dateImpossible };
    const relations: RelationCheck[] = req.candidates.map((spec) => this.checkRelation(spec, req.columns));
    return { columns: stats, relations };
  }

  private arrayFor(col: number, columns: ColumnProfile[]): Float64Array | null {
    const v = this.view!;
    return columns[col].type === 'date' ? v.dates[col] : v.numeric[col];
  }

  private checkRelation(spec: RelationSpec, columns: ColumnProfile[]): RelationCheck {
    const n = this.rowCount;
    let checked = 0;
    let ok = 0;
    const get = (c: number): Float64Array | null => this.arrayFor(c, columns);
    switch (spec.kind) {
      case 'date_order': {
        const a = get(spec.earlier);
        const b = get(spec.later);
        if (!a || !b) break;
        for (let i = 0; i < n; i++) {
          if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
          checked++;
          if (b[i] >= a[i]) ok++;
        }
        break;
      }
      case 'product': {
        const a = get(spec.a);
        const b = get(spec.b);
        const r = get(spec.result);
        if (!a || !b || !r) break;
        for (let i = 0; i < n; i++) {
          if (Number.isNaN(a[i]) || Number.isNaN(b[i]) || Number.isNaN(r[i])) continue;
          checked++;
          if (withinTolerance(a[i] * b[i], r[i])) ok++;
        }
        break;
      }
      case 'sum': {
        const parts = spec.parts.map((p) => ({ arr: get(p.col), sign: p.sign }));
        const r = get(spec.result);
        if (!r || parts.some((p) => !p.arr)) break;
        for (let i = 0; i < n; i++) {
          if (Number.isNaN(r[i])) continue;
          let sum = 0;
          let valid = true;
          for (const p of parts) {
            const v = p.arr![i];
            if (Number.isNaN(v)) {
              valid = false;
              break;
            }
            sum += p.sign * v;
          }
          if (!valid) continue;
          checked++;
          if (withinTolerance(sum, r[i])) ok++;
        }
        break;
      }
      case 'lte': {
        const s = get(spec.small);
        const b = get(spec.big);
        if (!s || !b) break;
        for (let i = 0; i < n; i++) {
          if (Number.isNaN(s[i]) || Number.isNaN(b[i])) continue;
          checked++;
          if (s[i] <= b[i] || withinTolerance(s[i], b[i])) ok++;
        }
        break;
      }
    }
    return { id: spec.id, checked, ok };
  }

  // ------------------------------------------------------------------ FEATURES (ML)

  private features(req: FeaturesRequest): FeaturesResult {
    const view = this.requireView();
    const F = req.spec.length;
    const rate = Math.min(1, req.maxSample / Math.max(1, req.totalRows));
    const rarity = rarityTables(req.profile, req.spec);
    const picked: number[] = [];
    for (let i = 0; i < this.rowCount; i++) {
      if (rate >= 1 || unitFromInt((req.offset + i) ^ Math.imul(req.seed, 0x9e3779b1)) < rate) picked.push(i);
    }
    const matrix = new Float64Array(picked.length * F);
    const indexes = new Int32Array(picked.length);
    for (let k = 0; k < picked.length; k++) {
      extractFeatureRow(view, req.spec, rarity, picked[k], matrix, k * F);
      indexes[k] = req.offset + picked[k];
    }
    return { indexes, matrix };
  }

  private featureChunk(req: FeatureChunkRequest): FeatureChunkResult {
    const view = this.requireView();
    const F = req.spec.length;
    const count = Math.max(0, Math.min(req.count, this.rowCount - req.from));
    const rarity = rarityTables(req.profile, req.spec);
    const matrix = new Float64Array(count * F);
    for (let r = 0; r < count; r++) extractFeatureRow(view, req.spec, rarity, req.from + r, matrix, r * F);
    return { matrix, count };
  }

  // ------------------------------------------------------------------ DETECT

  private detect(req: DetectRequest): DetectResult {
    const view = this.requireView();
    const { profile, options } = req;
    const findings: Finding[] = [];
    const keyCol = profile.keyColumn;
    this.keyColumnIndex = keyCol;
    const recordId = (row: number): string | undefined => {
      if (keyCol === null) return undefined;
      if (view.nullMask[keyCol]![row]) return undefined;
      const v = this.raw[keyCol][row].trim();
      return v.length > 40 ? v.slice(0, 39) + '…' : v;
    };
    const ctx: DetectContext = {
      view,
      profile,
      options,
      offset: req.offset,
      emit: makeEmitter(req.offset, findings, recordId),
      recordId,
    };
    const empty = emptyRowMask(ctx);
    const d = options.detectors;
    if (d.missing) detectMissing(ctx, empty);
    if (d.types) detectTypes(ctx, empty);
    if (d.range) detectRange(ctx, empty);
    if (d.relations) detectRelations(ctx, empty);
    if (d.suspicious) detectSuspicious(ctx, empty);
    if (d.ml && options.ml.mode !== 'off') this.detectMl(req, ctx, empty);
    return { findings, hashes: this.computeHashes(profile, d.duplicates), rowCount: this.rowCount };
  }

  private detectMl(req: DetectRequest, ctx: DetectContext, empty: Uint8Array): void {
    const view = ctx.view;
    if (req.remote) {
      const r = req.remote;
      for (let i = 0; i < this.rowCount; i++) {
        if (!r.flags[i] || empty[i]) continue;
        const parts = r.parts[i] ?? [];
        const score = 35 + 65 * Math.max(0, Math.min(1, (r.scores[i] - r.threshold) / (1 - r.threshold)));
        ctx.emit({
          row: i,
          type: 'multivariate_anomaly',
          score,
          field: parts[0]?.field ?? null,
          explanation: es.multivariate(r.scores[i], parts.map((p) => p.message)),
          detector: 'isolation_forest',
        });
      }
      return;
    }
    const model = req.forest;
    const spec = req.spec;
    if (!model || !spec) return;
    const F = spec.length;
    const rarity = rarityTables(req.profile, spec);
    const BLOCK = 4096;
    const buf = new Float64Array(BLOCK * F);
    for (let from = 0; from < this.rowCount; from += BLOCK) {
      const cnt = Math.min(BLOCK, this.rowCount - from);
      for (let r = 0; r < cnt; r++) extractFeatureRow(view, spec, rarity, from + r, buf, r * F);
      const scores = scoreMatrix(model, buf, cnt);
      for (let r = 0; r < cnt; r++) {
        const s = scores[r];
        const row = from + r;
        if (s < model.threshold || empty[row]) continue;
        const contribs = topContributions(model, buf.subarray(r * F, (r + 1) * F), 2).map((c) => explainContribution(model, c));
        const score = 35 + 65 * Math.max(0, Math.min(1, (s - model.threshold) / (1 - model.threshold)));
        ctx.emit({
          row,
          type: 'multivariate_anomaly',
          score,
          field: contribs[0]?.field ?? null,
          explanation: es.multivariate(s, contribs.map((c) => c.message)),
          detector: 'isolation_forest',
        });
      }
    }
  }

  private computeHashes(profile: DatasetProfile, enabled: boolean): ShardHashes {
    const n = this.rowCount;
    const W = this.header.length;
    const view = this.view!;
    const exact = new Float64Array(n);
    if (!enabled) return { exact, key: null, near: null };
    const keyCol = profile.keyColumn;
    const key = keyCol !== null ? new Float64Array(n) : null;
    const near = new Float64Array(n);
    const nearCols = profile.columns.filter((c) => c.index !== keyCol && !(c.role.identifier && c.distinct / Math.max(1, c.rows) >= 0.9));
    for (let i = 0; i < n; i++) {
      let s = '';
      for (let c = 0; c < W; c++) s += (c === 0 ? '' : '\u001f') + this.raw[c][i].trim();
      exact[i] = hash53(s) || 1;
      if (key && keyCol !== null && !view.nullMask[keyCol]![i]) key[i] = hash53(this.raw[keyCol][i].trim()) || 1;
      let parts = 0;
      let ns = '';
      for (const c of nearCols) {
        if (view.nullMask[c.index]![i]) continue;
        const num = view.numeric[c.index];
        const piece = num && !Number.isNaN(num[i]) ? String(num[i]) : normalizeForNear(this.raw[c.index][i]);
        if (piece.length === 0) continue;
        ns += piece + '|';
        parts++;
      }
      near[i] = parts >= 3 ? hash53(ns) || 1 : 0;
    }
    return { exact, key, near };
  }

  // ------------------------------------------------------------------ RECORD

  private record(req: RecordRequest): RecordResult {
    if (req.row < 0 || req.row >= this.rowCount) throw new Error('Registro fuera de rango');
    return { header: this.header, values: this.raw.map((col) => col[req.row]) };
  }

  private ids(req: IdsRequest): IdsResult {
    const keyCol = this.view ? this.keyColumnIndex : null;
    return {
      ids: req.rows.map((row) => {
        if (keyCol === null || row < 0 || row >= this.rowCount) return null;
        if (this.view!.nullMask[keyCol]![row]) return null;
        const v = this.raw[keyCol][row].trim();
        return v.length > 40 ? v.slice(0, 39) + '…' : v;
      }),
    };
  }

  private requireView(): ShardView {
    if (!this.view) throw new Error('El motor no tiene estadísticas calculadas (falta la fase STATS).');
    return this.view;
  }
}

function scannerHeaderUnknown(scanner: BoundaryScanner): boolean {
  return scanner.headerEnd < 0;
}

async function readRemaining(file: Blob, from: number, scanner: BoundaryScanner): Promise<void> {
  const reader = file.slice(from).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    scanner.push(value);
    if (scanner.headerEnd >= 0) return;
  }
}
