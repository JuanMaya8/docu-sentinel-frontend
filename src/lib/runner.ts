/**
 * Glue between the UI and the engine: creates the right pool for the chosen processing mode and wires the
 * optional "historical baseline" scoring through the backend.
 *
 *  main   -> everything runs on the UI thread (InlinePool, blocking)  => the page visibly freezes
 *  worker -> ONE Web Worker                                           => UI stays smooth, 1 core busy
 *  pool   -> N Web Workers in parallel (one shard of the file each)   => UI smooth AND faster
 */
import {
  InlinePool,
  WebWorkerPool,
  analyzeFile,
  type AnalysisOptions,
  type AnalysisSession,
  type BaselineRef,
  type BaselineScore,
  type ProcessingMode,
  type Progress,
  type TrainingSample,
  type WorkerPool,
} from '@/engine';
import { api } from './api';
import { loadPdfJsInWorker } from './pdfjsLoader';

export type WorkerFactory = () => Worker;

/** The `new Worker(new URL(...))` expression must appear literally so the bundler emits the worker chunk. */
export const defaultWorkerFactory: WorkerFactory = () => new Worker(new URL('../workers/shard.worker.ts', import.meta.url));

export function defaultWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(2, Math.min(8, cores - 1));
}

export function createPool(mode: ProcessingMode, workers: number, factory: WorkerFactory = defaultWorkerFactory): WorkerPool {
  if (mode === 'main') return new InlinePool(1, { loadPdfJs: loadPdfJsInWorker });
  return new WebWorkerPool(mode === 'worker' ? 1 : Math.max(2, workers), factory);
}

export interface RunInput {
  file: Blob;
  fileName: string;
  mode: ProcessingMode;
  workers: number;
  options: Partial<AnalysisOptions>;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
  factory?: WorkerFactory;
}

export interface RunResult {
  session: AnalysisSession;
  training?: TrainingSample;
  /** true when a baseline was requested but the AI service did not answer and the local model was used */
  baselineFellBack: boolean;
}

export async function runAnalysis(input: RunInput): Promise<RunResult> {
  const pool = createPool(input.mode, input.workers, input.factory);
  const onAbort = (): void => pool.terminate();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  let training: TrainingSample | undefined;
  let baselineFellBack = false;
  const baseline: BaselineRef | undefined = input.options.ml?.mode === 'baseline' ? input.options.ml.baseline : undefined;
  try {
    const session = await analyzeFile(pool, input.file, input.fileName, input.options, input.mode, {
      onProgress: input.onProgress,
      signal: input.signal,
      onTrainingSample: (s) => {
        training = s;
      },
      scoreBaseline: baseline
        ? async (matrix): Promise<BaselineScore> => {
            try {
              const r = await api.scoreBaseline(baseline.id, matrix);
              return { scores: r.scores, flags: r.flags, threshold: r.threshold, contributions: r.contributions };
            } catch (e) {
              baselineFellBack = true;
              throw e; // the coordinator falls back to the local model
            }
          }
        : undefined,
    });
    return { session, training, baselineFellBack };
  } catch (e) {
    pool.terminate();
    throw e;
  } finally {
    input.signal?.removeEventListener('abort', onAbort);
  }
}
