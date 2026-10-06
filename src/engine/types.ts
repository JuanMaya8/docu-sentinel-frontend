import type { DateFormat, DateOrder } from './util/dates';
import type { NumberStyle } from './util/numbers';
import type { SerializedSketch } from './sketch/ddsketch';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type FileFormat = 'csv' | 'tsv' | 'json' | 'ndjson' | 'pdf';
export type ProcessingMode = 'main' | 'worker' | 'pool';
export type Sensitivity = 'low' | 'medium' | 'high';
export type ValueType = 'null' | 'integer' | 'decimal' | 'date' | 'boolean' | 'email' | 'string';
export type ColumnType = 'integer' | 'decimal' | 'date' | 'boolean' | 'email' | 'string' | 'mixed';

export type AnomalyType =
  | 'duplicate_exact'
  | 'duplicate_key'
  | 'duplicate_near'
  | 'missing_field'
  | 'empty_record'
  | 'type_mismatch'
  | 'invalid_format'
  | 'impossible_date'
  | 'inconsistent_label'
  | 'whitespace'
  | 'out_of_range'
  | 'negative_value'
  | 'future_date'
  | 'impossible_relation'
  | 'suspicious_threshold'
  | 'suspicious_round'
  | 'benford'
  | 'multivariate_anomaly'
  | 'mixed_types';

export type DetectorId = 'duplicates' | 'missing' | 'types' | 'range' | 'relations' | 'suspicious' | 'ml';

export interface Finding {
  /** 0-based global data-row index; null for column-level findings */
  recordIndex: number | null;
  recordId?: string;
  type: AnomalyType;
  risk: RiskLevel;
  /** 0..100 */
  score: number;
  field: string | null;
  value?: string;
  explanation: string;
  detector: string;
}

// ---------------------------------------------------------------- options

export interface BaselineRef {
  id: string;
  name: string;
  columns: string[];
  kinds: FeatureKind[];
}

export type MlMode = 'off' | 'local' | 'baseline';

export interface AnalysisOptions {
  sensitivity: Sensitivity;
  detectors: Record<DetectorId, boolean>;
  ml: { mode: MlMode; baseline?: BaselineRef; seed: number };
  /** a column is "required" when its null rate is <= this value (and it has some nulls) */
  requiredMaxNullRate: number;
  /** override the auto-detected key column(s) used for duplicate-key detection */
  keyColumns?: string[];
  dateOrder: DateOrder;
  /** keep at most this many findings (highest scores first) */
  maxFindings: number;
  /** epoch ms used for "future date" checks; defaults to Date.now() (set it in tests) */
  now?: number;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  sensitivity: 'medium',
  detectors: {
    duplicates: true,
    missing: true,
    types: true,
    range: true,
    relations: true,
    suspicious: true,
    ml: true,
  },
  ml: { mode: 'local', seed: 42 },
  requiredMaxNullRate: 0.03,
  dateOrder: 'dmy',
  maxFindings: 200_000,
};

export function resolveOptions(partial?: Partial<AnalysisOptions>): AnalysisOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...partial,
    detectors: { ...DEFAULT_OPTIONS.detectors, ...(partial?.detectors ?? {}) },
    ml: { ...DEFAULT_OPTIONS.ml, ...(partial?.ml ?? {}) },
  };
}

// ---------------------------------------------------------------- features (ML)

export type FeatureKind = 'numeric' | 'date' | 'missing' | 'rarity';
export interface FeatureSpec {
  name: string;
  kind: FeatureKind;
  columnIndex: number;
}

// ---------------------------------------------------------------- profiling

export type ColumnRole = {
  identifier: boolean; // ids, codes, phones: never range-checked
  keyCandidate: boolean;
  amount: boolean;
  quantity: boolean;
  price: boolean;
  age: boolean;
  dateRole: 'issue' | 'due' | 'start' | 'end' | 'birth' | 'created' | null;
};

/** Per-shard raw counters (phase PARSE). All additive / mergeable. */
export interface PartialColumn {
  count: number;
  nulls: number;
  votes: Record<ValueType, number>;
  styleVotes: { dot: number; comma: number };
  dateFormatVotes: Partial<Record<DateFormat, number>>;
  impossibleDates: number;
  whitespacePadded: number;
  kmv: number[];
  /** raw value -> count; `overflow` when more than the cap distinct values were seen */
  categories: Array<[string, number]>;
  categoriesOverflow: boolean;
}

