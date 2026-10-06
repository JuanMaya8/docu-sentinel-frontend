import type { AnalysisOptions, AnomalyType, DatasetProfile, Finding } from '../types';
import { riskFromScore } from '../i18n/es';
import type { FeatureSource } from '../ml/features';
import type { DateFormat } from '../util/dates';
import { truncate } from '../util/text';

export const DATE_FORMAT_CODES: DateFormat[] = ['iso', 'ymd_slash', 'dmy_slash', 'dmy_dash', 'dmy_dot', 'mdy'];

/** Columnar, typed view of one shard (built during the STATS phase). */
export interface ShardView extends FeatureSource {
  /** per date column: index+1 into DATE_FORMAT_CODES, 0 when not a date */
  dateFormat: Array<Uint8Array | null>;
  /** per date column: 1 when the text looked like a date but is impossible (31/02) */
  dateImpossible: Array<Uint8Array | null>;
}

export interface DetectContext {
  view: ShardView;
  profile: DatasetProfile;
  options: AnalysisOptions;
  /** global index of the first row of this shard */
  offset: number;
  emit: (f: EmitInput) => void;
  recordId: (localRow: number) => string | undefined;
}

export interface EmitInput {
  row: number; // local row index
  type: AnomalyType;
  score: number;
  field: string | null;
  value?: string;
  explanation: string;
  detector: string;
}

export function makeEmitter(
  offset: number,
  out: Finding[],
  recordId: (localRow: number) => string | undefined,
): (f: EmitInput) => void {
  return (f) => {
    const score = Math.max(1, Math.min(100, Math.round(f.score)));
    const finding: Finding = {
      recordIndex: offset + f.row,
      type: f.type,
      risk: riskFromScore(score),
      score,
      field: f.field,
      explanation: f.explanation,
      detector: f.detector,
    };
    const id = recordId(f.row);
    if (id !== undefined) finding.recordId = id;
    if (f.value !== undefined) finding.value = truncate(f.value, 120);
    out.push(finding);
  };
}

export function nullMaskOf(view: ShardView, col: number): Uint8Array {
  return view.nullMask[col] as Uint8Array;
}
