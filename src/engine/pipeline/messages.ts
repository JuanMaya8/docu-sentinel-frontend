import type {
  AnalysisOptions,
  ColumnProfile,
  DatasetProfile,
  FeatureKind,
  FeatureSpec,
  FileFormat,
  Finding,
  PartialProfile,
  RelationSpec,
  StatsPartial,
} from '../types';
import type { ForestModel } from '../ml/isolationForest';
import type { DateOrder } from '../util/dates';
import type { ShardHashes } from '../detectors/duplicates';

export interface PlanRequest {
  file: Blob;
  fileName: string;
  shardCount: number;
  dateOrder: DateOrder;
  /** read everything with blob.text() and parse in one synchronous pass (naive "main thread" baseline) */
  blocking: boolean;
}

export interface PlanResult {
  format: FileFormat;
  delimiter: string | null;
  encoding: string;
  header: string[];
  /** byte ranges for streamable formats (csv/tsv/ndjson); null for json/pdf */
  ranges: Array<{ start: number; end: number }> | null;
  /** parsed rows for non-streamable formats (json/pdf) */
  rows: string[][] | null;
  totalBytes: number;
  warnings: string[];
}

export interface ParseRequest {
  shardIndex: number;
  format: FileFormat;
  delimiter: string | null;
  encoding: string;
  header: string[];
  file?: Blob;
  range?: { start: number; end: number };
  rows?: string[][];
  blocking: boolean;
}

export interface ParseResult {
  rowCount: number;
  partial: PartialProfile;
  warnings: string[];
}

export interface StatsRequest {
  columns: ColumnProfile[];
  candidates: RelationSpec[];
  dateOrder: DateOrder;
}

export type StatsResult = StatsPartial;

export interface FeaturesRequest {
  profile: DatasetProfile;
  spec: FeatureSpec[];
  offset: number;
  totalRows: number;
  seed: number;
  maxSample: number;
}

export interface FeaturesResult {
  /** global row indexes of the sampled rows (ascending) */
  indexes: Int32Array;
  matrix: Float64Array;
}

export interface FeatureChunkRequest {
  profile: DatasetProfile;
  spec: FeatureSpec[];
  from: number;
  count: number;
}

export interface FeatureChunkResult {
  matrix: Float64Array;
  count: number;
}

export interface RemoteMlResult {
  scores: Float32Array;
  flags: Uint8Array;
  parts: Record<number, Array<{ field: string; message: string; deviation: number }>>;
  threshold: number;
}

export interface DetectRequest {
  profile: DatasetProfile;
  options: AnalysisOptions;
  offset: number;
  forest: ForestModel | null;
  spec: FeatureSpec[] | null;
  remote: RemoteMlResult | null;
}

export interface DetectResult {
  findings: Finding[];
  hashes: ShardHashes;
  rowCount: number;
}

export interface TrainRequest {
  matrix: Float64Array;
  rows: number;
  columns: string[];
  kinds: FeatureKind[];
  contamination: number;
  thresholdFloor: number;
  seed: number;
}

export interface RecordRequest {
  row: number;
}

export interface RecordResult {
  header: string[];
  values: string[];
}

export interface IdsRequest {
  rows: number[];
}

export interface IdsResult {
  ids: Array<string | null>;
}

export interface ProgressMsg {
  bytes?: number;
  rows?: number;
  fraction?: number;
}

export type RequestMap = {
  plan: [PlanRequest, PlanResult];
  parse: [ParseRequest, ParseResult];
  stats: [StatsRequest, StatsResult];
  features: [FeaturesRequest, FeaturesResult];
  featureChunk: [FeatureChunkRequest, FeatureChunkResult];
  train: [TrainRequest, ForestModel];
  detect: [DetectRequest, DetectResult];
  record: [RecordRequest, RecordResult];
  ids: [IdsRequest, IdsResult];
  dispose: [undefined, null];
};
