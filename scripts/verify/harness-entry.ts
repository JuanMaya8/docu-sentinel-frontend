/**
 * Browser test harness (NOT part of the Next app). Bundled by scripts/browser-verify.mjs and loaded in a real
 * Chromium so we can check real Web Workers, pdf.js and the Main-thread-vs-Workers timings.
 */
import { AnalysisAborted, InlinePool, WebWorkerPool, analyzeFile, generateDataset, type ProcessingMode, type SynthKind, type WorkerPool } from '../../src/engine';
import { FrameMonitor, type FrameStats } from '../../src/lib/frameMonitor';
import { loadPdfJsInWorker } from '../../src/lib/pdfjsLoader';

function makePool(mode: ProcessingMode, workers: number): WorkerPool {
  if (mode === 'main') return new InlinePool(1, { loadPdfJs: loadPdfJsInWorker });
  return new WebWorkerPool(mode === 'worker' ? 1 : workers, () => new Worker('/worker.js', { type: 'module' }));
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export interface RunOut {
  mode: ProcessingMode;
  workers: number;
  rows: number;
  bytes: number;
  ms: number;
  frames: FrameStats;
  totalFindings: number;
  recordsAffected: number;
  byType: Record<string, number>;
  hash: string;
  phaseMs: Record<string, number>;
  format: string;
  keys: string[];
  workerKind: string;
}

async function runBlob(blob: Blob, fileName: string, mode: ProcessingMode, workers: number, ml: boolean): Promise<RunOut> {
  const pool = makePool(mode, workers);
  const mon = new FrameMonitor();
  await new Promise((r) => setTimeout(r, 300)); // settle
  mon.start();
  const t0 = performance.now();
  const session = await analyzeFile(pool, blob, fileName, { now: Date.UTC(2026, 0, 15), ml: { mode: ml ? 'local' : 'off', seed: 42 } }, mode);
  const ms = performance.now() - t0;
  const frames = mon.stop();
  const r = session.report;
  const keys = r.findings.map((f) => `${f.recordIndex}:${f.type}`);
  const out: RunOut = {
    mode,
    workers: pool.size,
    rows: r.meta.rows,
    bytes: blob.size,
    ms,
    frames,
    totalFindings: r.totalFindings,
    recordsAffected: r.recordsAffected,
    byType: r.byType as Record<string, number>,
    hash: fnv(JSON.stringify(r.findings)),
    phaseMs: r.meta.phaseMs,
    format: r.meta.format,
    keys,
    workerKind: pool.kind,
  };
  session.dispose();
  return out;
}

const api = {
  async generated(kind: SynthKind, rows: number, mode: ProcessingMode, workers: number, ml = true): Promise<RunOut> {
    const data = generateDataset({ kind, rows, seed: 11 });
    const out = await runBlob(data.blob, data.fileName, mode, workers, ml);
    out.keys = out.keys.slice(0, 0);
    return out;
  },
  async fixture(url: string, mode: ProcessingMode, workers: number): Promise<RunOut> {
    const buf = await (await fetch(url)).arrayBuffer();
    return runBlob(new Blob([buf]), url.split('/').pop() ?? 'file', mode, workers, false);
  },
  /** starts a big analysis in a pool and aborts it after `afterMs`; resolves with what happened */
  async abortTest(afterMs: number): Promise<{ aborted: boolean; ms: number }> {
    const data = generateDataset({ kind: 'invoices', rows: 400_000, seed: 3 });
    const pool = makePool('pool', 2);
    const ctrl = new AbortController();
    const t0 = performance.now();
    setTimeout(() => {
      ctrl.abort();
      pool.terminate();
    }, afterMs);
    try {
      await analyzeFile(pool, data.blob, data.fileName, {}, 'pool', { signal: ctrl.signal });
      return { aborted: false, ms: performance.now() - t0 };
    } catch (e) {
      return { aborted: e instanceof AnalysisAborted || /cancelad/i.test(String(e)), ms: performance.now() - t0 };
    }
  },
  /** main-thread responsiveness probe: how long does a 20 ms timer take to fire while analysing? */
  hardware: () => ({ cores: navigator.hardwareConcurrency, ua: navigator.userAgent }),
};

declare global {
  interface Window {
    Harness: typeof api;
  }
}
window.Harness = api;