export interface PartialProfile {
  rows: number;
  columns: PartialColumn[];
}

/** Per-shard numeric counters (phase STATS). */
export interface StatsColumn {
  sketch: SerializedSketch | null;
  leadingDigits: number[]; // index 0..8 => digit 1..9
  nonZero: number;
  multiplesOf1000: number;
  negatives: number;
  zeros: number;
  /** [key "<mantissa>e<exp>", prev, below, above] counts of values in (0.94T,0.97T], (0.97T,T) and [T,1.03T) */
  thresholdCounts: Array<[string, number, number, number]>;
  dateMin: number;
  dateMax: number;
}

export interface RelationCheck {
  id: string;
  checked: number;
  ok: number;
}

export interface StatsPartial {
  columns: StatsColumn[];
  relations: RelationCheck[];
}

export interface NumericProfile {
  n: number;
  min: number;
  max: number;
  q1: number;
  median: number;
  q3: number;
  p01: number;
  p99: number;
  iqr: number;
  /** robust scale (IQR/1.349, with fallbacks) */
  scale: number;
  negatives: number;
  zeros: number;
}

export interface ColumnProfile {
  index: number;
  name: string;
  type: ColumnType;
  typeShare: number;
  rows: number;
  nulls: number;
  nullRate: number;
  distinct: number;
  distinctExact: boolean;
  numberStyle: NumberStyle;
  dateFormat: DateFormat | null;
  role: ColumnRole;
  required: boolean;
  /** share of non-null values with leading/trailing whitespace */
  whitespacePaddedShare: number;
  categorical: boolean;
  /** raw value -> count, only for categorical columns */
  categories: Array<[string, number]> | null;
  /** value-type shares (non-null values), used for explanations */
  typeShares: Partial<Record<ValueType, number>>;
  numeric: NumericProfile | null;
  leadingDigits: number[] | null;
  multiplesOf1000: number;
  /** round thresholds just below which values bunch up (value + how many records sit under it) */
  thresholds: Array<{ value: number; below: number }>;
  dateMin: number | null;
  dateMax: number | null;
}

export type RelationSpec =
  | { id: string; kind: 'date_order'; earlier: number; later: number }
  | { id: string; kind: 'product'; a: number; b: number; result: number }
  | { id: string; kind: 'sum'; parts: Array<{ col: number; sign: 1 | -1 }>; result: number }
  | { id: string; kind: 'lte'; small: number; big: number };

export interface DatasetProfile {
  rows: number;
  columns: ColumnProfile[];
  keyColumn: number | null;
  relations: RelationSpec[];
  /** relation candidates checked during STATS (before being accepted) */
  relationCandidates: RelationSpec[];
}

// ---------------------------------------------------------------- report

export interface ColumnSummary {
  name: string;
  type: ColumnType;
  nullRate: number;
  distinct: number | null;
}

export interface ReportMeta {
  fileName: string;
  format: FileFormat;
  fileSizeBytes: number;
  rows: number;
  columns: number;
  durationMs: number;
  mode: ProcessingMode;
  workers: number;
  sensitivity: Sensitivity;
  mlMode: MlMode;
  baselineId?: string;
  keyColumn: string | null;
  warnings: string[];
  /** true when findings were cut at `maxFindings` */
  truncated: boolean;
  phaseMs: Record<string, number>;
}

export interface Report {
  meta: ReportMeta;
  columns: ColumnSummary[];
  findings: Finding[];
  totalFindings: number;
  recordsAffected: number;
  byRisk: Record<RiskLevel, number>;
  byType: Partial<Record<AnomalyType, number>>;
  /** record-level combined risk for the highest-risk records */
  topRecords: Array<{ recordIndex: number; recordId?: string; risk: RiskLevel; score: number; findings: number }>;
}

export interface Progress {
  phase: 'plan' | 'parse' | 'stats' | 'features' | 'detect' | 'resolve' | 'done';
  /** 0..1 within the phase */
  fraction: number;
  overall: number;
  rows?: number;
  bytes?: number;
  message: string;
}
